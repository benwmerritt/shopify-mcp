import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

/**
 * Escape value for unquoted wildcard searches (like title:*value*)
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

// Input schema for getCollections
const GetCollectionsInputSchema = z.object({
  title: z.string().optional().describe("Filter by collection title (partial match)"),
  type: z.enum(["smart", "custom", "all"]).default("all").describe("Filter by collection type"),
  limit: z.number().default(50).describe("Maximum number of collections to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetCollectionsInput = z.infer<typeof GetCollectionsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getCollections = {
  name: "get-collections",
  description: "List collections with optional filtering by title and type (smart/custom)",
  schema: GetCollectionsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetCollectionsInput) => {
    try {
      // Build query string
      const queryParts: string[] = [];

      if (input.title) {
        queryParts.push(`title:*${escapeWildcardSearch(input.title)}*`);
      }

      if (input.type === "smart") {
        queryParts.push("collection_type:smart");
      } else if (input.type === "custom") {
        queryParts.push("collection_type:custom");
      }

      const queryString = queryParts.length > 0 ? queryParts.join(" AND ") : undefined;

      const query = gql`
        query GetCollections($first: Int!, $query: String, $after: String) {
          collections(first: $first, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                handle
                description
                descriptionHtml
                updatedAt
                productsCount {
                  count
                }
                ruleSet {
                  appliedDisjunctively
                  rules {
                    column
                    condition
                    relation
                  }
                }
                image {
                  url
                  altText
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

      const variables = {
        first: Math.min(input.limit, 250),
        query: queryString,
        after: input.cursor
      };

      const data = (await shopifyClient.request(query, variables)) as {
        collections: {
          edges: Array<{
            cursor: string;
            node: {
              id: string;
              title: string;
              handle: string;
              description: string | null;
              descriptionHtml: string | null;
              updatedAt: string;
              productsCount: { count: number };
              ruleSet: {
                appliedDisjunctively: boolean;
                rules: Array<{
                  column: string;
                  condition: string;
                  relation: string;
                }>;
              } | null;
              image: {
                url: string;
                altText: string | null;
              } | null;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      const collections = data.collections.edges.map((edge) => {
        const collection = edge.node;
        const isSmartCollection = collection.ruleSet !== null;

        return {
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
          description: collection.description,
          type: isSmartCollection ? "smart" : "custom",
          productCount: collection.productsCount.count,
          updatedAt: collection.updatedAt,
          rules: isSmartCollection ? collection.ruleSet : null,
          image: collection.image
        };
      });

      return {
        collections,
        totalCount: collections.length,
        pageInfo: {
          hasNextPage: data.collections.pageInfo.hasNextPage,
          nextCursor: data.collections.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching collections:", error);
      throw new Error(
        `Failed to fetch collections: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getCollections };
