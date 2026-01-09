import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for setMetafield
const SetMetafieldInputSchema = z.object({
  ownerId: z.string().min(1).describe("ID of the resource to set metafield on (Product, Customer, Order, etc.)"),
  ownerType: z.enum(["PRODUCT", "PRODUCTVARIANT", "CUSTOMER", "ORDER", "COLLECTION", "SHOP"]).describe("Type of resource"),
  namespace: z.string().min(1).describe("Metafield namespace (e.g., 'custom', 'my_app')"),
  key: z.string().min(1).describe("Metafield key"),
  value: z.string().describe("Metafield value (JSON string for complex types)"),
  type: z.enum([
    // Text types
    "single_line_text_field",
    "multi_line_text_field",
    "rich_text_field",
    // Number types
    "number_integer",
    "number_decimal",
    // Boolean
    "boolean",
    // Date/time
    "date",
    "date_time",
    // JSON
    "json",
    // Measurement types
    "weight",
    "dimension",
    "volume",
    // Money
    "money",
    // Rating
    "rating",
    // URL
    "url",
    // Color
    "color",
    // Reference types
    "product_reference",
    "variant_reference",
    "collection_reference",
    "file_reference",
    "page_reference",
    "metaobject_reference",
    // List types
    "list.single_line_text_field",
    "list.number_integer",
    "list.number_decimal",
    "list.date",
    "list.date_time",
    "list.url",
    "list.color",
    "list.product_reference",
    "list.variant_reference",
    "list.collection_reference",
    "list.file_reference",
    "list.page_reference",
    "list.metaobject_reference"
  ]).default("single_line_text_field").describe("Metafield type (determines how value is stored and validated)")
});

type SetMetafieldInput = z.infer<typeof SetMetafieldInputSchema>;

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
    COLLECTION: "Collection",
    SHOP: "Shop"
  };

  const gidType = typeMap[ownerType];
  if (!gidType) {
    throw new Error(`Unknown owner type: ${ownerType}`);
  }

  return `gid://shopify/${gidType}/${id}`;
}

const setMetafield = {
  name: "set-metafield",
  description: "Create or update a metafield on a product, variant, customer, order, collection, or shop. Use this to store custom data.",
  schema: SetMetafieldInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SetMetafieldInput) => {
    try {
      let ownerId: string;

      // Handle SHOP type specially - need to fetch shop ID first
      if (input.ownerType === "SHOP") {
        const shopQuery = gql`
          query GetShopId {
            shop {
              id
            }
          }
        `;
        const shopData = (await shopifyClient.request(shopQuery)) as { shop: { id: string } };
        ownerId = shopData.shop.id;
      } else {
        ownerId = normalizeOwnerId(input.ownerId, input.ownerType);
      }

      const mutation = gql`
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              namespace
              key
              value
              type
              createdAt
              updatedAt
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const data = (await shopifyClient.request(mutation, {
        metafields: [
          {
            ownerId,
            namespace: input.namespace,
            key: input.key,
            value: input.value,
            type: input.type
          }
        ]
      })) as {
        metafieldsSet: {
          metafields: Array<{
            id: string;
            namespace: string;
            key: string;
            value: string;
            type: string;
            createdAt: string;
            updatedAt: string;
          }> | null;
          userErrors: Array<{
            field: string[];
            message: string;
            code: string;
          }>;
        };
      };

      if (data.metafieldsSet.userErrors.length > 0) {
        throw new Error(
          `Failed to set metafield: ${data.metafieldsSet.userErrors
            .map((e) => `${e.code}: ${e.message}`)
            .join(", ")}`
        );
      }

      const metafield = data.metafieldsSet.metafields?.[0];

      if (!metafield) {
        throw new Error("Metafield was not returned after setting");
      }

      return {
        success: true,
        metafield: {
          id: metafield.id,
          namespace: metafield.namespace,
          key: metafield.key,
          value: metafield.value,
          type: metafield.type,
          createdAt: metafield.createdAt,
          updatedAt: metafield.updatedAt
        },
        owner: {
          type: input.ownerType,
          id: ownerId
        }
      };
    } catch (error) {
      console.error("Error setting metafield:", error);
      throw new Error(
        `Failed to set metafield: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { setMetafield };
