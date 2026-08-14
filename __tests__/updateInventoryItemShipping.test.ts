import {
  UpdateInventoryItemShippingInputSchema,
  normalizeInventoryItemId,
  updateInventoryItemShipping,
} from "../src/tools/updateInventoryItemShipping.js";

const updatedItem = {
  id: "gid://shopify/InventoryItem/123",
  sku: "SKU-123",
  measurement: {
    weight: {
      value: 1.25,
      unit: "KILOGRAMS",
    },
  },
  requiresShipping: false,
  updatedAt: "2026-08-14T12:00:00Z",
};

describe("update-inventory-item-shipping", () => {
  it("accepts only complete valid shipping updates", () => {
    expect(
      UpdateInventoryItemShippingInputSchema.parse({
        inventoryItemId: "123",
        weightValue: 1.25,
        weightUnit: "KILOGRAMS",
        requiresShipping: false,
      }),
    ).toEqual({
      inventoryItemId: "123",
      weightValue: 1.25,
      weightUnit: "KILOGRAMS",
      requiresShipping: false,
    });

    for (const weightUnit of ["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"]) {
      expect(
        UpdateInventoryItemShippingInputSchema.parse({
          inventoryItemId: "123",
          weightValue: 1,
          weightUnit,
        }).weightUnit,
      ).toBe(weightUnit);
    }

    const invalidInputs = [
      { inventoryItemId: "123" },
      { inventoryItemId: "123", weightValue: 1 },
      { inventoryItemId: "123", weightUnit: "GRAMS" },
      { inventoryItemId: "123", weightValue: 0, weightUnit: "GRAMS" },
      { inventoryItemId: "123", weightValue: -1, weightUnit: "GRAMS" },
      { inventoryItemId: "123", weightValue: Number.NaN, weightUnit: "GRAMS" },
      { inventoryItemId: "123", weightValue: Number.POSITIVE_INFINITY, weightUnit: "GRAMS" },
      { inventoryItemId: "123", weightValue: 1, weightUnit: "STONE" },
      { inventoryItemId: "123", requiresShipping: true, length: 10 },
      { inventoryItemId: "123", requiresShipping: true, shippingPackageId: "1" },
    ];
    for (const input of invalidInputs) {
      expect(() => UpdateInventoryItemShippingInputSchema.parse(input)).toThrow();
    }
  });

  it("normalizes numeric inventory item IDs and preserves valid GIDs", () => {
    expect(normalizeInventoryItemId("123")).toBe(
      "gid://shopify/InventoryItem/123",
    );
    expect(
      normalizeInventoryItemId("gid://shopify/InventoryItem/456"),
    ).toBe("gid://shopify/InventoryItem/456");
  });
  it("submits only requested native shipping fields and verifies a fresh read", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        inventoryItemUpdate: {
          inventoryItem: updatedItem,
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({ inventoryItem: updatedItem });
    updateInventoryItemShipping.initialize({ request } as any);

    const result = await updateInventoryItemShipping.execute({
      inventoryItemId: "123",
      weightValue: 1.25,
      weightUnit: "KILOGRAMS",
      requiresShipping: false,
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain(
      "inventoryItemUpdate(id: $id, input: $input)",
    );
    expect(request.mock.calls[0][1]).toEqual({
      id: "gid://shopify/InventoryItem/123",
      input: {
        measurement: { weight: { value: 1.25, unit: "KILOGRAMS" } },
        requiresShipping: false,
      },
    });
    expect(String(request.mock.calls[1][0])).toContain(
      "inventoryItem(id: $id)",
    );
    expect(String(request.mock.calls[1][0])).toContain("measurement");
    expect(String(request.mock.calls[1][0])).toContain("requiresShipping");
    expect(request.mock.calls[1][1]).toEqual({
      id: "gid://shopify/InventoryItem/123",
    });
    expect(result).toEqual({
      inventoryItem: updatedItem,
      userErrors: [],
      verified: updatedItem,
    });
  });
  it("surfaces Shopify user errors without issuing a verification read", async () => {
    const request = jest.fn().mockResolvedValueOnce({
      inventoryItemUpdate: {
        inventoryItem: null,
        userErrors: [
          { field: ["input", "measurement", "weight"], message: "Invalid weight" },
        ],
      },
    });
    updateInventoryItemShipping.initialize({ request } as any);

    await expect(
      updateInventoryItemShipping.execute({
        inventoryItemId: "123",
        weightValue: 1,
        weightUnit: "GRAMS",
      }),
    ).rejects.toThrow("input.measurement.weight: Invalid weight");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("fails when requested weight does not match the fresh read", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        inventoryItemUpdate: { inventoryItem: updatedItem, userErrors: [] },
      })
      .mockResolvedValueOnce({
        inventoryItem: {
          ...updatedItem,
          measurement: { weight: { value: 2, unit: "POUNDS" } },
        },
      });
    updateInventoryItemShipping.initialize({ request } as any);

    await expect(
      updateInventoryItemShipping.execute({
        inventoryItemId: "123",
        weightValue: 1.25,
        weightUnit: "KILOGRAMS",
      }),
    ).rejects.toThrow(
      'Fresh-read verification failed for weight: expected {"value":1.25,"unit":"KILOGRAMS"}, received {"value":2,"unit":"POUNDS"}',
    );
  });
  it("fails when requested requiresShipping does not match the fresh read", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        inventoryItemUpdate: { inventoryItem: updatedItem, userErrors: [] },
      })
      .mockResolvedValueOnce({
        inventoryItem: { ...updatedItem, requiresShipping: true },
      });
    updateInventoryItemShipping.initialize({ request } as any);

    await expect(
      updateInventoryItemShipping.execute({
        inventoryItemId: "gid://shopify/InventoryItem/123",
        requiresShipping: false,
      }),
    ).rejects.toThrow(
      "Fresh-read verification failed for requiresShipping: expected false, received true",
    );
    expect(request.mock.calls[0][1]).toEqual({
      id: "gid://shopify/InventoryItem/123",
      input: { requiresShipping: false },
    });
  });
});
