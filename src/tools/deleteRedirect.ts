import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleteRedirect
const DeleteRedirectInputSchema = z.object({
  redirectId: z.string().min(1).describe("Redirect ID to delete (can be numeric or full GID)")
});

type DeleteRedirectInput = z.infer<typeof DeleteRedirectInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize redirect ID to GID format
function normalizeRedirectId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/UrlRedirect/${id}`;
}

const deleteRedirect = {
  name: "delete-redirect",
  description: "Delete a URL redirect by ID",
  schema: DeleteRedirectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteRedirectInput) => {
    try {
      const redirectId = normalizeRedirectId(input.redirectId);

      const query = gql`
        mutation urlRedirectDelete($id: ID!) {
          urlRedirectDelete(id: $id) {
            deletedUrlRedirectId
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        id: redirectId
      })) as {
        urlRedirectDelete: {
          deletedUrlRedirectId: string | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.urlRedirectDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete redirect: ${data.urlRedirectDelete.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      return {
        success: true,
        deletedId: data.urlRedirectDelete.deletedUrlRedirectId,
        message: `Redirect ${data.urlRedirectDelete.deletedUrlRedirectId} has been deleted`
      };
    } catch (error) {
      console.error("Error deleting redirect:", error);
      throw new Error(
        `Failed to delete redirect: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteRedirect };
