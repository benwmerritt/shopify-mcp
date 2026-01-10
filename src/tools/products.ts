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
 */
function escapeSearchQuery(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
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

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

// Input schema for unified products tool
const ProductsInputSchema = z.object({
  // Single product mode - if provided, fetches one product by ID
  id: z.string().optional().describe("Product ID for single product lookup (can be numeric or full GID)"),

  // Search/filter mode - used when id is not provided
  title: z.string().optional().describe("Filter by product title (partial match)"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("Filter by product status"),
  vendor: z.string().optional().describe("Filter by vendor name (exact match)"),
  tag: z.string().optional().describe("Filter products that have this tag"),
  tagNot: z.string().optional().describe("Filter products that do NOT have this tag"),
  productType: z.string().optional().describe("Filter by product type"),
  inventoryTotal: z.number().optional().describe("Filter by exact inventory count"),
  inventoryLessThan: z.number().optional().describe("Filter products with inventory less than this"),
  inventoryGreaterThan: z.number().optional().describe("Filter products with inventory greater than this"),
  createdAfter: z.string().optional().describe("Filter products created after this date (ISO 8601)"),
  createdBefore: z.string().optional().describe("Filter products created before this date (ISO 8601)"),
  updatedAfter: z.string().optional().describe("Filter products updated after this date (ISO 8601)"),
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

type ProductsInput = z.infer<typeof ProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const products = {
  name: "products",
  description: "Get products by ID or search/filter products. Use 'id' for single product lookup, or use filters (title, status, vendor, tags, etc.) to search.",
  schema: ProductsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ProductsInput) => {
    try {
      // SINGLE PRODUCT MODE - when id is provided
      if (input.id) {
        const productId = normalizeProductId(input.id);

        const query = gql`
          query GetProductById($id: ID!) {
            product(id: $id) {
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
              images(first: 10) {
                edges {
                  node {
                    id
                    url
                    altText
                    width
                    height
                  }
                }
              }
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    price
                    inventoryQuantity
                    sku
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
              collections(first: 10) {
                edges {
                  node {
                    id
                    title
                  }
                }
              }
            }
          }
        `;

        const data = (await shopifyClient.request(query, { id: productId })) as {
          product: any;
        };

        if (!data.product) {
          throw new Error(`Product not found: ${input.id}`);
        }

        const product = data.product;
        const hasImagesFlag = product.images.edges.length > 0;

        const formattedProduct = {
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
          images: product.images.edges.map((edge: any) => edge.node),
          variants: product.variants.edges.map((edge: any) => ({
            ...edge.node,
            options: edge.node.selectedOptions
          })),
          collections: product.collections.edges.map((edge: any) => edge.node)
        };

        // Apply field filtering
        const requestedFields = resolveFields(input.fields);
        const filteredProduct = filterProductFields(formattedProduct, requestedFields);

        return { product: filteredProduct, fields: input.fields };
      }

      // SEARCH/LIST MODE - when no id provided
      const queryParts: string[] = [];

      if (input.title) {
        queryParts.push(`title:*${escapeWildcardSearch(input.title)}*`);
      }

      if (input.status) {
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

      // Format products
      let productsList = data.products.edges.map((edge) => {
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
      const unfilteredCount = productsList.length;
      const isPostFiltered = input.hasImages !== undefined;

      // Apply hasImages filter if specified (client-side filter)
      if (isPostFiltered) {
        productsList = productsList.filter((p) => p.hasImages === input.hasImages);
      }

      // Apply field filtering
      const requestedFields = resolveFields(input.fields);
      const filteredProducts = productsList.map((p) => filterProductFields(p, requestedFields));

      // Build response
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

      // Add post-filter metadata when applicable
      if (isPostFiltered) {
        response.filtering = {
          postFiltered: true,
          unfilteredCount,
          filteredCount: productsList.length,
          removedByFilter: unfilteredCount - productsList.length
        };
        response.pageInfo.note =
          "hasImages filter is applied client-side. Pagination reflects API results before filtering.";
      }

      return response;
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

export { products };
