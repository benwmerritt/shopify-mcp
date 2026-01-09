import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

/**
 * Escape value for unquoted wildcard searches (like path:*value*)
 */
function escapeWildcardSearch(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/:/g, "\\:")
    .replace(/\*/g, "\\*")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/'/g, "\\'");
}

// Input schema for getRedirects
const GetRedirectsInputSchema = z.object({
  path: z.string().optional().describe("Filter redirects by source path (partial match)"),
  limit: z.number().default(50).describe("Maximum number of redirects to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetRedirectsInput = z.infer<typeof GetRedirectsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getRedirects = {
  name: "get-redirects",
  description: "List URL redirects with optional filtering by path",
  schema: GetRedirectsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetRedirectsInput) => {
    try {
      // Build query string
      let queryString: string | undefined;
      if (input.path) {
        queryString = `path:*${escapeWildcardSearch(input.path)}*`;
      }

      const query = gql`
        query GetRedirects($first: Int!, $query: String, $after: String) {
          urlRedirects(first: $first, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                path
                target
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
        first: Math.min(input.limit, 250),
        query: queryString,
        after: input.cursor
      })) as {
        urlRedirects: {
          edges: Array<{
            cursor: string;
            node: {
              id: string;
              path: string;
              target: string;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      const redirects = data.urlRedirects.edges.map((edge) => ({
        id: edge.node.id,
        path: edge.node.path,
        target: edge.node.target
      }));

      return {
        redirects,
        totalCount: redirects.length,
        pageInfo: {
          hasNextPage: data.urlRedirects.pageInfo.hasNextPage,
          nextCursor: data.urlRedirects.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching redirects:", error);
      throw new Error(
        `Failed to fetch redirects: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getRedirects };
