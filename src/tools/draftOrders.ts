import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Helper to normalize draft order ID to GID format
function normalizeDraftOrderId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/DraftOrder/${id}`;
}

// Input schema for unified draft orders tool
const DraftOrdersInputSchema = z.object({
  // Single draft order mode - if provided, fetches one draft order by ID
  id: z.string().optional().describe("Draft order ID for single lookup (can be numeric or full GID)"),

  // Filters for list mode
  status: z.enum(["OPEN", "INVOICE_SENT", "COMPLETED"]).optional().describe("Filter by draft order status"),
  query: z.string().optional().describe("Search query (Shopify search syntax)"),

  // Pagination
  limit: z.number().default(50).describe("Maximum number of draft orders to return"),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type DraftOrdersInput = z.infer<typeof DraftOrdersInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const draftOrders = {
  name: "draft-orders",
  description: "Get draft orders by ID or list/search draft orders. Use 'id' for single lookup, or use filters (status, query) to search. Draft orders are used for quotes, manual orders, and B2B pricing.",
  schema: DraftOrdersInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DraftOrdersInput) => {
    try {
      // SINGLE DRAFT ORDER MODE - when id is provided
      if (input.id) {
        const draftOrderId = normalizeDraftOrderId(input.id);

        const query = gql`
          query GetDraftOrderById($id: ID!) {
            draftOrder(id: $id) {
              id
              name
              status
              email
              phone
              createdAt
              updatedAt
              completedAt
              invoiceSentAt
              tags
              taxExempt
              currencyCode
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
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalDiscountsSet {
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
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                zip
                country
                countryCodeV2
                phone
              }
              billingAddress {
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                zip
                country
                countryCodeV2
                phone
              }
              shippingLine {
                title
                custom
                originalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
              appliedDiscount {
                title
                description
                value
                valueType
                amountSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    sku
                    taxable
                    requiresShipping
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    discountedUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    totalDiscountSet {
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
                    product {
                      id
                      title
                    }
                    appliedDiscount {
                      title
                      value
                      valueType
                    }
                  }
                }
              }
              order {
                id
                name
              }
            }
          }
        `;

        const data = (await shopifyClient.request(query, { id: draftOrderId })) as {
          draftOrder: any;
        };

        if (!data.draftOrder) {
          throw new Error(`Draft order not found: ${input.id}`);
        }

        const draftOrder = data.draftOrder;

        // Format line items
        const lineItems = draftOrder.lineItems.edges.map((edge: any) => ({
          id: edge.node.id,
          title: edge.node.title,
          quantity: edge.node.quantity,
          sku: edge.node.sku,
          taxable: edge.node.taxable,
          requiresShipping: edge.node.requiresShipping,
          originalUnitPrice: edge.node.originalUnitPriceSet?.shopMoney,
          discountedUnitPrice: edge.node.discountedUnitPriceSet?.shopMoney,
          totalDiscount: edge.node.totalDiscountSet?.shopMoney,
          variant: edge.node.variant,
          product: edge.node.product,
          appliedDiscount: edge.node.appliedDiscount
        }));

        return {
          draftOrder: {
            id: draftOrder.id,
            name: draftOrder.name,
            status: draftOrder.status,
            email: draftOrder.email,
            phone: draftOrder.phone,
            createdAt: draftOrder.createdAt,
            updatedAt: draftOrder.updatedAt,
            completedAt: draftOrder.completedAt,
            invoiceSentAt: draftOrder.invoiceSentAt,
            tags: draftOrder.tags,
            taxExempt: draftOrder.taxExempt,
            currencyCode: draftOrder.currencyCode,
            totalPrice: draftOrder.totalPriceSet.shopMoney,
            subtotalPrice: draftOrder.subtotalPriceSet.shopMoney,
            totalTax: draftOrder.totalTaxSet.shopMoney,
            totalShippingPrice: draftOrder.totalShippingPriceSet.shopMoney,
            totalDiscounts: draftOrder.totalDiscountsSet.shopMoney,
            customer: draftOrder.customer,
            shippingAddress: draftOrder.shippingAddress,
            billingAddress: draftOrder.billingAddress,
            shippingLine: draftOrder.shippingLine,
            appliedDiscount: draftOrder.appliedDiscount,
            lineItems,
            order: draftOrder.order
          }
        };
      }

      // LIST/SEARCH MODE - when no id provided
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
            node: any;
          }>;
        };
      };

      const draftOrdersList = data.draftOrders.edges.map((edge) => ({
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
        draftOrders: draftOrdersList,
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

export { draftOrders };
