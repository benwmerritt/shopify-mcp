import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Helper to normalize order ID to GID format
function normalizeOrderId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Order/${id}`;
}

// Input schema for unified orders tool
const OrdersInputSchema = z.object({
  // Single order mode - if provided, fetches one order by ID
  id: z.string().optional().describe("Order ID for single order lookup (can be numeric or full GID)"),

  // Filter by customer
  customerId: z.string().optional().describe("Filter orders by customer ID (numeric)"),

  // Status filter
  status: z.enum(["any", "open", "closed", "cancelled"]).default("any").describe("Filter by order status"),

  // Pagination
  limit: z.number().default(10).describe("Maximum number of orders to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type OrdersInput = z.infer<typeof OrdersInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const orders = {
  name: "orders",
  description: "Get orders by ID, customer, or status. Use 'id' for single order lookup, 'customerId' to filter by customer, or 'status' to filter by order status.",
  schema: OrdersInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: OrdersInput) => {
    try {
      // SINGLE ORDER MODE - when id is provided
      if (input.id) {
        const orderId = normalizeOrderId(input.id);

        const query = gql`
          query GetOrderById($id: ID!) {
            order(id: $id) {
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
                phone
              }
              shippingAddress {
                address1
                address2
                city
                provinceCode
                zip
                country
                phone
              }
              lineItems(first: 50) {
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
              metafields(first: 20) {
                edges {
                  node {
                    id
                    namespace
                    key
                    value
                    type
                  }
                }
              }
            }
          }
        `;

        const data = (await shopifyClient.request(query, { id: orderId })) as {
          order: any;
        };

        if (!data.order) {
          throw new Error(`Order not found: ${input.id}`);
        }

        const order = data.order;

        // Format line items
        const lineItems = order.lineItems.edges.map((edge: any) => {
          const lineItem = edge.node;
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

        // Format metafields
        const metafields = order.metafields.edges.map((edge: any) => {
          const metafield = edge.node;
          return {
            id: metafield.id,
            namespace: metafield.namespace,
            key: metafield.key,
            value: metafield.value,
            type: metafield.type
          };
        });

        const formattedOrder = {
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
                email: order.customer.email,
                phone: order.customer.phone
              }
            : null,
          shippingAddress: order.shippingAddress,
          lineItems,
          tags: order.tags,
          note: order.note,
          metafields
        };

        return { order: formattedOrder };
      }

      // LIST/SEARCH MODE - when no id provided
      const queryParts: string[] = [];

      // Add status filter
      if (input.status !== "any") {
        queryParts.push(`status:${input.status}`);
      }

      // Add customer filter
      if (input.customerId) {
        queryParts.push(`customer_id:${input.customerId}`);
      }

      const queryString = queryParts.length > 0 ? queryParts.join(" AND ") : undefined;

      const query = gql`
        query GetOrders($first: Int!, $query: String, $cursor: String) {
          orders(first: $first, query: $query, after: $cursor) {
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
                shippingAddress {
                  address1
                  address2
                  city
                  provinceCode
                  zip
                  country
                  phone
                }
                lineItems(first: 10) {
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

      const variables = {
        first: input.limit,
        query: queryString,
        cursor: input.cursor
      };

      const data = (await shopifyClient.request(query, variables)) as {
        orders: any;
      };

      // Format orders
      const ordersList = data.orders.edges.map((edge: any) => {
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
          shippingAddress: order.shippingAddress,
          lineItems,
          tags: order.tags,
          note: order.note
        };
      });

      return {
        orders: ordersList,
        pageInfo: {
          hasNextPage: data.orders.pageInfo.hasNextPage,
          endCursor: data.orders.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching orders:", error);
      throw new Error(
        `Failed to fetch orders: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { orders };
