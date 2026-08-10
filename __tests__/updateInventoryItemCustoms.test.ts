import {
  UpdateInventoryItemCustomsInputSchema,
  normalizeInventoryItemId,
  updateInventoryItemCustoms,
} from "../src/tools/updateInventoryItemCustoms.js";

const updatedItem = {
  id: "gid://shopify/InventoryItem/123",
  sku: "SKU-123",
  countryCodeOfOrigin: "JP",
  provinceCodeOfOrigin: "13",
  harmonizedSystemCode: "840991",
  tracked: true,
  requiresShipping: true,
  updatedAt: "2026-08-10T12:00:00Z",
};

describe("update-inventory-item-customs", () => {
  it("exports a narrow public schema and rejects zero-field updates", () => {
    expect(
      UpdateInventoryItemCustomsInputSchema.parse({
        inventoryItemId: "123",
        countryCodeOfOrigin: "JP",
        provinceCodeOfOrigin: "13",
        harmonizedSystemCode: "840991",
      }),
    ).toEqual({
      inventoryItemId: "123",
      countryCodeOfOrigin: "JP",
      provinceCodeOfOrigin: "13",
      harmonizedSystemCode: "840991",
    });

    expect(() =>
      UpdateInventoryItemCustomsInputSchema.parse({ inventoryItemId: "123" }),
    ).toThrow("At least one customs field must be provided");
    expect(() =>
      UpdateInventoryItemCustomsInputSchema.parse({
        inventoryItemId: "123",
        countryCodeOfOrigin: "jp",
      }),
    ).toThrow();
    expect(() =>
      UpdateInventoryItemCustomsInputSchema.parse({
        inventoryItemId: "123",
        harmonizedSystemCode: "12345",
      }),
    ).toThrow();
  });

  it("normalizes numeric inventory item IDs and preserves valid GIDs", () => {
    expect(normalizeInventoryItemId("123")).toBe(
      "gid://shopify/InventoryItem/123",
    );
    expect(
      normalizeInventoryItemId("gid://shopify/InventoryItem/456"),
    ).toBe("gid://shopify/InventoryItem/456");
  });

  it("sends only customs fields and verifies them with a fresh typed read", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        inventoryItemUpdate: {
          inventoryItem: updatedItem,
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({ inventoryItem: updatedItem });
    updateInventoryItemCustoms.initialize({ request } as any);

    const result = await updateInventoryItemCustoms.execute({
      inventoryItemId: "123",
      countryCodeOfOrigin: "JP",
      provinceCodeOfOrigin: "13",
      harmonizedSystemCode: "840991",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain(
      "inventoryItemUpdate(id: $id, input: $input)",
    );
    expect(request.mock.calls[0][1]).toEqual({
      id: "gid://shopify/InventoryItem/123",
      input: {
        countryCodeOfOrigin: "JP",
        provinceCodeOfOrigin: "13",
        harmonizedSystemCode: "840991",
      },
    });
    expect(String(request.mock.calls[1][0])).toContain(
      "inventoryItem(id: $id)",
    );
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
          { field: ["input", "countryCodeOfOrigin"], message: "Invalid country" },
        ],
      },
    });
    updateInventoryItemCustoms.initialize({ request } as any);

    await expect(
      updateInventoryItemCustoms.execute({
        inventoryItemId: "123",
        countryCodeOfOrigin: "ZZ",
      }),
    ).rejects.toThrow("input.countryCodeOfOrigin: Invalid country");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails when a submitted field does not match the fresh read", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        inventoryItemUpdate: {
          inventoryItem: updatedItem,
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        inventoryItem: { ...updatedItem, countryCodeOfOrigin: "US" },
      });
    updateInventoryItemCustoms.initialize({ request } as any);

    await expect(
      updateInventoryItemCustoms.execute({
        inventoryItemId: "123",
        countryCodeOfOrigin: "JP",
      }),
    ).rejects.toThrow(
      'Fresh-read verification failed for countryCodeOfOrigin: expected "JP", received "US"',
    );
  });
});
