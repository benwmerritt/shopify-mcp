import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for taxonomy search
const SearchTaxonomyInputSchema = z.object({
  search: z.string().optional().describe("Search term to find categories (e.g., 'carburetor', 'fuel')"),
  childrenOf: z.string().optional().describe("Category GID to get direct children of"),
  siblingsOf: z.string().optional().describe("Category GID to get siblings of"),
  descendantsOf: z.string().optional().describe("Category GID to get all descendants of"),
  limit: z.number().default(25).describe("Maximum number of categories to return"),
  includeAttributes: z
    .boolean()
    .default(false)
    .describe(
      "Also return each category's standard attributes (e.g., Color, Material) and, for choice-list attributes, their allowed values. Use to discover what category-specific fields exist."
    )
});

type SearchTaxonomyInput = z.infer<typeof SearchTaxonomyInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Attributes selection set. Kept separate so we can retry without it if a
// given Admin API version does not support this exact shape.
const ATTRIBUTES_FRAGMENT = `
  attributes(first: 50) {
    edges {
      node {
        __typename
        ... on TaxonomyAttribute {
          id
        }
        ... on TaxonomyChoiceListAttribute {
          id
          name
          values(first: 50) {
            nodes {
              id
              name
            }
          }
        }
        ... on TaxonomyMeasurementAttribute {
          id
          name
        }
      }
    }
  }
`;

function buildQuery(withAttributes: boolean): string {
  return `
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
              ${withAttributes ? ATTRIBUTES_FRAGMENT : ""}
            }
          }
        }
      }
    }
  `;
}

type AttributeNode = {
  __typename: string;
  id: string;
  name?: string | null;
  values?: { nodes: Array<{ id: string; name: string }> };
};

type CategoryNode = {
  id: string;
  name: string;
  fullName: string;
  level: number;
  isLeaf: boolean;
  isRoot: boolean;
  parentId: string | null;
  childrenIds: string[];
  ancestorIds: string[];
  attributes?: { edges: Array<{ node: AttributeNode }> };
};

function formatAttributes(node: CategoryNode) {
  if (!node.attributes) return undefined;
  return node.attributes.edges.map((edge) => {
    const attr = edge.node;
    if (attr.__typename === "TaxonomyChoiceListAttribute") {
      return {
        id: attr.id,
        name: attr.name,
        kind: "choice_list",
        values: attr.values?.nodes ?? []
      };
    }
    if (attr.__typename === "TaxonomyMeasurementAttribute") {
      return { id: attr.id, name: attr.name, kind: "measurement" };
    }
    // Plain TaxonomyAttribute exposes only an id on this API version.
    return { id: attr.id, kind: "attribute" };
  });
}

const searchTaxonomy = {
  name: "search-taxonomy",
  description: "Search Shopify's standardized product taxonomy categories. Use to find category IDs for setting product categories. Call with no arguments to get top-level categories. Set includeAttributes to also see each category's attributes and option values.",
  schema: SearchTaxonomyInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SearchTaxonomyInput) => {
    const variables: Record<string, unknown> = {
      first: input.limit
    };
    if (input.search) variables.search = input.search;
    if (input.childrenOf) variables.childrenOf = input.childrenOf;
    if (input.siblingsOf) variables.siblingsOf = input.siblingsOf;
    if (input.descendantsOf) variables.descendantsOf = input.descendantsOf;

    type TaxonomyResponse = {
      taxonomy: { categories: { edges: Array<{ node: CategoryNode }> } };
    };

    async function run(withAttributes: boolean): Promise<TaxonomyResponse> {
      return (await shopifyClient.request(
        gql`
          ${buildQuery(withAttributes)}
        `,
        variables
      )) as TaxonomyResponse;
    }

    try {
      let attributesError: string | undefined;
      let data: TaxonomyResponse;

      if (input.includeAttributes) {
        try {
          data = await run(true);
        } catch (attrError) {
          // The attributes selection set may not be supported on this API
          // version; fall back to the base query so the tool still works.
          attributesError = `Could not fetch category attributes: ${
            attrError instanceof Error ? attrError.message : String(attrError)
          }`;
          data = await run(false);
        }
      } else {
        data = await run(false);
      }

      const categories = data.taxonomy.categories.edges.map((edge) => {
        const node = edge.node;
        const formatted: Record<string, unknown> = {
          id: node.id,
          name: node.name,
          fullName: node.fullName,
          level: node.level,
          isLeaf: node.isLeaf,
          isRoot: node.isRoot,
          parentId: node.parentId,
          childrenIds: node.childrenIds,
          ancestorIds: node.ancestorIds
        };
        const attributes = formatAttributes(node);
        if (attributes) formatted.attributes = attributes;
        return formatted;
      });

      return {
        categories,
        count: categories.length,
        ...(attributesError ? { attributesError } : {}),
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
