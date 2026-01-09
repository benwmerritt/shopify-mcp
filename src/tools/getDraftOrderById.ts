import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getDraftOrderById
const GetDraftOrderByIdInputSchema = z.object({
  draftOrderId: z.string().min(1).describe("Draft order ID (can be numeric or full GID)")
});

type GetDraftOrderByIdInput = z.infer<typeof GetDraftOrderByIdInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize draft order ID to GID format
function normalizeDraftOrderId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/DraftOrder/${id}`;
}

const getDraftOrderById = {
  name: "get-draft-order-by-id",
  description: "Get full details of a specific draft order including line items, discounts, and shipping.",
  schema: GetDraftOrderByIdInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetDraftOrderByIdInput) => {
    try {
      const draftOrderId = normalizeDraftOrderId(input.draftOrderId);

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
            note
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
        draftOrder: {
          id: string;
          name: string;
          status: string;
          email: string | null;
          phone: string | null;
          createdAt: string;
          updatedAt: string;
          completedAt: string | null;
          invoiceSentAt: string | null;
          note: string | null;
          tags: string[];
          taxExempt: boolean;
          currencyCode: string;
          totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          totalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
          totalShippingPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          totalDiscountsSet: { shopMoney: { amount: string; currencyCode: string } };
          customer: any | null;
          shippingAddress: any | null;
          billingAddress: any | null;
          shippingLine: any | null;
          appliedDiscount: any | null;
          lineItems: {
            edges: Array<{
              node: any;
            }>;
          };
          order: { id: string; name: string } | null;
        } | null;
      };

      if (!data.draftOrder) {
        throw new Error(`Draft order not found: ${input.draftOrderId}`);
      }

      const draftOrder = data.draftOrder;

      // Format line items
      const lineItems = draftOrder.lineItems.edges.map((edge) => ({
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
          note: draftOrder.note,
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
          // If completed, include the resulting order
          order: draftOrder.order
        }
      };
    } catch (error) {
      console.error("Error fetching draft order:", error);
      throw new Error(
        `Failed to fetch draft order: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getDraftOrderById };
