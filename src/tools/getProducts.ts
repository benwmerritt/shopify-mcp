import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Field presets for controlling response size
const FIELD_PRESETS: Record<string, string[] | null> = {
  slim: ["id", "title", "handle", "vendor", "status", "tags"],
  standard: ["id", "title", "handle", "vendor", "status", "tags",
             "description", "createdAt", "updatedAt",
             "totalInventory", "priceRange"],
  full: null  // return everything
};

// Filter product object to only include requested fields
function filterProductFields(product: Record<string, unknown>, fields: string[] | null): Record<string, unknown> {
  if (fields === null) return product; // full - return everything

  const filtered: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in product) {
      filtered[field] = product[field];
    }
  }
  return filtered;
}

// Resolve fields parameter to actual field list
function resolveFields(fields: string | string[]): string[] | null {
  if (typeof fields === "string") {
    return FIELD_PRESETS[fields] ?? FIELD_PRESETS.slim;
  }
  return fields;
}

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

// Input schema for getProducts
const GetProductsInputSchema = z.object({
  searchTitle: z.string().optional(),
  limit: z.number().default(10),
  fields: z.union([
    z.enum(["slim", "standard", "full"]),
    z.array(z.string())
  ]).default("slim").describe("Fields to return: 'slim' (default), 'standard', 'full', or array of field names")
});

type GetProductsInput = z.infer<typeof GetProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getProducts = {
  name: "get-products",
  description: "Get all products or search by title",
  schema: GetProductsInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductsInput) => {
    try {
      const { searchTitle, limit } = input;

      // Create query based on whether we're searching by title or not
      const query = gql`
        query GetProducts($first: Int!, $query: String) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                description
                handle
                status
                vendor
                tags
                createdAt
                updatedAt
                totalInventory
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                  maxVariantPrice {
                    amount
                    currencyCode
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                variants(first: 5) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                      sku
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        first: limit,
        query: searchTitle ? `title:*${escapeWildcardSearch(searchTitle)}*` : undefined
      };

      const data = (await shopifyClient.request(query, variables)) as {
        products: any;
      };

      // Extract and format product data
      const products = data.products.edges.map((edge: any) => {
        const product = edge.node;

        // Format variants
        const variants = product.variants.edges.map((variantEdge: any) => ({
          id: variantEdge.node.id,
          title: variantEdge.node.title,
          price: variantEdge.node.price,
          inventoryQuantity: variantEdge.node.inventoryQuantity,
          sku: variantEdge.node.sku
        }));

        // Get first image if it exists
        const imageUrl =
          product.images.edges.length > 0
            ? product.images.edges[0].node.url
            : null;

        return {
          id: product.id,
          title: product.title,
          description: product.description,
          handle: product.handle,
          status: product.status,
          vendor: product.vendor,
          tags: product.tags,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          totalInventory: product.totalInventory,
          priceRange: {
            minPrice: {
              amount: product.priceRangeV2.minVariantPrice.amount,
              currencyCode: product.priceRangeV2.minVariantPrice.currencyCode
            },
            maxPrice: {
              amount: product.priceRangeV2.maxVariantPrice.amount,
              currencyCode: product.priceRangeV2.maxVariantPrice.currencyCode
            }
          },
          imageUrl,
          variants
        };
      });

      // Apply field filtering based on fields parameter
      const requestedFields = resolveFields(input.fields);
      const filteredProducts = products.map((p: Record<string, unknown>) => filterProductFields(p, requestedFields));

      return { products: filteredProducts, fields: input.fields };
    } catch (error) {
      console.error("Error fetching products:", error);
      throw new Error(
        `Failed to fetch products: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getProducts };
