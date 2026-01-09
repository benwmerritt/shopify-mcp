import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getting customer orders
const GetCustomerOrdersInputSchema = z.object({
  customerId: z.string().regex(/^\d+$/, "Customer ID must be numeric"),
  limit: z.number().default(10),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetCustomerOrdersInput = z.infer<typeof GetCustomerOrdersInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getCustomerOrders = {
  name: "get-customer-orders",
  description: "Get orders for a specific customer",
  schema: GetCustomerOrdersInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetCustomerOrdersInput) => {
    try {
      const { customerId, limit } = input;

      // Convert the numeric customer ID to the GID format
      const customerGid = `gid://shopify/Customer/${customerId}`;

      // Query to get orders for a specific customer
      const query = gql`
        query GetCustomerOrders($query: String!, $first: Int!, $cursor: String) {
          orders(query: $query, first: $first, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                subtotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  id
                  firstName
                  lastName
                  email
                }
                lineItems(first: 5) {
                  edges {
                    node {
                      id
                      title
                      quantity
                      originalTotalSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      variant {
                        id
                        title
                        sku
                      }
                    }
                  }
                }
                tags
                note
              }
            }
          }
        }
      `;

      // We use the query parameter to filter orders by customer ID
      const variables = {
        query: `customer_id:${customerId}`,
        first: limit,
        cursor: input.cursor
      };

      const data = (await shopifyClient.request(query, variables)) as {
        orders: any;
      };

      // Extract and format order data
      const orders = data.orders.edges.map((edge: any) => {
        const order = edge.node;

        // Format line items
        const lineItems = order.lineItems.edges.map((lineItemEdge: any) => {
          const lineItem = lineItemEdge.node;
          return {
            id: lineItem.id,
            title: lineItem.title,
            quantity: lineItem.quantity,
            originalTotal: lineItem.originalTotalSet.shopMoney,
            variant: lineItem.variant
              ? {
                  id: lineItem.variant.id,
                  title: lineItem.variant.title,
                  sku: lineItem.variant.sku
                }
              : null
          };
        });

        return {
          id: order.id,
          name: order.name,
          createdAt: order.createdAt,
          financialStatus: order.displayFinancialStatus,
          fulfillmentStatus: order.displayFulfillmentStatus,
          totalPrice: order.totalPriceSet.shopMoney,
          subtotalPrice: order.subtotalPriceSet.shopMoney,
          totalShippingPrice: order.totalShippingPriceSet.shopMoney,
          totalTax: order.totalTaxSet.shopMoney,
          customer: order.customer
            ? {
                id: order.customer.id,
                firstName: order.customer.firstName,
                lastName: order.customer.lastName,
                email: order.customer.email
              }
            : null,
          lineItems,
          tags: order.tags,
          note: order.note
        };
      });

      return {
        orders,
        pageInfo: {
          hasNextPage: data.orders.pageInfo.hasNextPage,
          endCursor: data.orders.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching customer orders:", error);
      throw new Error(
        `Failed to fetch customer orders: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getCustomerOrders };
