import { buildVariantInput, formatUserErrors, verifyCategorySet } from "../src/tools/updateProduct.js";

describe("update-product verifyCategorySet", () => {
  const gid = "gid://shopify/TaxonomyCategory/vp-2-2-3-2";

  it("passes silently when the returned category matches the requested GID", () => {
    expect(() =>
      verifyCategorySet(
        { category: { id: gid } },
        gid,
      ),
    ).not.toThrow();
  });

  it("throws a clear error when the returned category is null (Shopify silently dropped the GID)", () => {
    expect(() =>
      verifyCategorySet({ category: null }, gid),
    ).toThrow(/did not stick.*got back null.*search-taxonomy/i);
  });

  it("throws when the returned category is a different GID than requested", () => {
    expect(() =>
      verifyCategorySet(
        { category: { id: "gid://shopify/TaxonomyCategory/vp-2-2-3" } },
        gid,
      ),
    ).toThrow(/did not stick.*vp-2-2-3.*search-taxonomy/i);
  });
});

describe("update-product buildVariantInput", () => {
  const id = "gid://shopify/ProductVariant/123";

  it("passes price, compareAtPrice and barcode through unchanged", () => {
    expect(
      buildVariantInput(id, { price: "9.95", compareAtPrice: "12.95", barcode: "abc" }),
    ).toEqual({ id, price: "9.95", compareAtPrice: "12.95", barcode: "abc" });
  });

  it("maps sku to inventoryItem.sku (no top-level sku on ProductVariantsBulkInput)", () => {
    const input = buildVariantInput(id, { sku: "NEW-SKU" });
    expect(input).toEqual({ id, inventoryItem: { sku: "NEW-SKU" } });
    expect(input).not.toHaveProperty("sku");
  });

  it("omits fields that were not provided", () => {
    expect(buildVariantInput(id, { price: "5.00" })).toEqual({ id, price: "5.00" });
  });

  it("passes an empty-string sku through (clears the SKU)", () => {
    expect(buildVariantInput(id, { sku: "" })).toEqual({ id, inventoryItem: { sku: "" } });
  });
});

describe("update-product formatUserErrors", () => {
  it("formats field path and message", () => {
    expect(formatUserErrors([{ field: ["variants", "price"], message: "is invalid" }])).toBe(
      "variants.price: is invalid",
    );
  });

  it("omits the colon when field is null (no leading ': message')", () => {
    expect(formatUserErrors([{ field: null, message: "Something went wrong" }])).toBe(
      "Something went wrong",
    );
  });

  it("joins multiple errors with commas", () => {
    expect(
      formatUserErrors([
        { field: ["title"], message: "can't be blank" },
        { field: null, message: "rate limited" },
      ]),
    ).toBe("title: can't be blank, rate limited");
  });
});
