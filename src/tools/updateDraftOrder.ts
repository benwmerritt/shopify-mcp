import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Address input schema (reusable)
const AddressInputSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional()
});

// Line item input schema
const LineItemInputSchema = z.object({
  variantId: z.string().optional().describe("Product variant ID (for existing products)"),
  quantity: z.number().min(1).describe("Quantity to add"),
  title: z.string().optional().describe("Custom line item title (required if no variantId)"),
  originalUnitPrice: z.string().optional().describe("Price per unit for custom items"),
  taxable: z.boolean().optional(),
  requiresShipping: z.boolean().optional(),
  sku: z.string().optional(),
  appliedDiscount: z.object({
    value: z.number(),
    valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
    title: z.string().optional()
  }).optional()
});

// Applied discount schema
const AppliedDiscountInputSchema = z.object({
  value: z.number().describe("Discount value"),
  valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
  title: z.string().optional(),
  description: z.string().optional()
});

// Shipping line schema
const ShippingLineInputSchema = z.object({
  title: z.string(),
  price: z.string()
});

// Input schema for updateDraftOrder
const UpdateDraftOrderInputSchema = z.object({
  id: z.string().min(1).describe("Draft order ID to update"),
  lineItems: z.array(LineItemInputSchema).optional().describe("Replace line items (omit to keep existing)"),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  customerId: z.string().optional().describe("Change customer"),
  shippingAddress: AddressInputSchema.optional(),
  billingAddress: AddressInputSchema.optional(),
  appliedDiscount: AppliedDiscountInputSchema.optional().describe("Order-level discount"),
  shippingLine: ShippingLineInputSchema.optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  taxExempt: z.boolean().optional()
});

type UpdateDraftOrderInput = z.infer<typeof UpdateDraftOrderInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize draft order ID to GID format
function normalizeDraftOrderId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/DraftOrder/${id}`;
}

// Helper to normalize variant ID to GID format
function normalizeVariantId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/ProductVariant/${id}`;
}

// Helper to normalize customer ID to GID format
function normalizeCustomerId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Customer/${id}`;
}

const updateDraftOrder = {
  name: "update-draft-order",
  description: "Update an existing draft order. Can modify line items, addresses, discounts, and more.",
  schema: UpdateDraftOrderInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateDraftOrderInput) => {
    try {
      const draftOrderId = normalizeDraftOrderId(input.id);

      // Build the draft order input (only include provided fields)
      const draftOrderInput: Record<string, unknown> = {};

      if (input.lineItems) {
        draftOrderInput.lineItems = input.lineItems.map((item) => {
          const lineItem: Record<string, unknown> = {
            quantity: item.quantity
          };

          if (item.variantId) {
            lineItem.variantId = normalizeVariantId(item.variantId);
          } else {
            lineItem.title = item.title;
            if (item.originalUnitPrice) {
              lineItem.originalUnitPriceWithCurrency = {
                amount: item.originalUnitPrice,
                currencyCode: "AUD"
              };
            }
            if (item.taxable !== undefined) lineItem.taxable = item.taxable;
            if (item.requiresShipping !== undefined) lineItem.requiresShipping = item.requiresShipping;
            if (item.sku) lineItem.sku = item.sku;
          }

          if (item.appliedDiscount) {
            lineItem.appliedDiscount = item.appliedDiscount;
          }

          return lineItem;
        });
      }

      if (input.email) draftOrderInput.email = input.email;
      if (input.phone) draftOrderInput.phone = input.phone;
      if (input.customerId) {
        draftOrderInput.purchasingEntity = {
          customerId: normalizeCustomerId(input.customerId)
        };
      }
      if (input.shippingAddress) draftOrderInput.shippingAddress = input.shippingAddress;
      if (input.billingAddress) draftOrderInput.billingAddress = input.billingAddress;
      if (input.appliedDiscount) draftOrderInput.appliedDiscount = input.appliedDiscount;
      if (input.shippingLine) draftOrderInput.shippingLine = input.shippingLine;
      if (input.note !== undefined) draftOrderInput.note = input.note;
      if (input.tags) draftOrderInput.tags = input.tags;
      if (input.taxExempt !== undefined) draftOrderInput.taxExempt = input.taxExempt;

      const mutation = gql`
        mutation DraftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder {
              id
              name
              status
              email
              updatedAt
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
              appliedDiscount {
                title
                value
                valueType
              }
              customer {
                id
                firstName
                lastName
                email
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
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
        input: draftOrderInput
      })) as {
        draftOrderUpdate: {
          draftOrder: {
            id: string;
            name: string;
            status: string;
            email: string | null;
            updatedAt: string;
            tags: string[];
            totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            totalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
            appliedDiscount: any | null;
            customer: any | null;
            lineItems: {
              edges: Array<{
                node: any;
              }>;
            };
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.draftOrderUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update draft order: ${data.draftOrderUpdate.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      const draftOrder = data.draftOrderUpdate.draftOrder;

      if (!draftOrder) {
        throw new Error("Draft order was not returned after update");
      }

      return {
        success: true,
        draftOrder: {
          id: draftOrder.id,
          name: draftOrder.name,
          status: draftOrder.status,
          email: draftOrder.email,
          updatedAt: draftOrder.updatedAt,
          tags: draftOrder.tags,
          totalPrice: draftOrder.totalPriceSet.shopMoney,
          subtotalPrice: draftOrder.subtotalPriceSet.shopMoney,
          totalTax: draftOrder.totalTaxSet.shopMoney,
          appliedDiscount: draftOrder.appliedDiscount,
          customer: draftOrder.customer,
          lineItems: draftOrder.lineItems.edges.map((edge) => ({
            id: edge.node.id,
            title: edge.node.title,
            quantity: edge.node.quantity,
            unitPrice: edge.node.originalUnitPriceSet?.shopMoney
          }))
        }
      };
    } catch (error) {
      console.error("Error updating draft order:", error);
      throw new Error(
        `Failed to update draft order: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateDraftOrder };
