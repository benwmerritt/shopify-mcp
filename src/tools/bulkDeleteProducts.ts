import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for bulk product deletion
const BulkDeleteProductsInputSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(100).describe("Array of product IDs to delete (max 100)")
});

type BulkDeleteProductsInput = z.infer<typeof BulkDeleteProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

const bulkDeleteProducts = {
  name: "bulk-delete-products",
  description: "Delete multiple products at once. This action is irreversible. Max 100 products per call.",
  schema: BulkDeleteProductsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: BulkDeleteProductsInput) => {
    const results: Array<{
      productId: string;
      success: boolean;
      error?: string;
    }> = [];

    const deleteQuery = gql`
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }
    `;

    for (const productId of input.productIds) {
      try {
        const normalizedId = normalizeProductId(productId);

        const data = (await shopifyClient.request(deleteQuery, {
          input: { id: normalizedId }
        })) as {
          productDelete: {
            deletedProductId: string | null;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };

        if (data.productDelete.userErrors.length > 0) {
          results.push({
            productId: normalizedId,
            success: false,
            error: data.productDelete.userErrors.map((e) => e.message).join(", ")
          });
        } else {
          results.push({
            productId: normalizedId,
            success: true
          });
        }
      } catch (error) {
        results.push({
          productId: normalizeProductId(productId),
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      summary: {
        total: input.productIds.length,
        deleted: successCount,
        failed: failCount
      },
      results,
      message: `Deleted ${successCount} of ${input.productIds.length} products`
    };
  }
};

export { bulkDeleteProducts };
