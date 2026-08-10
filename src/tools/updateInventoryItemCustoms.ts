import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const INVENTORY_ITEM_GID_PATTERN = /^gid:\/\/shopify\/InventoryItem\/\d+$/;
const NUMERIC_ID_PATTERN = /^\d+$/;

export const UpdateInventoryItemCustomsInputSchema = z
  .object({
    inventoryItemId: z
      .string()
      .refine(
        (value) =>
          NUMERIC_ID_PATTERN.test(value) || INVENTORY_ITEM_GID_PATTERN.test(value),
        "Inventory item ID must be numeric or a Shopify InventoryItem GID",
      )
      .describe("Inventory item ID (numeric or full Shopify InventoryItem GID)"),
    countryCodeOfOrigin: z
      .string()
      .regex(/^[A-Z]{2}$/, "Country of origin must be an uppercase ISO alpha-2 code")
      .optional()
      .describe("Uppercase ISO alpha-2 country code of origin"),
    provinceCodeOfOrigin: z
      .string()
      .min(1)
      .optional()
      .describe("Province or state code of origin"),
    harmonizedSystemCode: z
      .string()
      .regex(/^\d{6,}$/, "Harmonized system code must contain at least six digits")
      .optional()
      .describe("Harmonized system code (at least the six-digit international code)"),
  })
  .refine(
    (input) =>
      input.countryCodeOfOrigin !== undefined ||
      input.provinceCodeOfOrigin !== undefined ||
      input.harmonizedSystemCode !== undefined,
    {
      message: "At least one customs field must be provided",
    },
  );

export type UpdateInventoryItemCustomsInput = z.infer<
  typeof UpdateInventoryItemCustomsInputSchema
>;

type InventoryItemCustoms = {
  id: string;
  sku: string | null;
  countryCodeOfOrigin: string | null;
  provinceCodeOfOrigin: string | null;
  harmonizedSystemCode: string | null;
  tracked: boolean;
  requiresShipping: boolean;
  updatedAt: string;
};

type UserError = {
  field: string[] | null;
  message: string;
};

let shopifyClient: GraphQLClient;

export function normalizeInventoryItemId(id: string): string {
  return INVENTORY_ITEM_GID_PATTERN.test(id)
    ? id
    : `gid://shopify/InventoryItem/${id}`;
}

const INVENTORY_ITEM_FIELDS = gql`
  fragment InventoryItemCustomsFields on InventoryItem {
    id
    sku
    countryCodeOfOrigin
    provinceCodeOfOrigin
    harmonizedSystemCode
    tracked
    requiresShipping
    updatedAt
  }
`;

const UPDATE_INVENTORY_ITEM_CUSTOMS = gql`
  ${INVENTORY_ITEM_FIELDS}
  mutation updateInventoryItemCustoms($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        ...InventoryItemCustomsFields
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_INVENTORY_ITEM_CUSTOMS = gql`
  ${INVENTORY_ITEM_FIELDS}
  query verifyInventoryItemCustoms($id: ID!) {
    inventoryItem(id: $id) {
      ...InventoryItemCustomsFields
    }
  }
`;

const CUSTOMS_FIELDS = [
  "countryCodeOfOrigin",
  "provinceCodeOfOrigin",
  "harmonizedSystemCode",
] as const;

export const updateInventoryItemCustoms = {
  name: "update-inventory-item-customs",
  description:
    "Update only country/province of origin and harmonized system code on one inventory item, then verify the write with a fresh read",
  schema: UpdateInventoryItemCustomsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  async execute(rawInput: UpdateInventoryItemCustomsInput) {
    const input = UpdateInventoryItemCustomsInputSchema.parse(rawInput);
    const id = normalizeInventoryItemId(input.inventoryItemId);
    const customsInput: Record<string, string> = {};

    for (const field of CUSTOMS_FIELDS) {
      if (input[field] !== undefined) {
        customsInput[field] = input[field];
      }
    }

    const mutationData = (await shopifyClient.request(
      UPDATE_INVENTORY_ITEM_CUSTOMS,
      { id, input: customsInput },
    )) as {
      inventoryItemUpdate: {
        inventoryItem: InventoryItemCustoms | null;
        userErrors: UserError[];
      };
    };

    const mutationResult = mutationData.inventoryItemUpdate;
    if (mutationResult.userErrors.length > 0) {
      throw new Error(
        `Failed to update inventory item customs: ${mutationResult.userErrors
          .map((error) =>
            `${error.field?.join(".") || "inventoryItem"}: ${error.message}`,
          )
          .join(", ")}`,
      );
    }
    if (!mutationResult.inventoryItem) {
      throw new Error("Inventory item customs update returned no inventory item");
    }

    const verificationData = (await shopifyClient.request(
      GET_INVENTORY_ITEM_CUSTOMS,
      { id },
    )) as { inventoryItem: InventoryItemCustoms | null };
    if (!verificationData.inventoryItem) {
      throw new Error("Fresh-read verification returned no inventory item");
    }

    for (const field of CUSTOMS_FIELDS) {
      if (
        input[field] !== undefined &&
        verificationData.inventoryItem[field] !== input[field]
      ) {
        throw new Error(
          `Fresh-read verification failed for ${field}: expected ${JSON.stringify(input[field])}, received ${JSON.stringify(verificationData.inventoryItem[field])}`,
        );
      }
    }

    return {
      ...mutationResult,
      verified: verificationData.inventoryItem,
    };
  },
};
