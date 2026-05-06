import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const GetMetaobjectInputSchema = z.object({
  id: z.string().min(1).describe("Metaobject ID (can be numeric or full GID)")
});

type GetMetaobjectInput = z.infer<typeof GetMetaobjectInputSchema>;

let shopifyClient: GraphQLClient;

function normalizeMetaobjectId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }

  return `gid://shopify/Metaobject/${id}`;
}

const getMetaobject = {
  name: "get-metaobject",
  description: "Get a single Shopify metaobject entry by ID",
  schema: GetMetaobjectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetMetaobjectInput) => {
    try {
      const query = gql`
        query GetMetaobject($id: ID!) {
          node(id: $id) {
            ... on Metaobject {
              id
              type
              handle
              displayName
              updatedAt
              fields {
                key
                value
                type
              }
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        id: normalizeMetaobjectId(input.id)
      })) as {
        node:
          | {
              id: string;
              type: string;
              handle: string;
              displayName: string | null;
              updatedAt: string;
              fields: Array<{
                key: string;
                value: string | null;
                type: string | null;
              }>;
            }
          | null;
      };

      if (!data.node) {
        throw new Error(`Metaobject not found: ${input.id}`);
      }

      return {
        metaobject: {
          id: data.node.id,
          type: data.node.type,
          handle: data.node.handle,
          displayName: data.node.displayName,
          updatedAt: data.node.updatedAt,
          fields: data.node.fields.map((field) => ({
            key: field.key,
            value: field.value,
            type: field.type ?? undefined
          }))
        }
      };
    } catch (error) {
      console.error("Error fetching metaobject:", error);
      throw new Error(
        `Failed to fetch metaobject: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getMetaobject };
