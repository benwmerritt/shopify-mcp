import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleteVariant
const DeleteVariantInputSchema = z.object({
  variantId: z.string().min(1).describe("Variant ID to delete (can be numeric or full GID)")
});

type DeleteVariantInput = z.infer<typeof DeleteVariantInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize variant ID to GID format
function normalizeVariantId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
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
      const variantId = normalizeVariantId(input.variantId);

      const query = gql`
        mutation productVariantDelete($id: ID!) {
          productVariantDelete(id: $id) {
            deletedProductVariantId
            product {
              id
              title
              variantsCount {
                count
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        id: variantId
      };

      const data = (await shopifyClient.request(query, variables)) as {
        productVariantDelete: {
          deletedProductVariantId: string | null;
          product: {
            id: string;
            title: string;
            variantsCount: { count: number };
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors
      if (data.productVariantDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete variant: ${data.productVariantDelete.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      return {
        success: true,
        deletedVariantId: data.productVariantDelete.deletedProductVariantId,
        product: data.productVariantDelete.product ? {
          id: data.productVariantDelete.product.id,
          title: data.productVariantDelete.product.title,
          remainingVariants: data.productVariantDelete.product.variantsCount.count
        } : null,
        message: `Variant ${data.productVariantDelete.deletedProductVariantId} has been deleted`
      };
    } catch (error) {
      console.error("Error deleting variant:", error);
      throw new Error(
        `Failed to delete variant: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteVariant };
