import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleteProduct
const DeleteProductInputSchema = z.object({
  productId: z.string().min(1).describe("Product ID (can be numeric or full GID)")
});

type DeleteProductInput = z.infer<typeof DeleteProductInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

const deleteProduct = {
  name: "delete-product",
  description: "Delete a product from the store. This action is irreversible.",
  schema: DeleteProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteProductInput) => {
    try {
      const productId = normalizeProductId(input.productId);

      const query = gql`
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

      const variables = {
        input: {
          id: productId
        }
      };

      const data = (await shopifyClient.request(query, variables)) as {
        productDelete: {
          deletedProductId: string | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors
      if (data.productDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete product: ${data.productDelete.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      return {
        success: true,
        deletedProductId: data.productDelete.deletedProductId,
        message: `Product ${data.productDelete.deletedProductId} has been deleted`
      };
    } catch (error) {
      console.error("Error deleting product:", error);
      throw new Error(
        `Failed to delete product: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteProduct };
