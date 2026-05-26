import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for bulk product updates
const BulkUpdateProductsInputSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(100).describe("Array of product IDs to update (max 100)"),

  // Fields to update on all products
  update: z.object({
    status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    vendor: z.string().optional(),
    productType: z.string().optional().describe("Product type (e.g., 'Carburetor', 'Filter'). Use empty string to clear."),
    category: z.string().optional().describe("Taxonomy category GID (e.g., 'gid://shopify/TaxonomyCategory/sg-4-17-2-17')"),
    tags: z.array(z.string()).optional().describe("Replace all tags with these"),
    addTags: z.array(z.string()).optional().describe("Add these tags (keeps existing)"),
    removeTags: z.array(z.string()).optional().describe("Remove these specific tags")
  })
});

type BulkUpdateProductsInput = z.infer<typeof BulkUpdateProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

const bulkUpdateProducts = {
  name: "bulk-update-products",
  description: "Update multiple products at once. Supports updating status, vendor, productType, category, and tags (add/remove/replace).",
  schema: BulkUpdateProductsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: BulkUpdateProductsInput) => {
    const results: Array<{
      productId: string;
      success: boolean;
      title?: string;
      error?: string;
    }> = [];

    // For tag operations, we may need to fetch current tags first
    const needsCurrentTags = input.update.addTags || input.update.removeTags;

    for (const productId of input.productIds) {
      try {
        const normalizedId = normalizeProductId(productId);
        let currentTags: string[] = [];

        // Fetch current tags if needed
        if (needsCurrentTags) {
          const fetchQuery = gql`
            query getProductTags($id: ID!) {
              product(id: $id) {
                tags
              }
            }
          `;

          const fetchData = (await shopifyClient.request(fetchQuery, { id: normalizedId })) as {
            product: { tags: string[] } | null;
          };

          currentTags = fetchData.product?.tags || [];
        }

        // Calculate final tags
        let finalTags: string[] | undefined;
        
        if (input.update.tags) {
          // Replace all tags
          finalTags = input.update.tags;
        } else if (input.update.addTags || input.update.removeTags) {
          // Modify existing tags
          finalTags = [...currentTags];
          
          if (input.update.addTags) {
            for (const tag of input.update.addTags) {
              if (!finalTags.includes(tag)) {
                finalTags.push(tag);
              }
            }
          }
          
          if (input.update.removeTags) {
            finalTags = finalTags.filter((t) => !input.update.removeTags!.includes(t));
          }
        }

        // Build update mutation using productSet (supports productType and category)
        const updateQuery = gql`
          mutation productSet($input: ProductSetInput!) {
            productSet(input: $input) {
              product {
                id
                title
                status
                vendor
                productType
                tags
                category {
                  id
                  name
                  fullName
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const updateInput: Record<string, unknown> = {
          id: normalizedId
        };

        if (input.update.status) updateInput.status = input.update.status;
        if (input.update.vendor) updateInput.vendor = input.update.vendor;
        if (input.update.productType !== undefined) updateInput.productType = input.update.productType;
        if (input.update.category) updateInput.category = input.update.category;
        if (finalTags) updateInput.tags = finalTags;

        const updateData = (await shopifyClient.request(updateQuery, { input: updateInput })) as {
          productSet: {
            product: {
              id: string;
              title: string;
              status: string;
              vendor: string;
              productType: string;
              tags: string[];
              category: { id: string; name: string; fullName: string } | null;
            } | null;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };

        if (updateData.productSet.userErrors.length > 0) {
          results.push({
            productId: normalizedId,
            success: false,
            error: updateData.productSet.userErrors.map((e) => e.message).join(", ")
          });
        } else if (updateData.productSet.product) {
          results.push({
            productId: normalizedId,
            success: true,
            title: updateData.productSet.product.title
          });
        }
      } catch (error) {
        results.push({
          productId: normalizeProductId(productId),
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      summary: {
        total: input.productIds.length,
        succeeded: successCount,
        failed: failCount
      },
      results,
      message: `Updated ${successCount} of ${input.productIds.length} products`
    };
  }
};

export { bulkUpdateProducts };
