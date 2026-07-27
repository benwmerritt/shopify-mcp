import {
  selectedOptionsToOptionValues,
  updateProduct,
  verifyCategorySet,
} from "../src/tools/updateProduct.js";

describe("update-product variant option preservation", () => {
  it("maps selectedOptions to ProductSetInput optionValues", () => {
    expect(
      selectedOptionsToOptionValues([
        { name: "Title", value: "Default Title" },
        { name: "Size", value: "Large" },
      ]),
    ).toEqual([
      { optionName: "Title", name: "Default Title" },
      { optionName: "Size", name: "Large" },
    ]);
  });
});

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

describe("update-product variant-only updates", () => {
  it("uses productVariantsBulkUpdate for a SKU-only update", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: {
          variants: {
            edges: [{
              node: {
                id: "gid://shopify/ProductVariant/456",
                selectedOptions: [{ name: "Title", value: "Default Title" }],
              },
            }],
          },
        },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: {
          productVariants: [{
            id: "gid://shopify/ProductVariant/456",
            title: "Default Title",
            price: "10.00",
            compareAtPrice: null,
            sku: "018.568",
            barcode: null,
          }],
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        product: {
          id: "gid://shopify/Product/123",
          title: "Keihin Idle Adjuster",
          handle: "keihin-idle-adjuster",
          descriptionHtml: "<p>Idle adjuster.</p>",
          vendor: "Keihin",
          productType: "Parts",
          category: null,
          status: "DRAFT",
          tags: ["hermes", "needs-review"],
          variants: {
            edges: [{
              node: {
                id: "gid://shopify/ProductVariant/456",
                title: "Default Title",
                price: "10.00",
                compareAtPrice: null,
                sku: "018.568",
                barcode: null,
              },
            }],
          },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({ id: "123", sku: "018.568" });

    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[1][0])).toContain("productVariantsBulkUpdate");
    expect(String(request.mock.calls[1][0])).not.toContain("productSet");
    expect(request.mock.calls[1][1]).toEqual({
      productId: "gid://shopify/Product/123",
      variants: [{
        id: "gid://shopify/ProductVariant/456",
        sku: "018.568",
      }],
    });
    expect(result.product.variants[0].sku).toBe("018.568");
  });
});
