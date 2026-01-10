import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getProductIssues
const GetProductIssuesInputSchema = z.object({
  issues: z.array(z.enum([
    "zero_inventory",
    "low_stock",
    "missing_images",
    "zero_price"
  ])).optional().describe("Which issues to check (defaults to all)"),
  lowStockThreshold: z.number().default(10).describe("Threshold for low stock warning"),
  sampleSize: z.number().default(10).describe("Number of example products to return per issue")
});

type GetProductIssuesInput = z.infer<typeof GetProductIssuesInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

interface ProductSample {
  id: string;
  title: string;
  handle: string;
  status: string;
}

interface IssueResult {
  count: number;
  products: ProductSample[];
}

const getProductIssues = {
  name: "get-product-issues",
  description: "Audit products for common issues: zero inventory, low stock, missing images, zero price. Returns counts and sample products for each issue.",
  schema: GetProductIssuesInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductIssuesInput) => {
    const issuesToCheck = input.issues || ["zero_inventory", "low_stock", "missing_images", "zero_price"];
    const results: Record<string, IssueResult> = {};
    const lowStockThreshold = input.lowStockThreshold;
    const sampleSize = input.sampleSize;

    try {
      // ==================== API-FILTERABLE ISSUES (FAST) ====================

      // Zero inventory - uses API filter
      if (issuesToCheck.includes("zero_inventory")) {
        const countQuery = gql`
          query ZeroInventoryCount {
            productsCount(limit: null, query: "inventory_total:0") {
              count
            }
          }
        `;
        const countData = await shopifyClient.request(countQuery) as {
          productsCount: { count: number };
        };

        // Get sample products
        const sampleQuery = gql`
          query ZeroInventorySample($first: Int!) {
            products(first: $first, query: "inventory_total:0") {
              edges {
                node {
                  id
                  title
                  handle
                  status
                }
              }
            }
          }
        `;
        const sampleData = await shopifyClient.request(sampleQuery, { first: sampleSize }) as {
          products: { edges: Array<{ node: ProductSample }> };
        };

        results.zeroInventory = {
          count: countData.productsCount.count,
          products: sampleData.products.edges.map(e => e.node)
        };
      }

      // Low stock - uses API filter
      if (issuesToCheck.includes("low_stock")) {
        const countQuery = gql`
          query LowStockCount($query: String!) {
            productsCount(limit: null, query: $query) {
              count
            }
          }
        `;
        const lowStockQuery = `inventory_total:>0 AND inventory_total:<${lowStockThreshold}`;
        const countData = await shopifyClient.request(countQuery, { query: lowStockQuery }) as {
          productsCount: { count: number };
        };

        // Get sample products
        const sampleQuery = gql`
          query LowStockSample($first: Int!, $query: String!) {
            products(first: $first, query: $query) {
              edges {
                node {
                  id
                  title
                  handle
                  status
                }
              }
            }
          }
        `;
        const sampleData = await shopifyClient.request(sampleQuery, { first: sampleSize, query: lowStockQuery }) as {
          products: { edges: Array<{ node: ProductSample }> };
        };

        results.lowStock = {
          count: countData.productsCount.count,
          products: sampleData.products.edges.map(e => e.node)
        };
      }

      // ==================== PAGINATION-REQUIRED ISSUES (FULL SCAN) ====================

      // For missing_images and zero_price, we need to paginate through all products
      const needsFullScan = issuesToCheck.includes("missing_images") || issuesToCheck.includes("zero_price");

      if (needsFullScan) {
        const missingImagesProducts: ProductSample[] = [];
        const zeroPriceProducts: ProductSample[] = [];
        let missingImagesCount = 0;
        let zeroPriceCount = 0;

        let cursor: string | null = null;
        let hasNextPage = true;

        // Paginate through all products
        while (hasNextPage) {
          const paginateQuery = gql`
            query ScanProducts($first: Int!, $after: String) {
              products(first: $first, after: $after) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    title
                    handle
                    status
                    featuredImage {
                      url
                    }
                    priceRangeV2 {
                      minVariantPrice {
                        amount
                      }
                    }
                  }
                }
              }
            }
          `;

          const pageData = await shopifyClient.request(paginateQuery, {
            first: 250,
            after: cursor
          }) as {
            products: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  handle: string;
                  status: string;
                  featuredImage: { url: string } | null;
                  priceRangeV2: { minVariantPrice: { amount: string } };
                };
              }>;
            };
          };

          // Check each product for issues
          for (const edge of pageData.products.edges) {
            const product = edge.node;

            // Check for missing images
            if (issuesToCheck.includes("missing_images")) {
              if (!product.featuredImage) {
                missingImagesCount++;
                if (missingImagesProducts.length < sampleSize) {
                  missingImagesProducts.push({
                    id: product.id,
                    title: product.title,
                    handle: product.handle,
                    status: product.status
                  });
                }
              }
            }

            // Check for zero price
            if (issuesToCheck.includes("zero_price")) {
              const minPrice = parseFloat(product.priceRangeV2.minVariantPrice.amount);
              if (minPrice === 0) {
                zeroPriceCount++;
                if (zeroPriceProducts.length < sampleSize) {
                  zeroPriceProducts.push({
                    id: product.id,
                    title: product.title,
                    handle: product.handle,
                    status: product.status
                  });
                }
              }
            }
          }

          hasNextPage = pageData.products.pageInfo.hasNextPage;
          cursor = pageData.products.pageInfo.endCursor;
        }

        if (issuesToCheck.includes("missing_images")) {
          results.missingImages = {
            count: missingImagesCount,
            products: missingImagesProducts
          };
        }

        if (issuesToCheck.includes("zero_price")) {
          results.zeroPrice = {
            count: zeroPriceCount,
            products: zeroPriceProducts
          };
        }
      }

      // Build summary
      const summary: Record<string, number> = {};
      for (const [key, value] of Object.entries(results)) {
        summary[key] = value.count;
      }

      return {
        summary,
        issues: results,
        settings: {
          lowStockThreshold,
          sampleSize
        }
      };
    } catch (error) {
      console.error("Error auditing product issues:", error);
      throw new Error(
        `Failed to audit product issues: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getProductIssues };
