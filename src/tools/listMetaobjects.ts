import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const ListMetaobjectsInputSchema = z.object({
  type: z.string().min(1).describe("Metaobject definition type to list entries for"),
  limit: z
    .number()
    .default(25)
    .describe("Maximum number of metaobject entries to return (max 250)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor for fetching the next page"),
  status: z
    .enum(["ACTIVE", "DRAFT"])
    .optional()
    .describe(
      "Filter the returned page to only ACTIVE or DRAFT entries (publishable definitions). Note: filtered client-side within the fetched page; status is always included on each entry regardless."
    )
});

type ListMetaobjectsInput = z.infer<typeof ListMetaobjectsInputSchema>;

let shopifyClient: GraphQLClient;

const listMetaobjects = {
  name: "list-metaobjects",
  description: "List entries for an existing Shopify metaobject definition",
  schema: ListMetaobjectsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ListMetaobjectsInput) => {
    try {
      const query = gql`
        query ListMetaobjects($type: String!, $first: Int!, $after: String) {
          metaobjects(type: $type, first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                type
                handle
                displayName
                updatedAt
                capabilities {
                  publishable {
                    status
                  }
                }
                fields {
                  key
                  value
                  type
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        type: input.type,
        first: Math.min(input.limit, 250),
        after: input.cursor
      })) as {
        metaobjects: {
          edges: Array<{
            cursor: string;
            node: {
              id: string;
              type: string;
              handle: string;
              displayName: string | null;
              updatedAt: string;
              capabilities?: { publishable?: { status: string } | null } | null;
              fields: Array<{
                key: string;
                value: string | null;
                type: string | null;
              }>;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      let metaobjects = data.metaobjects.edges.map((edge) => ({
        id: edge.node.id,
        type: edge.node.type,
        handle: edge.node.handle,
        displayName: edge.node.displayName,
        status: edge.node.capabilities?.publishable?.status ?? null,
        updatedAt: edge.node.updatedAt,
        fields: edge.node.fields.map((field) => ({
          key: field.key,
          value: field.value,
          type: field.type ?? undefined
        }))
      }));

      if (input.status) {
        metaobjects = metaobjects.filter((m) => m.status === input.status);
      }

      return {
        type: input.type,
        metaobjects,
        pageInfo: {
          hasNextPage: data.metaobjects.pageInfo.hasNextPage,
          nextCursor: data.metaobjects.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error listing metaobjects:", error);
      throw new Error(
        `Failed to list metaobjects: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { listMetaobjects };
