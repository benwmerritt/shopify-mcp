import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleting a collection
const DeleteCollectionInputSchema = z.object({
  collectionId: z.string().min(1).describe("Collection ID to delete")
});

type DeleteCollectionInput = z.infer<typeof DeleteCollectionInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const deleteCollection = {
  name: "delete-collection",
  description: "Delete a collection by ID. This does not delete the products in the collection.",
  schema: DeleteCollectionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteCollectionInput) => {
    try {
      const query = gql`
        mutation collectionDelete($input: CollectionDeleteInput!) {
          collectionDelete(input: $input) {
            deletedCollectionId
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          id: input.collectionId
        }
      };

      const data = (await shopifyClient.request(query, variables)) as {
        collectionDelete: {
          deletedCollectionId: string | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors
      if (data.collectionDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete collection: ${data.collectionDelete.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      if (!data.collectionDelete.deletedCollectionId) {
        throw new Error("Collection deletion did not return deleted ID");
      }

      return {
        success: true,
        deletedCollectionId: data.collectionDelete.deletedCollectionId
      };
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw new Error(
        `Failed to delete collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteCollection };
