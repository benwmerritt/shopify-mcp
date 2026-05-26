import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getOrderById
const GetOrderByIdInputSchema = z.object({
  orderId: z.string().min(1)
});

type GetOrderByIdInput = z.infer<typeof GetOrderByIdInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getOrderById = {
  name: "get-order-by-id",
  description: "Get a specific order by ID",
  schema: GetOrderByIdInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetOrderByIdInput) => {
    try {
      const { orderId } = input;

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
            lineItems(first: 20) {
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

      const variables = {
        id: orderId
      };

      const data = (await shopifyClient.request(query, variables)) as {
        order: any;
      };

      if (!data.order) {
        throw new Error(`Order with ID ${orderId} not found`);
      }

      // Extract and format order data
      const order = data.order;

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

      // Format metafields
      const metafields = order.metafields.edges.map((metafieldEdge: any) => {
        const metafield = metafieldEdge.node;
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
    } catch (error) {
      console.error("Error fetching order by ID:", error);
      throw new Error(
        `Failed to fetch order: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getOrderById };
