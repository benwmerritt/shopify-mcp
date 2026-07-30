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

      // productVariantDelete was removed from newer Admin API versions;
      // productVariantsBulkDelete requires the productId, so resolve it first.
      const lookup = gql`
        query variantProduct($id: ID!) {
          productVariant(id: $id) {
            id
            product {
              id
            }
          }
        }
      `;
      const found = (await shopifyClient.request(lookup, { id: variantId })) as {
        productVariant: { id: string; product: { id: string } } | null;
      };
      if (!found.productVariant) {
        throw new Error(`Variant not found: ${variantId}`);
      }
      const productId = found.productVariant.product.id;

      const query = gql`
        mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
          productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
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
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors (the outer catch adds the "Failed to delete variant" prefix)
      if (data.productVariantsBulkDelete.userErrors.length > 0) {
        throw new Error(
          data.productVariantsBulkDelete.userErrors
            .map((e) => `${(e.field || []).join(".")}: ${e.message}`)
            .join(", ")
        );
      }

      return {
        success: true,
        // The bulk payload has no deleted-IDs field, so this echoes the input;
        // empty userErrors is the success signal.
        deletedVariantId: variantId,
        product: data.productVariantsBulkDelete.product ? {
          id: data.productVariantsBulkDelete.product.id,
          title: data.productVariantsBulkDelete.product.title,
          remainingVariants: data.productVariantsBulkDelete.product.variantsCount.count
        } : null,
        message: `Variant ${variantId} has been deleted`
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
