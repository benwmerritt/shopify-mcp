import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const INVENTORY_ITEM_GID_PATTERN = /^gid:\/\/shopify\/InventoryItem\/\d+$/;
const NUMERIC_ID_PATTERN = /^\d+$/;

export const SHOPIFY_WEIGHT_UNITS = [
  "GRAMS",
  "KILOGRAMS",
  "OUNCES",
  "POUNDS",
] as const;

export const UpdateInventoryItemShippingInputSchema = z
  .object({
    inventoryItemId: z
      .string()
      .refine(
        (value) =>
          NUMERIC_ID_PATTERN.test(value) || INVENTORY_ITEM_GID_PATTERN.test(value),
        "Inventory item ID must be numeric or a Shopify InventoryItem GID",
      )
      .describe("Inventory item ID (numeric or full Shopify InventoryItem GID)"),
    weightValue: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Positive native inventory-item weight value"),
    weightUnit: z
      .enum(SHOPIFY_WEIGHT_UNITS)
      .optional()
      .describe("Shopify weight unit"),
    requiresShipping: z
      .boolean()
      .optional()
      .describe("Whether the inventory item requires shipping"),
  })
  .strict()
  .superRefine((input, context) => {
    const hasWeightValue = input.weightValue !== undefined;
    const hasWeightUnit = input.weightUnit !== undefined;

    if (hasWeightValue !== hasWeightUnit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weightValue and weightUnit must be provided together",
      });
    }

    if (!hasWeightValue && input.requiresShipping === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one shipping field must be provided",
      });
    }
  });

export type UpdateInventoryItemShippingInput = z.infer<
  typeof UpdateInventoryItemShippingInputSchema
>;

export function normalizeInventoryItemId(id: string): string {
  return INVENTORY_ITEM_GID_PATTERN.test(id)
    ? id
    : `gid://shopify/InventoryItem/${id}`;
}

type InventoryItemShipping = {
  id: string;
  sku: string | null;
  measurement: {
    weight: {
      value: number;
      unit: (typeof SHOPIFY_WEIGHT_UNITS)[number];
    } | null;
  };
  requiresShipping: boolean;
  updatedAt: string;
};

type UserError = {
  field: string[] | null;
  message: string;
};

let shopifyClient: GraphQLClient;

const INVENTORY_ITEM_FIELDS = gql`
  fragment InventoryItemShippingFields on InventoryItem {
    id
    sku
    measurement {
      weight {
        value
        unit
      }
    }
    requiresShipping
    updatedAt
  }
`;

const UPDATE_INVENTORY_ITEM_SHIPPING = gql`
  ${INVENTORY_ITEM_FIELDS}
  mutation updateInventoryItemShipping($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        ...InventoryItemShippingFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_INVENTORY_ITEM_SHIPPING = gql`
  ${INVENTORY_ITEM_FIELDS}
  query verifyInventoryItemShipping($id: ID!) {
    inventoryItem(id: $id) {
      ...InventoryItemShippingFields
    }
  }
`;

export const updateInventoryItemShipping = {
  name: "update-inventory-item-shipping",
  description:
    "Update native weight and/or requiresShipping on one inventory item, then verify the write with a fresh read",
  schema: UpdateInventoryItemShippingInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  async execute(rawInput: UpdateInventoryItemShippingInput) {
    const input = UpdateInventoryItemShippingInputSchema.parse(rawInput);
    const id = normalizeInventoryItemId(input.inventoryItemId);
    const shippingInput: {
      measurement?: {
        weight: {
          value: number;
          unit: (typeof SHOPIFY_WEIGHT_UNITS)[number];
        };
      };
      requiresShipping?: boolean;
    } = {};

    if (input.weightValue !== undefined && input.weightUnit !== undefined) {
      shippingInput.measurement = {
        weight: { value: input.weightValue, unit: input.weightUnit },
      };
    }
    if (input.requiresShipping !== undefined) {
      shippingInput.requiresShipping = input.requiresShipping;
    }

    const mutationData = (await shopifyClient.request(
      UPDATE_INVENTORY_ITEM_SHIPPING,
      { id, input: shippingInput },
    )) as {
      inventoryItemUpdate: {
        inventoryItem: InventoryItemShipping | null;
        userErrors: UserError[];
      };
    };

    const mutationResult = mutationData.inventoryItemUpdate;
    if (mutationResult.userErrors.length > 0) {
      throw new Error(
        `Failed to update inventory item shipping: ${mutationResult.userErrors
          .map(
            (error) =>
              `${error.field?.join(".") || "inventoryItem"}: ${error.message}`,
          )
          .join(", ")}`,
      );
    }

    if (!mutationResult.inventoryItem) {
      throw new Error("Inventory item shipping update returned no inventory item");
    }

    const verificationData = (await shopifyClient.request(
      GET_INVENTORY_ITEM_SHIPPING,
      { id },
    )) as { inventoryItem: InventoryItemShipping | null };
    const verifiedItem = verificationData.inventoryItem;
    if (!verifiedItem) {
      throw new Error("Fresh-read verification returned no inventory item");
    }

    if (input.weightValue !== undefined && input.weightUnit !== undefined) {
      const expectedWeight = {
        value: input.weightValue,
        unit: input.weightUnit,
      };
      const receivedWeight = verifiedItem.measurement.weight;
      if (
        receivedWeight?.value !== expectedWeight.value ||
        receivedWeight?.unit !== expectedWeight.unit
      ) {
        throw new Error(
          `Fresh-read verification failed for weight: expected ${JSON.stringify(expectedWeight)}, received ${JSON.stringify(receivedWeight)}`,
        );
      }
    }

    if (
      input.requiresShipping !== undefined &&
      verifiedItem.requiresShipping !== input.requiresShipping
    ) {
      throw new Error(
        `Fresh-read verification failed for requiresShipping: expected ${input.requiresShipping}, received ${verifiedItem.requiresShipping}`,
      );
    }

    return {
      ...mutationResult,
      verified: verifiedItem,
    };
  },
};
