import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getMetafields
const GetMetafieldsInputSchema = z.object({
  ownerType: z.enum(["PRODUCT", "PRODUCTVARIANT", "CUSTOMER", "ORDER", "COLLECTION", "SHOP"]).describe("Type of resource to get metafields for"),
  ownerId: z.string().optional().describe("ID of the specific resource (required for all except SHOP)"),
  namespace: z.string().optional().describe("Filter by metafield namespace"),
  limit: z.number().default(50).describe("Maximum number of metafields to return"),
  includeDefinitions: z
    .boolean()
    .default(false)
    .describe(
      "Also return ALL metafield definitions for this owner type, merged with current values, so unfilled/empty fields are included (each entry has value:null and isSet:false when empty)"
    )
});

type GetMetafieldsInput = z.infer<typeof GetMetafieldsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize owner ID to GID format based on type
function normalizeOwnerId(id: string, ownerType: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  
  const typeMap: Record<string, string> = {
    PRODUCT: "Product",
    PRODUCTVARIANT: "ProductVariant",
    CUSTOMER: "Customer",
    ORDER: "Order",
    COLLECTION: "Collection"
  };
  
  const gidType = typeMap[ownerType];
  if (!gidType) {
    throw new Error(`Unknown owner type: ${ownerType}`);
  }
  
  return `gid://shopify/${gidType}/${id}`;
}

// Fetch all metafield definitions for an owner type and merge them with the
// values currently set, so callers can see unfilled (empty) fields too.
async function fetchDefinitionsMerged(
  ownerType: string,
  setMetafields: Array<{ namespace: string; key: string; value: string | null }>
) {
  const query = gql`
    query MetafieldDefinitionsForOwner(
      $ownerType: MetafieldOwnerType!
      $first: Int!
    ) {
      metafieldDefinitions(ownerType: $ownerType, first: $first) {
        edges {
          node {
            id
            name
            namespace
            key
            description
            type {
              name
            }
          }
        }
      }
    }
  `;

  const data = (await shopifyClient.request(query, {
    ownerType,
    first: 250
  })) as {
    metafieldDefinitions: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          namespace: string;
          key: string;
          description: string | null;
          type: { name: string };
        };
      }>;
    };
  };

  const valueByKey = new Map(
    setMetafields.map((m) => [`${m.namespace}.${m.key}`, m.value])
  );

  return data.metafieldDefinitions.edges.map((edge) => {
    const def = edge.node;
    const fullKey = `${def.namespace}.${def.key}`;
    const hasValue = valueByKey.has(fullKey);
    return {
      id: def.id,
      namespace: def.namespace,
      key: def.key,
      fullKey,
      name: def.name,
      description: def.description,
      type: def.type.name,
      value: hasValue ? valueByKey.get(fullKey) ?? null : null,
      isSet: hasValue
    };
  });
}

const getMetafields = {
  name: "get-metafields",
  description: "Get metafields for a product, variant, customer, order, collection, or shop",
  schema: GetMetafieldsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetMetafieldsInput) => {
    try {
      if (input.ownerType === "SHOP") {
        // Shop metafields query
        const shopQuery = gql`
          query GetShopMetafields($first: Int!, $namespace: String) {
            shop {
              id
              name
              metafields(first: $first, namespace: $namespace) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                    createdAt
                    updatedAt
                  }
                }
              }
            }
          }
        `;

        const data = (await shopifyClient.request(shopQuery, {
          first: input.limit,
          namespace: input.namespace
        })) as {
          shop: {
            id: string;
            name: string;
            metafields: {
              edges: Array<{
                node: {
                  id: string;
                  namespace: string;
                  key: string;
                  value: string;
                  type: string;
                  createdAt: string;
                  updatedAt: string;
                };
              }>;
            };
          };
        };

        const shopMetafields = data.shop.metafields.edges.map((e) => e.node);
        return {
          owner: {
            type: "SHOP",
            id: data.shop.id,
            name: data.shop.name
          },
          metafields: shopMetafields,
          ...(input.includeDefinitions
            ? { definitions: await fetchDefinitionsMerged("SHOP", shopMetafields) }
            : {})
        };
      }

      // For other owner types, we need the ownerId
      if (!input.ownerId) {
        throw new Error(`ownerId is required for ${input.ownerType}`);
      }

      const ownerId = normalizeOwnerId(input.ownerId, input.ownerType);

      // Generic query for other types using node interface
      const query = gql`
        query GetMetafields($id: ID!, $first: Int!, $namespace: String) {
          node(id: $id) {
            ... on HasMetafields {
              metafields(first: $first, namespace: $namespace) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                    createdAt
                    updatedAt
                    definition {
                      id
                      name
                      description
                    }
                  }
                }
              }
            }
            ... on Product {
              id
              title
            }
            ... on ProductVariant {
              id
              title
            }
            ... on Customer {
              id
              displayName
            }
            ... on Order {
              id
              name
            }
            ... on Collection {
              id
              title
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        id: ownerId,
        first: input.limit,
        namespace: input.namespace
      })) as {
        node: {
          id: string;
          title?: string;
          name?: string;
          displayName?: string;
          metafields?: {
            edges: Array<{
              node: {
                id: string;
                namespace: string;
                key: string;
                value: string;
                type: string;
                createdAt: string;
                updatedAt: string;
                definition: {
                  id: string;
                  name: string;
                  description: string | null;
                } | null;
              };
            }>;
          };
        } | null;
      };

      if (!data.node) {
        throw new Error(`Resource not found: ${input.ownerId}`);
      }

      const ownerName = data.node.title || data.node.name || data.node.displayName || "Unknown";

      const nodeMetafields =
        data.node.metafields?.edges.map((e) => ({
          ...e.node,
          definitionName: e.node.definition?.name,
          definitionDescription: e.node.definition?.description
        })) || [];

      return {
        owner: {
          type: input.ownerType,
          id: data.node.id,
          name: ownerName
        },
        metafields: nodeMetafields,
        ...(input.includeDefinitions
          ? {
              definitions: await fetchDefinitionsMerged(
                input.ownerType,
                nodeMetafields
              )
            }
          : {})
      };
    } catch (error) {
      console.error("Error fetching metafields:", error);
      throw new Error(
        `Failed to fetch metafields: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getMetafields };
