import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for completeDraftOrder
const CompleteDraftOrderInputSchema = z.object({
  id: z.string().min(1).describe("Draft order ID to complete"),
  paymentPending: z.boolean().default(false).describe("If true, marks payment as pending. If false, marks as paid.")
});

type CompleteDraftOrderInput = z.infer<typeof CompleteDraftOrderInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize draft order ID to GID format
function normalizeDraftOrderId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/DraftOrder/${id}`;
}

const completeDraftOrder = {
  name: "complete-draft-order",
  description: "Convert a draft order into a real order. The draft order will be marked as completed and a new order will be created.",
  schema: CompleteDraftOrderInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CompleteDraftOrderInput) => {
    try {
      const draftOrderId = normalizeDraftOrderId(input.id);

      const mutation = gql`
        mutation DraftOrderComplete($id: ID!, $paymentPending: Boolean) {
          draftOrderComplete(id: $id, paymentPending: $paymentPending) {
            draftOrder {
              id
              name
              status
              completedAt
              order {
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
                customer {
                  id
                  firstName
                  lastName
                  email
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(mutation, {
        id: draftOrderId,
        paymentPending: input.paymentPending
      })) as {
        draftOrderComplete: {
          draftOrder: {
            id: string;
            name: string;
            status: string;
            completedAt: string;
            order: {
              id: string;
              name: string;
              createdAt: string;
              displayFinancialStatus: string;
              displayFulfillmentStatus: string;
              totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              customer: {
                id: string;
                firstName: string | null;
                lastName: string | null;
                email: string | null;
              } | null;
            } | null;
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.draftOrderComplete.userErrors.length > 0) {
        throw new Error(
          `Failed to complete draft order: ${data.draftOrderComplete.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      const draftOrder = data.draftOrderComplete.draftOrder;

      if (!draftOrder) {
        throw new Error("Draft order was not returned after completion");
      }

      return {
        success: true,
        draftOrder: {
          id: draftOrder.id,
          name: draftOrder.name,
          status: draftOrder.status,
          completedAt: draftOrder.completedAt
        },
        order: draftOrder.order ? {
          id: draftOrder.order.id,
          name: draftOrder.order.name,
          createdAt: draftOrder.order.createdAt,
          financialStatus: draftOrder.order.displayFinancialStatus,
          fulfillmentStatus: draftOrder.order.displayFulfillmentStatus,
          totalPrice: draftOrder.order.totalPriceSet.shopMoney,
          customer: draftOrder.order.customer
        } : null,
        message: draftOrder.order
          ? `Draft order ${draftOrder.name} completed. Created order ${draftOrder.order.name}.`
          : `Draft order ${draftOrder.name} completed.`
      };
    } catch (error) {
      console.error("Error completing draft order:", error);
      throw new Error(
        `Failed to complete draft order: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { completeDraftOrder };
