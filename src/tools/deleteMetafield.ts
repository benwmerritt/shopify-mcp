import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleteMetafield
const DeleteMetafieldInputSchema = z.object({
  metafieldId: z.string().min(1).describe("Metafield ID to delete (can be numeric or full GID)")
});

type DeleteMetafieldInput = z.infer<typeof DeleteMetafieldInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize metafield ID to GID format
function normalizeMetafieldId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Metafield/${id}`;
}

const deleteMetafield = {
  name: "delete-metafield",
  description: "Delete a specific metafield by ID",
  schema: DeleteMetafieldInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteMetafieldInput) => {
    try {
      const metafieldId = normalizeMetafieldId(input.metafieldId);

      const query = gql`
        mutation metafieldDelete($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) {
            deletedId
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        input: {
          id: metafieldId
        }
      })) as {
        metafieldDelete: {
          deletedId: string | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.metafieldDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete metafield: ${data.metafieldDelete.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      return {
        success: true,
        deletedId: data.metafieldDelete.deletedId,
        message: `Metafield ${data.metafieldDelete.deletedId} has been deleted`
      };
    } catch (error) {
      console.error("Error deleting metafield:", error);
      throw new Error(
        `Failed to delete metafield: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteMetafield };
