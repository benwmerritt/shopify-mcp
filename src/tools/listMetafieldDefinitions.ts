import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const ListMetafieldDefinitionsInputSchema = z.object({
  ownerType: z
    .enum([
      "PRODUCT",
      "PRODUCTVARIANT",
      "CUSTOMER",
      "ORDER",
      "COLLECTION",
      "SHOP",
    ])
    .describe("Type of resource to list metafield definitions for"),
  limit: z
    .number()
    .default(25)
    .describe("Maximum number of definitions to return (max 250)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor for fetching the next page"),
});

type ListMetafieldDefinitionsInput = z.infer<
  typeof ListMetafieldDefinitionsInputSchema
>;

let shopifyClient: GraphQLClient;

const listMetafieldDefinitions = {
  name: "list-metafield-definitions",
  description:
    "List metafield definitions (schema) for a given owner type so you can discover what custom metafields have been defined for products, collections, customers, orders, etc. Each definition now includes `constraints` — e.g. `{key:\"category\", values:[\"vp-2\",\"vp-2-2-3\",…]}` means the metafield only applies to products in those taxonomy categories. If you set such a metafield on a product outside the allowed categories, Shopify silently filters the value out on read.",
  schema: ListMetafieldDefinitionsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ListMetafieldDefinitionsInput) => {
    try {
      const query = gql`
        query ListMetafieldDefinitions(
          $ownerType: MetafieldOwnerType!
          $first: Int!
          $after: String
        ) {
          metafieldDefinitions(
            ownerType: $ownerType
            first: $first
            after: $after
          ) {
            edges {
              cursor
              node {
                id
                name
                namespace
                key
                description
                type {
                  name
                  category
                }
                ownerType
                pinnedPosition
                validations {
                  name
                  type
                  value
                }
                constraints {
                  key
                  values(first: 50) {
                    nodes { value }
                  }
                }
                access {
                  admin
                  storefront
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        ownerType: input.ownerType,
        first: Math.min(input.limit, 250),
        after: input.cursor,
      })) as {
        metafieldDefinitions: {
          edges: Array<{
            cursor: string;
            node: {
              id: string;
              name: string;
              namespace: string;
              key: string;
              description: string | null;
              type: {
                name: string;
                category: string;
              };
              ownerType: string;
              pinnedPosition: number | null;
              validations: Array<{
                name: string;
                type: string;
                value: string;
              }>;
              constraints: {
                key: string | null;
                values: { nodes: Array<{ value: string }> };
              } | null;
              access: {
                admin: string;
                storefront: string;
              };
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      return {
        definitions: data.metafieldDefinitions.edges.map((edge) => ({
          id: edge.node.id,
          name: edge.node.name,
          namespace: edge.node.namespace,
          key: edge.node.key,
          fullKey: `${edge.node.namespace}.${edge.node.key}`,
          description: edge.node.description,
          type: edge.node.type,
          ownerType: edge.node.ownerType,
          pinnedPosition: edge.node.pinnedPosition,
          validations: edge.node.validations,
          // Flatten constraints to { key, values: string[] } — agents need to
          // see category-gating (e.g. vehicle_* requires vp-2*) BEFORE writing.
          constraints: edge.node.constraints
            ? {
                key: edge.node.constraints.key,
                values: edge.node.constraints.values.nodes.map((n) => n.value),
              }
            : null,
          access: edge.node.access,
        })),
        pageInfo: {
          hasNextPage: data.metafieldDefinitions.pageInfo.hasNextPage,
          nextCursor: data.metafieldDefinitions.pageInfo.endCursor,
        },
      };
    } catch (error) {
      console.error("Error listing metafield definitions:", error);
      throw new Error(
        `Failed to list metafield definitions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

export { listMetafieldDefinitions };
