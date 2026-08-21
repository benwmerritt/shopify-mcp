import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const DeleteVariantInputSchema = z.object({
  productId: z
    .string()
    .min(1)
    .describe("Product ID that owns the variant (can be numeric or full GID)"),
  variantId: z
    .string()
    .min(1)
    .describe("Variant ID to delete (can be numeric or full GID)"),
});

type DeleteVariantInput = z.infer<typeof DeleteVariantInputSchema>;

let shopifyClient: GraphQLClient;

function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/Product/${id}`;
}

function normalizeVariantId(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/ProductVariant/${id}`;
}

const deleteVariant = {
  name: "delete-variant",
  description: "Delete a specific variant from a product. Cannot delete the last variant.",
  schema: DeleteVariantInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteVariantInput) => {
    try {
      const productId = normalizeProductId(input.productId);
      const variantId = normalizeVariantId(input.variantId);

      const query = gql`
        mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
          productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
            product {
              id
              title
              variantsCount { count }
            }
            userErrors { field message }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        productId,
        variantsIds: [variantId],
      })) as {
        productVariantsBulkDelete: {
          product: {
            id: string;
            title: string;
            variantsCount: { count: number };
          } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      };

      const payload = data.productVariantsBulkDelete;
      if (payload.userErrors.length > 0) {
        throw new Error(
          `Failed to delete variant: ${payload.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`,
        );
      }
      if (!payload.product) {
        throw new Error("Variant deletion returned no product");
      }

      return {
        success: true,
        deletedVariantId: variantId,
        product: {
          id: payload.product.id,
          title: payload.product.title,
          remainingVariants: payload.product.variantsCount.count,
        },
        message: `Variant ${variantId} has been deleted`,
      };
    } catch (error) {
      console.error("Error deleting variant:", error);
      throw new Error(
        `Failed to delete variant: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export { deleteVariant, DeleteVariantInputSchema };
