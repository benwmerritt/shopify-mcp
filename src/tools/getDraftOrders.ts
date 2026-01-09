import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getDraftOrders
const GetDraftOrdersInputSchema = z.object({
  status: z.enum(["OPEN", "INVOICE_SENT", "COMPLETED"]).optional().describe("Filter by draft order status"),
  query: z.string().optional().describe("Search query (Shopify search syntax)"),
  limit: z.number().default(50).describe("Maximum number of draft orders to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetDraftOrdersInput = z.infer<typeof GetDraftOrdersInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getDraftOrders = {
  name: "get-draft-orders",
  description: "List draft orders with optional filtering by status. Draft orders are used for quotes, manual orders, and B2B pricing.",
  schema: GetDraftOrdersInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetDraftOrdersInput) => {
    try {
      // Build query string for status filter
      let queryString = input.query || "";
      if (input.status) {
        const statusFilter = `status:${input.status.toLowerCase()}`;
        queryString = queryString ? `${queryString} ${statusFilter}` : statusFilter;
      }

      const query = gql`
        query GetDraftOrders($first: Int!, $query: String, $cursor: String) {
          draftOrders(first: $first, query: $query, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                name
                status
                email
                phone
                createdAt
                updatedAt
                completedAt
                tags
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
                  city
                  provinceCode
                  zip
                  country
                }
                lineItemsSubtotalPrice {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        first: input.limit,
        query: queryString || undefined,
        cursor: input.cursor
      };

      const data = (await shopifyClient.request(query, variables)) as {
        draftOrders: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
          edges: Array<{
            node: {
              id: string;
              name: string;
              status: string;
              email: string | null;
              phone: string | null;
              createdAt: string;
              updatedAt: string;
              completedAt: string | null;
              tags: string[];
              totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              totalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
              customer: {
                id: string;
                firstName: string | null;
                lastName: string | null;
                email: string | null;
              } | null;
              shippingAddress: {
                address1: string | null;
                city: string | null;
                provinceCode: string | null;
                zip: string | null;
                country: string | null;
              } | null;
              lineItemsSubtotalPrice: { shopMoney: { amount: string; currencyCode: string } };
            };
          }>;
        };
      };

      const draftOrders = data.draftOrders.edges.map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        status: edge.node.status,
        email: edge.node.email,
        phone: edge.node.phone,
        createdAt: edge.node.createdAt,
        updatedAt: edge.node.updatedAt,
        completedAt: edge.node.completedAt,
        tags: edge.node.tags,
        totalPrice: edge.node.totalPriceSet.shopMoney,
        subtotalPrice: edge.node.subtotalPriceSet.shopMoney,
        totalTax: edge.node.totalTaxSet.shopMoney,
        lineItemsSubtotal: edge.node.lineItemsSubtotalPrice.shopMoney,
        customer: edge.node.customer,
        shippingAddress: edge.node.shippingAddress
      }));

      return {
        draftOrders,
        pageInfo: {
          hasNextPage: data.draftOrders.pageInfo.hasNextPage,
          endCursor: data.draftOrders.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching draft orders:", error);
      throw new Error(
        `Failed to fetch draft orders: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getDraftOrders };
