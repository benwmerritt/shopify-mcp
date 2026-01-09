import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Field presets for controlling response size
const FIELD_PRESETS: Record<string, string[] | null> = {
  slim: ["id", "title", "handle", "vendor", "status", "tags"],
  standard: ["id", "title", "handle", "vendor", "status", "tags",
             "description", "productType", "createdAt", "updatedAt",
             "totalInventory", "priceRange", "hasImages"],
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
 * Escape special characters for Shopify search query syntax.
 * Shopify uses a Lucene-like query syntax where certain characters have special meaning.
 */
function escapeSearchQuery(value: string): string {
  // Escape backslashes first, then double quotes
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/**
 * Escape value for unquoted wildcard searches (like title:*value*)
 * These need more aggressive escaping since they're not wrapped in quotes
 */
function escapeWildcardSearch(value: string): string {
  // Escape characters that could break the query syntax
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

// Input schema for searchProducts with advanced filtering
const SearchProductsInputSchema = z.object({
  // Text search
  title: z.string().optional().describe("Filter by product title (partial match)"),
  
  // Status filter
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("Filter by product status"),
  
  // Vendor filter
  vendor: z.string().optional().describe("Filter by vendor name (exact match)"),
  
  // Tag filters
  tag: z.string().optional().describe("Filter products that have this tag"),
  tagNot: z.string().optional().describe("Filter products that do NOT have this tag"),
  
  // Product type
  productType: z.string().optional().describe("Filter by product type"),
  
  // Inventory filters
  inventoryTotal: z.number().optional().describe("Filter by exact inventory count"),
  inventoryLessThan: z.number().optional().describe("Filter products with inventory less than this"),
  inventoryGreaterThan: z.number().optional().describe("Filter products with inventory greater than this"),
  
  // Date filters
  createdAfter: z.string().optional().describe("Filter products created after this date (ISO 8601)"),
  createdBefore: z.string().optional().describe("Filter products created before this date (ISO 8601)"),
  updatedAfter: z.string().optional().describe("Filter products updated after this date (ISO 8601)"),
  
  // Has images filter
  hasImages: z.boolean().optional().describe("Filter products that have (true) or don't have (false) images"),
  
  // Pagination
  limit: z.number().default(50).describe("Maximum number of products to return (max 250)"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page"),

  // Response fields control
  fields: z.union([
    z.enum(["slim", "standard", "full"]),
    z.array(z.string())
  ]).default("slim").describe("Fields to return: 'slim' (default), 'standard', 'full', or array of field names")
});

type SearchProductsInput = z.infer<typeof SearchProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const searchProducts = {
  name: "search-products",
  description: "Advanced product search with filters for status, vendor, tags, inventory, dates, and more",
  schema: SearchProductsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SearchProductsInput) => {
    try {
      // Build query string from filters
      const queryParts: string[] = [];

      if (input.title) {
        queryParts.push(`title:*${escapeWildcardSearch(input.title)}*`);
      }

      if (input.status) {
        // Status is from enum, no escaping needed
        queryParts.push(`status:${input.status}`);
      }

      if (input.vendor) {
        queryParts.push(`vendor:"${escapeSearchQuery(input.vendor)}"`);
      }

      if (input.tag) {
        queryParts.push(`tag:"${escapeSearchQuery(input.tag)}"`);
      }

      if (input.tagNot) {
        queryParts.push(`-tag:"${escapeSearchQuery(input.tagNot)}"`);
      }

      if (input.productType) {
        queryParts.push(`product_type:"${escapeSearchQuery(input.productType)}"`);
      }

      if (input.inventoryTotal !== undefined) {
        // Numbers don't need escaping
        queryParts.push(`inventory_total:${input.inventoryTotal}`);
      }

      if (input.inventoryLessThan !== undefined) {
        queryParts.push(`inventory_total:<${input.inventoryLessThan}`);
      }

      if (input.inventoryGreaterThan !== undefined) {
        queryParts.push(`inventory_total:>${input.inventoryGreaterThan}`);
      }

      if (input.createdAfter) {
        queryParts.push(`created_at:>'${escapeSearchQuery(input.createdAfter)}'`);
      }

      if (input.createdBefore) {
        queryParts.push(`created_at:<'${escapeSearchQuery(input.createdBefore)}'`);
      }

      if (input.updatedAfter) {
        queryParts.push(`updated_at:>'${escapeSearchQuery(input.updatedAfter)}'`);
      }

      const queryString = queryParts.length > 0 ? queryParts.join(" AND ") : undefined;

      const query = gql`
        query SearchProducts($first: Int!, $query: String, $after: String) {
          products(first: $first, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                description
                handle
                status
                vendor
                productType
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
                      id
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
        products: {
          edges: Array<{
            cursor: string;
            node: any;
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      // Post-filter for hasImages if specified (API doesn't support this directly)
      let products = data.products.edges.map((edge) => {
        const product = edge.node;
        const hasImagesFlag = product.images.edges.length > 0;

        return {
          id: product.id,
          title: product.title,
          description: product.description,
          handle: product.handle,
          status: product.status,
          vendor: product.vendor,
          productType: product.productType,
          tags: product.tags,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          totalInventory: product.totalInventory,
          hasImages: hasImagesFlag,
          priceRange: {
            minPrice: product.priceRangeV2.minVariantPrice,
            maxPrice: product.priceRangeV2.maxVariantPrice
          },
          firstImage: product.images.edges[0]?.node || null,
          variants: product.variants.edges.map((v: any) => v.node)
        };
      });

      // Track if post-filtering is applied
      const unfilteredCount = products.length;
      const isPostFiltered = input.hasImages !== undefined;

      // Apply hasImages filter if specified
      if (isPostFiltered) {
        products = products.filter((p) => p.hasImages === input.hasImages);
      }

      // Apply field filtering based on fields parameter
      const requestedFields = resolveFields(input.fields);
      const filteredProducts = products.map((p) => filterProductFields(p, requestedFields));

      // Build response with accurate pagination info
      const response: {
        products: Record<string, unknown>[];
        totalCount: number;
        pageInfo: {
          hasNextPage: boolean;
          nextCursor: string | null;
          note?: string;
        };
        query: string;
        fields: string | string[];
        filtering?: {
          postFiltered: boolean;
          unfilteredCount: number;
          filteredCount: number;
          removedByFilter: number;
        };
      } = {
        products: filteredProducts,
        totalCount: filteredProducts.length,
        pageInfo: {
          hasNextPage: data.products.pageInfo.hasNextPage,
          nextCursor: data.products.pageInfo.endCursor
        },
        query: queryString || "(all products)",
        fields: input.fields
      };

      // When post-filtering is applied, pagination becomes approximate
      // Add metadata to help clients understand the situation
      if (isPostFiltered) {
        response.filtering = {
          postFiltered: true,
          unfilteredCount,
          filteredCount: products.length,
          removedByFilter: unfilteredCount - products.length
        };
        response.pageInfo.note = 
          "hasImages filter is applied client-side. Pagination reflects API results before filtering. " +
          "More pages may contain additional matching results even if current page has few matches.";
        
        // If we filtered out all results but API has more pages, 
        // hasNextPage should still be true since next page might have matches
        // (This is already the case, but we're being explicit about the behavior)
      }

      return response;
    } catch (error) {
      console.error("Error searching products:", error);
      throw new Error(
        `Failed to search products: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { searchProducts };
