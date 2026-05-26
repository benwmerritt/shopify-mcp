import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const DeleteMetaobjectInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Metaobject entry ID to delete (numeric or full GID)")
});

type DeleteMetaobjectInput = z.infer<typeof DeleteMetaobjectInputSchema>;

let shopifyClient: GraphQLClient;

function normalizeMetaobjectId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }

  return `gid://shopify/Metaobject/${id}`;
}

const deleteMetaobject = {
  name: "delete-metaobject",
  description: "Delete an existing Shopify metaobject entry by ID",
  schema: DeleteMetaobjectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteMetaobjectInput) => {
    try {
      const mutation = gql`
        mutation DeleteMetaobject($id: ID!) {
          metaobjectDelete(id: $id) {
            deletedId
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const data = (await shopifyClient.request(mutation, {
        id: normalizeMetaobjectId(input.id)
      })) as {
        metaobjectDelete: {
          deletedId: string | null;
          userErrors: Array<{
            field: string[];
            message: string;
            code?: string;
          }>;
        };
      };

      if (data.metaobjectDelete.userErrors.length > 0) {
        throw new Error(
          data.metaobjectDelete.userErrors
            .map((error) =>
              error.code ? `${error.code}: ${error.message}` : error.message
            )
            .join(", ")
        );
      }

      return {
        success: true,
        deletedId: data.metaobjectDelete.deletedId
      };
    } catch (error) {
      console.error("Error deleting metaobject:", error);
      throw new Error(
        `Failed to delete metaobject: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteMetaobject };
