import { products } from "../src/tools/products.js";

describe("products field selection", () => {
  const product = {
    id: "gid://shopify/Product/123",
    title: "Needles",
    description: "Product description",
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
});

export {};
