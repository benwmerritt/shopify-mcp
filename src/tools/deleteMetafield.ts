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

      const lookupQuery = gql`
        query metafieldIdentifier($id: ID!) {
          node(id: $id) {
            ... on Metafield {
              id
              namespace
              key
              owner {
                id
              }
            }
          }
        }
      `;

      const lookupData = (await shopifyClient.request(lookupQuery, {
        id: metafieldId
      })) as {
        node: {
          id: string;
          namespace: string;
          key: string;
          owner: { id: string };
        } | null;
      };

      if (!lookupData.node) {
        throw new Error(`Metafield ${metafieldId} was not found`);
      }

      const query = gql`
        mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields {
              ownerId
              namespace
              key
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const identifier = {
        ownerId: lookupData.node.owner.id,
        namespace: lookupData.node.namespace,
        key: lookupData.node.key
      };

      const data = (await shopifyClient.request(query, {
        metafields: [identifier]
      })) as {
        metafieldsDelete: {
          deletedMetafields: Array<{
            ownerId: string;
            namespace: string;
            key: string;
          }>;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.metafieldsDelete.userErrors.length > 0) {
        throw new Error(
          `Failed to delete metafield: ${data.metafieldsDelete.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      if (data.metafieldsDelete.deletedMetafields.length === 0) {
        throw new Error(`Shopify did not confirm deletion of ${metafieldId}`);
      }

      return {
        success: true,
        deletedId: metafieldId,
        message: `Metafield ${metafieldId} has been deleted`
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
