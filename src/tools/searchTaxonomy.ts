import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for taxonomy search
const SearchTaxonomyInputSchema = z.object({
  search: z.string().optional().describe("Search term to find categories (e.g., 'carburetor', 'fuel')"),
  childrenOf: z.string().optional().describe("Category GID to get direct children of"),
  siblingsOf: z.string().optional().describe("Category GID to get siblings of"),
  descendantsOf: z.string().optional().describe("Category GID to get all descendants of"),
  limit: z.number().default(25).describe("Maximum number of categories to return")
});

type SearchTaxonomyInput = z.infer<typeof SearchTaxonomyInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const searchTaxonomy = {
  name: "search-taxonomy",
  description: "Search Shopify's standardized product taxonomy categories. Use to find category IDs for setting product categories. Call with no arguments to get top-level categories.",
  schema: SearchTaxonomyInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SearchTaxonomyInput) => {
    try {
      const query = gql`
        query SearchTaxonomy(
          $search: String
          $childrenOf: ID
          $siblingsOf: ID
          $descendantsOf: ID
          $first: Int
        ) {
          taxonomy {
            categories(
              search: $search
              childrenOf: $childrenOf
              siblingsOf: $siblingsOf
              descendantsOf: $descendantsOf
              first: $first
            ) {
              edges {
                node {
                  id
                  name
                  fullName
                  level
                  isLeaf
                  isRoot
                  parentId
                  childrenIds
                  ancestorIds
                }
              }
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        first: input.limit
      };

      if (input.search) variables.search = input.search;
      if (input.childrenOf) variables.childrenOf = input.childrenOf;
      if (input.siblingsOf) variables.siblingsOf = input.siblingsOf;
      if (input.descendantsOf) variables.descendantsOf = input.descendantsOf;

      const data = (await shopifyClient.request(query, variables)) as {
        taxonomy: {
          categories: {
            edges: Array<{
              node: {
                id: string;
                name: string;
                fullName: string;
                level: number;
                isLeaf: boolean;
                isRoot: boolean;
                parentId: string | null;
                childrenIds: string[];
                ancestorIds: string[];
              };
            }>;
          };
        };
      };

      const categories = data.taxonomy.categories.edges.map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        fullName: edge.node.fullName,
        level: edge.node.level,
        isLeaf: edge.node.isLeaf,
        isRoot: edge.node.isRoot,
        parentId: edge.node.parentId,
        childrenIds: edge.node.childrenIds,
        ancestorIds: edge.node.ancestorIds
      }));

      return {
        categories,
        count: categories.length,
        hint: categories.length > 0
          ? "Use the 'id' field (e.g., 'gid://shopify/TaxonomyCategory/...') when setting product category"
          : "No categories found. Try a different search term or use childrenOf/descendantsOf to browse."
      };
    } catch (error) {
      console.error("Error searching taxonomy:", error);
      throw new Error(
        `Failed to search taxonomy: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { searchTaxonomy };
