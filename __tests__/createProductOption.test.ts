import { createProductOption, CreateProductOptionInputSchema } from "../src/tools/createProductOption.js";

describe("create-product-option", () => {
  it("validates a product option payload", () => {
    expect(CreateProductOptionInputSchema.safeParse({
      productId: "123",
      name: "Profile",
      values: ["DBK"],
    }).success).toBe(true);
  });

  it("sends productOptionsCreate and fresh-reads the product", async () => {
    const product = {
      id: "gid://shopify/Product/123",
      title: "Needles",
      status: "DRAFT",
      options: [{ id: "gid://shopify/ProductOption/1", name: "Profile", position: 2, optionValues: [{ id: "gid://shopify/ProductOptionValue/1", name: "DBK" }] }],
      variants: { edges: [] },
    };
    const request = jest.fn()
      .mockResolvedValueOnce({ productOptionsCreate: { product, userErrors: [] } })
      .mockResolvedValueOnce({ product });
    createProductOption.initialize({ request } as any);

    const result = await createProductOption.execute({
      productId: "123",
      name: "Profile",
      values: ["DBK"],
      variantStrategy: "LEAVE_AS_IS",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain("productOptionsCreate");
    expect(request.mock.calls[0][1]).toEqual({
      productId: "gid://shopify/Product/123",
      options: [{ name: "Profile", values: [{ name: "DBK" }] }],
      variantStrategy: "LEAVE_AS_IS",
    });
    expect(result.verified).toEqual(product);
  });
});
