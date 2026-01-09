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
  // Custom line item fields (when variantId is not provided)
  title: z.string().optional().describe("Custom line item title (required if no variantId)"),
  originalUnitPrice: z.string().optional().describe("Price per unit for custom items (e.g., '19.99')"),
  taxable: z.boolean().optional().describe("Whether the item is taxable"),
  requiresShipping: z.boolean().optional().describe("Whether the item requires shipping"),
  sku: z.string().optional().describe("SKU for custom items"),
  // Line-level discount
  appliedDiscount: z.object({
    value: z.number().describe("Discount value"),
    valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).describe("Type of discount"),
    title: z.string().optional().describe("Discount title")
  }).optional().describe("Discount applied to this line item")
});

// Applied discount schema
const AppliedDiscountInputSchema = z.object({
  value: z.number().describe("Discount value"),
  valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]).describe("FIXED_AMOUNT or PERCENTAGE"),
  title: z.string().optional().describe("Discount title to display"),
  description: z.string().optional().describe("Discount description")
});

// Shipping line schema
const ShippingLineInputSchema = z.object({
  title: z.string().describe("Shipping method name (e.g., 'Standard Shipping')"),
  price: z.string().describe("Shipping price (e.g., '9.99')")
});

// Input schema for createDraftOrder
const CreateDraftOrderInputSchema = z.object({
  lineItems: z.array(LineItemInputSchema).min(1).describe("Line items (at least 1 required)"),
  email: z.string().email().optional().describe("Customer email"),
  phone: z.string().optional().describe("Customer phone"),
  customerId: z.string().optional().describe("Existing customer ID to attach"),
  shippingAddress: AddressInputSchema.optional().describe("Shipping address"),
  billingAddress: AddressInputSchema.optional().describe("Billing address"),
  appliedDiscount: AppliedDiscountInputSchema.optional().describe("Order-level discount"),
  shippingLine: ShippingLineInputSchema.optional().describe("Shipping method and price"),
  note: z.string().optional().describe("Internal note"),
  tags: z.array(z.string()).optional().describe("Tags for the draft order"),
  taxExempt: z.boolean().optional().describe("Whether the order is tax exempt")
});

type CreateDraftOrderInput = z.infer<typeof CreateDraftOrderInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

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

const createDraftOrder = {
  name: "create-draft-order",
  description: "Create a new draft order. Use for quotes, manual orders, or B2B pricing. Line items can reference existing variants or be custom items.",
  schema: CreateDraftOrderInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateDraftOrderInput) => {
    try {
      // Build line items for GraphQL input
      const lineItems = input.lineItems.map((item) => {
        const lineItem: Record<string, unknown> = {
          quantity: item.quantity
        };

        if (item.variantId) {
          lineItem.variantId = normalizeVariantId(item.variantId);
        } else {
          // Custom line item
          lineItem.title = item.title;
          if (item.originalUnitPrice) {
            lineItem.originalUnitPriceWithCurrency = {
              amount: item.originalUnitPrice,
              currencyCode: "AUD" // Default currency, could be made configurable
            };
          }
          if (item.taxable !== undefined) {
            lineItem.taxable = item.taxable;
          }
          if (item.requiresShipping !== undefined) {
            lineItem.requiresShipping = item.requiresShipping;
          }
          if (item.sku) {
            lineItem.sku = item.sku;
          }
        }

        if (item.appliedDiscount) {
          lineItem.appliedDiscount = {
            value: item.appliedDiscount.value,
            valueType: item.appliedDiscount.valueType,
            title: item.appliedDiscount.title
          };
        }

        return lineItem;
      });

      // Build the draft order input
      const draftOrderInput: Record<string, unknown> = {
        lineItems
      };

      if (input.email) {
        draftOrderInput.email = input.email;
      }
      if (input.phone) {
        draftOrderInput.phone = input.phone;
      }
      if (input.customerId) {
        // Use purchasingEntity for customer assignment (customerId is deprecated)
        draftOrderInput.purchasingEntity = {
          customerId: normalizeCustomerId(input.customerId)
        };
      }
      if (input.shippingAddress) {
        draftOrderInput.shippingAddress = input.shippingAddress;
      }
      if (input.billingAddress) {
        draftOrderInput.billingAddress = input.billingAddress;
      }
      if (input.appliedDiscount) {
        draftOrderInput.appliedDiscount = {
          value: input.appliedDiscount.value,
          valueType: input.appliedDiscount.valueType,
          title: input.appliedDiscount.title,
          description: input.appliedDiscount.description
        };
      }
      if (input.shippingLine) {
        draftOrderInput.shippingLine = {
          title: input.shippingLine.title,
          price: input.shippingLine.price
        };
      }
      if (input.note) {
        draftOrderInput.note = input.note;
      }
      if (input.tags) {
        draftOrderInput.tags = input.tags;
      }
      if (input.taxExempt !== undefined) {
        draftOrderInput.taxExempt = input.taxExempt;
      }

      const mutation = gql`
        mutation DraftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              name
              status
              email
              createdAt
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
        input: draftOrderInput
      })) as {
        draftOrderCreate: {
          draftOrder: {
            id: string;
            name: string;
            status: string;
            email: string | null;
            createdAt: string;
            totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
            totalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
            customer: any | null;
            lineItems: {
              edges: Array<{
                node: {
                  id: string;
                  title: string;
                  quantity: number;
                  originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
                };
              }>;
            };
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.draftOrderCreate.userErrors.length > 0) {
        throw new Error(
          `Failed to create draft order: ${data.draftOrderCreate.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      const draftOrder = data.draftOrderCreate.draftOrder;

      if (!draftOrder) {
        throw new Error("Draft order was not returned after creation");
      }

      return {
        success: true,
        draftOrder: {
          id: draftOrder.id,
          name: draftOrder.name,
          status: draftOrder.status,
          email: draftOrder.email,
          createdAt: draftOrder.createdAt,
          totalPrice: draftOrder.totalPriceSet.shopMoney,
          subtotalPrice: draftOrder.subtotalPriceSet.shopMoney,
          totalTax: draftOrder.totalTaxSet.shopMoney,
          customer: draftOrder.customer,
          lineItems: draftOrder.lineItems.edges.map((edge) => ({
            id: edge.node.id,
            title: edge.node.title,
            quantity: edge.node.quantity,
            unitPrice: edge.node.originalUnitPriceSet.shopMoney
          }))
        }
      };
    } catch (error) {
      console.error("Error creating draft order:", error);
      throw new Error(
        `Failed to create draft order: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { createDraftOrder };
