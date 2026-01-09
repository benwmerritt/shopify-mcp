import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for managing collection products
const ManageCollectionProductsInputSchema = z.object({
  collectionId: z.string().min(1).describe("Collection ID (can be numeric or full GID)"),
  action: z.enum(["add", "remove", "list"]).describe("Action to perform"),
  productIds: z.array(z.string()).optional().describe("Product IDs to add or remove (required for add/remove)")
});

type ManageCollectionProductsInput = z.infer<typeof ManageCollectionProductsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize collection ID to GID format
function normalizeCollectionId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Collection/${id}`;
}

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

const manageCollectionProducts = {
  name: "manage-collection-products",
  description: "Add products to a collection, remove products from a collection, or list products in a collection",
  schema: ManageCollectionProductsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ManageCollectionProductsInput) => {
    try {
      const collectionId = normalizeCollectionId(input.collectionId);

      if (input.action === "list") {
        // List products in collection
        const listQuery = gql`
          query GetCollectionProducts($id: ID!, $first: Int!) {
            collection(id: $id) {
              id
              title
              productsCount {
                count
              }
              products(first: $first) {
                edges {
                  node {
                    id
                    title
                    handle
                    status
                    totalInventory
                  }
                }
              }
            }
          }
        `;

        const data = (await shopifyClient.request(listQuery, { id: collectionId, first: 250 })) as {
          collection: {
            id: string;
            title: string;
            productsCount: { count: number };
            products: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  handle: string;
                  status: string;
                  totalInventory: number;
                };
              }>;
            };
          } | null;
        };

        if (!data.collection) {
          throw new Error(`Collection ${input.collectionId} not found`);
        }

        return {
          action: "list",
          collection: {
            id: data.collection.id,
            title: data.collection.title,
            productCount: data.collection.productsCount.count
          },
          products: data.collection.products.edges.map((e) => e.node)
        };
      }

      if (!input.productIds || input.productIds.length === 0) {
        throw new Error("productIds is required for add/remove actions");
      }

      const productIds = input.productIds.map(normalizeProductId);

      if (input.action === "add") {
        // Add products to collection
        const addQuery = gql`
          mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) {
              collection {
                id
                title
                productsCount {
                  count
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const data = (await shopifyClient.request(addQuery, {
          id: collectionId,
          productIds
        })) as {
          collectionAddProducts: {
            collection: {
              id: string;
              title: string;
              productsCount: { count: number };
            } | null;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };

        if (data.collectionAddProducts.userErrors.length > 0) {
          throw new Error(
            `Failed to add products: ${data.collectionAddProducts.userErrors
              .map((e) => e.message)
              .join(", ")}`
          );
        }

        return {
          action: "add",
          success: true,
          collection: data.collectionAddProducts.collection,
          addedCount: productIds.length,
          message: `Added ${productIds.length} product(s) to collection`
        };
      }

      if (input.action === "remove") {
        // Remove products from collection
        const removeQuery = gql`
          mutation collectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
            collectionRemoveProducts(id: $id, productIds: $productIds) {
              job {
                id
                done
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const data = (await shopifyClient.request(removeQuery, {
          id: collectionId,
          productIds
        })) as {
          collectionRemoveProducts: {
            job: { id: string; done: boolean } | null;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };

        if (data.collectionRemoveProducts.userErrors.length > 0) {
          throw new Error(
            `Failed to remove products: ${data.collectionRemoveProducts.userErrors
              .map((e) => e.message)
              .join(", ")}`
          );
        }

        return {
          action: "remove",
          success: true,
          removedCount: productIds.length,
          message: `Removed ${productIds.length} product(s) from collection`
        };
      }

      throw new Error(`Unknown action: ${input.action}`);
    } catch (error) {
      console.error("Error managing collection products:", error);
      throw new Error(
        `Failed to manage collection products: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { manageCollectionProducts };
