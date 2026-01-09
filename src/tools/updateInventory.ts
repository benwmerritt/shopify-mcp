import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for updateInventory
const UpdateInventoryInputSchema = z.object({
  inventoryItemId: z.string().min(1).describe("Inventory item ID (from getInventoryLevels)"),
  locationId: z.string().min(1).describe("Location ID where inventory is stored"),
  
  // Use either delta (adjust) or setQuantity (absolute)
  delta: z.number().optional().describe("Amount to adjust inventory by (positive or negative)"),
  setQuantity: z.number().optional().describe("Set inventory to this exact quantity"),
  
  reason: z.enum([
    "correction",
    "cycle_count_available",
    "damaged",
    "movement_created",
    "movement_updated",
    "movement_received",
    "movement_canceled",
    "other",
    "promotion",
    "quality_control",
    "received",
    "reservation_created",
    "reservation_deleted",
    "reservation_updated",
    "restock",
    "safety_stock",
    "shrinkage"
  ]).default("correction").describe("Reason for the inventory change")
});

type UpdateInventoryInput = z.infer<typeof UpdateInventoryInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize inventory item ID to GID format
function normalizeInventoryItemId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/InventoryItem/${id}`;
}

// Helper to normalize location ID to GID format
function normalizeLocationId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Location/${id}`;
}

const updateInventory = {
  name: "update-inventory",
  description: "Update inventory quantity at a specific location. Use delta to adjust by an amount, or setQuantity to set an exact value.",
  schema: UpdateInventoryInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateInventoryInput) => {
    try {
      const inventoryItemId = normalizeInventoryItemId(input.inventoryItemId);
      const locationId = normalizeLocationId(input.locationId);

      if (input.delta === undefined && input.setQuantity === undefined) {
        throw new Error("Either delta or setQuantity must be provided");
      }

      if (input.delta !== undefined && input.setQuantity !== undefined) {
        throw new Error("Cannot use both delta and setQuantity - choose one");
      }

      if (input.delta !== undefined) {
        // Use inventoryAdjustQuantities for delta changes
        const adjustQuery = gql`
          mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              inventoryAdjustmentGroup {
                reason
                changes {
                  name
                  delta
                  quantityAfterChange
                  item {
                    id
                  }
                  location {
                    id
                    name
                  }
                }
              }
              userErrors {
                field
                message
                code
              }
            }
          }
        `;

        const data = (await shopifyClient.request(adjustQuery, {
          input: {
            reason: input.reason,
            name: "available",
            changes: [
              {
                inventoryItemId,
                locationId,
                delta: input.delta
              }
            ]
          }
        })) as {
          inventoryAdjustQuantities: {
            inventoryAdjustmentGroup: {
              reason: string;
              changes: Array<{
                name: string;
                delta: number;
                quantityAfterChange: number;
                item: { id: string };
                location: { id: string; name: string };
              }>;
            } | null;
            userErrors: Array<{
              field: string[];
              message: string;
              code: string;
            }>;
          };
        };

        if (data.inventoryAdjustQuantities.userErrors.length > 0) {
          throw new Error(
            `Failed to adjust inventory: ${data.inventoryAdjustQuantities.userErrors
              .map((e) => `${e.code}: ${e.message}`)
              .join(", ")}`
          );
        }

        const changes = data.inventoryAdjustQuantities.inventoryAdjustmentGroup?.changes || [];
        const change = changes[0];

        return {
          success: true,
          action: "adjust",
          inventoryItemId,
          locationId,
          locationName: change?.location.name,
          delta: input.delta,
          quantityAfterChange: change?.quantityAfterChange,
          reason: input.reason,
          message: `Adjusted inventory by ${input.delta > 0 ? "+" : ""}${input.delta}`
        };
      }

      if (input.setQuantity !== undefined) {
        // Use inventorySetQuantities for setting absolute quantity
        const setQuery = gql`
          mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup {
                reason
                changes {
                  name
                  delta
                  quantityAfterChange
                  item {
                    id
                  }
                  location {
                    id
                    name
                  }
                }
              }
              userErrors {
                field
                message
                code
              }
            }
          }
        `;

        const data = (await shopifyClient.request(setQuery, {
          input: {
            reason: input.reason,
            name: "available",
            ignoreCompareQuantity: true,
            quantities: [
              {
                inventoryItemId,
                locationId,
                quantity: input.setQuantity
              }
            ]
          }
        })) as {
          inventorySetQuantities: {
            inventoryAdjustmentGroup: {
              reason: string;
              changes: Array<{
                name: string;
                delta: number;
                quantityAfterChange: number;
                item: { id: string };
                location: { id: string; name: string };
              }>;
            } | null;
            userErrors: Array<{
              field: string[];
              message: string;
              code: string;
            }>;
          };
        };

        if (data.inventorySetQuantities.userErrors.length > 0) {
          throw new Error(
            `Failed to set inventory: ${data.inventorySetQuantities.userErrors
              .map((e) => `${e.code}: ${e.message}`)
              .join(", ")}`
          );
        }

        const changes = data.inventorySetQuantities.inventoryAdjustmentGroup?.changes || [];
        const change = changes[0];

        return {
          success: true,
          action: "set",
          inventoryItemId,
          locationId,
          locationName: change?.location.name,
          setTo: input.setQuantity,
          quantityAfterChange: change?.quantityAfterChange,
          reason: input.reason,
          message: `Set inventory to ${input.setQuantity}`
        };
      }

      throw new Error("Unexpected state");
    } catch (error) {
      console.error("Error updating inventory:", error);
      throw new Error(
        `Failed to update inventory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateInventory };
