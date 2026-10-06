import { products } from "../src/tools/products.js";

describe("products field selection", () => {
  const product = {
    id: "gid://shopify/Product/123",
    title: "Needles",
    description: "Product description",
    descriptionHtml: "<p>Product <strong>description</strong></p>",
    handle: "needles",
    status: "ACTIVE",
    vendor: "Show & Go",
    productType: "Part",
    category: { id: "gid://shopify/TaxonomyCategory/1", name: "Parts", fullName: "Parts" },
    tags: ["tag-a"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    totalInventory: 3,
    images: { edges: [{ node: { id: "image-1", url: "https://example.com/image.jpg", altText: null, width: 100, height: 100 } }] },
    variants: { edges: [{ node: { id: "variant-1", title: "Default", price: "10.00", inventoryQuantity: 3, sku: "SKU-1", selectedOptions: [] } }] },
    collections: { edges: [{ node: { id: "collection-1", title: "Parts" } }] },
    priceRangeV2: {
      minVariantPrice: { amount: "10.00", currencyCode: "AUD" },
      maxVariantPrice: { amount: "12.00", currencyCode: "AUD" },
    },
  };

  function initializeAndExecute(fields: string | string[]) {
    const request = jest.fn().mockResolvedValue({ product });
    products.initialize({ request } as any);
    return products.execute({ id: "123", fields, limit: 50 } as any) as Promise<any>;
  }

  it("returns every formatted product field for the full preset", async () => {
    const result = await initializeAndExecute("full");
    expect(result.product).toEqual({
      id: "gid://shopify/Product/123",
      title: "Needles",
      description: "Product description",
      descriptionHtml: "<p>Product <strong>description</strong></p>",
      handle: "needles",
      status: "ACTIVE",
      vendor: "Show & Go",
      productType: "Part",
      category: product.category,
      tags: ["tag-a"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      totalInventory: 3,
      hasImages: true,
      priceRange: {
        minPrice: { amount: "10.00", currencyCode: "AUD" },
        maxPrice: { amount: "12.00", currencyCode: "AUD" },
      },
      images: product.images.edges.map(({ node }) => node),
      variantsCount: null,
      variants: [{ ...product.variants.edges[0].node, options: [] }],
      collections: product.collections.edges.map(({ node }) => node),
    });
  });

  it("keeps the slim preset unchanged", async () => {
    const result = await initializeAndExecute("slim");
    expect(Object.keys(result.product)).toEqual([
      "id", "title", "handle", "vendor", "status", "tags", "category",
    ]);
  });

  it("returns the standard preset fields", async () => {
    const result = await initializeAndExecute("standard");
    expect(Object.keys(result.product)).toEqual([
      "id", "title", "handle", "vendor", "status", "tags", "category",
      "description", "productType", "createdAt", "updatedAt", "totalInventory",
      "priceRange", "hasImages",
    ]);
  });

  it("falls back to slim for an unknown preset", async () => {
    const result = await initializeAndExecute("unknown" as any);
    expect(Object.keys(result.product)).toEqual([
      "id", "title", "handle", "vendor", "status", "tags", "category",
    ]);
  });

  it("returns exactly the fields supplied in an array", async () => {
    const result = await initializeAndExecute(["title", "images"]);
    expect(result.product).toEqual({ title: "Needles", images: product.images.edges.map(({ node }) => node) });
  });

  it("returns the exact HTML field for an explicit descriptionHtml read", async () => {
    const result = await initializeAndExecute(["descriptionHtml"]);
    expect(result.product).toEqual({
      descriptionHtml: "<p>Product <strong>description</strong></p>",
    });
  });
});

export {};

describe("products single-product variant paging", () => {
  it("returns every variant past the first page, and the total count", async () => {
    const node = (i: number) => ({ id: `variant-${i}`, title: `V${i}`, price: "1.00", inventoryQuantity: 0, sku: `S${i}`, selectedOptions: [] });
    const first = Array.from({ length: 250 }, (_, i) => ({ node: node(i) }));
    const second = Array.from({ length: 10 }, (_, i) => ({ node: node(250 + i) }));
    const product = {
      id: "gid://shopify/Product/9", title: "Big family", description: "", descriptionHtml: "", handle: "big",
      status: "DRAFT", vendor: "Keihin", productType: "", category: null, tags: [],
      createdAt: "", updatedAt: "", totalInventory: 0,
      images: { edges: [] }, collections: { edges: [] },
      priceRangeV2: { minVariantPrice: { amount: "1.00", currencyCode: "AUD" }, maxVariantPrice: { amount: "1.00", currencyCode: "AUD" } },
      variantsCount: { count: 260 },
      variants: { edges: first, pageInfo: { hasNextPage: true, endCursor: "c1" } },
    };
    const request = jest.fn()
      .mockResolvedValueOnce({ product })
      .mockResolvedValueOnce({ product: { variants: { edges: second, pageInfo: { hasNextPage: false, endCursor: "c2" } } } });
    products.initialize({ request } as any);
    const result = (await products.execute({ id: "9", fields: ["variants", "variantsCount"], limit: 50 } as any)) as any;
    expect(result.product.variants).toHaveLength(260);
    expect(result.product.variantsCount).toBe(260);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toEqual({ id: "gid://shopify/Product/9", after: "c1" });
  });
});
