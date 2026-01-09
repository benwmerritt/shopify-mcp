import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getInventoryLevels
const GetInventoryLevelsInputSchema = z.object({
  productId: z.string().optional().describe("Filter by product ID to see inventory for that product"),
  locationId: z.string().optional().describe("Filter by location ID"),
  limit: z.number().default(50).describe("Maximum number of inventory items to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetInventoryLevelsInput = z.infer<typeof GetInventoryLevelsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

const getInventoryLevels = {
  name: "get-inventory-levels",
  description: "Get inventory levels across locations, optionally filtered by product",
  schema: GetInventoryLevelsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetInventoryLevelsInput) => {
    try {
      // If product ID is provided, get inventory for that product's variants
      if (input.productId) {
        const productId = normalizeProductId(input.productId);

        const productQuery = gql`
          query GetProductInventory($id: ID!) {
            product(id: $id) {
              id
              title
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    inventoryItem {
                      id
                      tracked
                      inventoryLevels(first: 10) {
                        edges {
                          node {
                            id
                            quantities(names: ["available", "on_hand", "committed", "incoming"]) {
                              name
                              quantity
                            }
                            location {
                              id
                              name
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const data = (await shopifyClient.request(productQuery, { id: productId })) as {
          product: {
            id: string;
            title: string;
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  sku: string | null;
                  inventoryItem: {
                    id: string;
                    tracked: boolean;
                    inventoryLevels: {
                      edges: Array<{
                        node: {
                          id: string;
                          quantities: Array<{
                            name: string;
                            quantity: number;
                          }>;
                          location: {
                            id: string;
                            name: string;
                          };
                        };
                      }>;
                    };
                  };
                };
              }>;
            };
          } | null;
        };

        if (!data.product) {
          throw new Error(`Product ${input.productId} not found`);
        }

        const inventoryByVariant = data.product.variants.edges.map((variantEdge) => {
          const variant = variantEdge.node;
          const levels = variant.inventoryItem.inventoryLevels.edges.map((levelEdge) => {
            const level = levelEdge.node;
            const quantities: Record<string, number> = {};
            level.quantities.forEach((q) => {
              quantities[q.name] = q.quantity;
            });
            return {
              locationId: level.location.id,
              locationName: level.location.name,
              ...quantities
            };
          });

          return {
            variantId: variant.id,
            variantTitle: variant.title,
            sku: variant.sku,
            inventoryItemId: variant.inventoryItem.id,
            tracked: variant.inventoryItem.tracked,
            levels
          };
        });

        return {
          product: {
            id: data.product.id,
            title: data.product.title
          },
          inventory: inventoryByVariant
        };
      }

      // Otherwise, list locations and their inventory
      const locationsQuery = gql`
        query GetLocations($first: Int!, $after: String) {
          locations(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                name
                address {
                  address1
                  city
                  province
                  country
                }
                isActive
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

      const data = (await shopifyClient.request(locationsQuery, {
        first: Math.min(input.limit, 250),
        after: input.cursor
      })) as {
        locations: {
          edges: Array<{
            cursor: string;
            node: {
              id: string;
              name: string;
              address: {
                address1: string | null;
                city: string | null;
                province: string | null;
                country: string | null;
              };
              isActive: boolean;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      const locations = data.locations.edges.map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        address: edge.node.address,
        isActive: edge.node.isActive
      }));

      return {
        locations,
        pageInfo: {
          hasNextPage: data.locations.pageInfo.hasNextPage,
          nextCursor: data.locations.pageInfo.endCursor
        },
        hint: "Use productId parameter to get inventory levels for a specific product's variants"
      };
    } catch (error) {
      console.error("Error fetching inventory levels:", error);
      throw new Error(
        `Failed to fetch inventory levels: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getInventoryLevels };
