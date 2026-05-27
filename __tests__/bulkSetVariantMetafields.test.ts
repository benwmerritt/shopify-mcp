import {
  chunk,
  buildUniformUpdates,
  buildPerVariantUpdates,
} from "../src/tools/bulkSetVariantMetafields.js";

describe("bulk-set-variant-metafields helpers", () => {
  it("chunks arrays at the size boundary", () => {
    const arr = Array.from({ length: 5 }, (_, i) => i);
    expect(chunk(arr, 2)).toEqual([[0, 1], [2, 3], [4]]);
    // 250-variant cap: 250 -> 1 chunk, 251 -> 2 chunks.
    expect(chunk(Array.from({ length: 250 }), 250)).toHaveLength(1);
    expect(chunk(Array.from({ length: 251 }), 250)).toHaveLength(2);
    expect(chunk([], 250)).toEqual([]);
  });

  it("fans uniform metafields out to every variant and normalizes IDs", () => {
    const updates = buildUniformUpdates(
      ["111", "gid://shopify/ProductVariant/222"],
      [{ namespace: "custom", key: "sale_type", value: "gid://shopify/Metaobject/9", type: "metaobject_reference" }],
    );

    expect(updates).toEqual([
      {
        id: "gid://shopify/ProductVariant/111",
        metafields: [
          { namespace: "custom", key: "sale_type", value: "gid://shopify/Metaobject/9", type: "metaobject_reference" },
        ],
      },
      {
        id: "gid://shopify/ProductVariant/222",
        metafields: [
          { namespace: "custom", key: "sale_type", value: "gid://shopify/Metaobject/9", type: "metaobject_reference" },
        ],
      },
    ]);
  });

  it("omits the type key when not provided (so Shopify infers from the definition)", () => {
    const updates = buildUniformUpdates(
      ["1"],
      [{ namespace: "custom", key: "jet_size", value: "142" }],
    );

    expect(updates[0].metafields[0]).not.toHaveProperty("type");
    expect(updates[0].metafields[0]).toEqual({
      namespace: "custom",
      key: "jet_size",
      value: "142",
    });
  });

  it("maps per-variant metafields with distinct values", () => {
    const updates = buildPerVariantUpdates([
      { variantId: "1", metafields: [{ namespace: "custom", key: "jet_size", value: "142" }] },
      { variantId: "gid://shopify/ProductVariant/2", metafields: [{ namespace: "custom", key: "jet_size", value: "38" }] },
    ]);

    expect(updates).toEqual([
      { id: "gid://shopify/ProductVariant/1", metafields: [{ namespace: "custom", key: "jet_size", value: "142" }] },
      { id: "gid://shopify/ProductVariant/2", metafields: [{ namespace: "custom", key: "jet_size", value: "38" }] },
    ]);
  });
});
