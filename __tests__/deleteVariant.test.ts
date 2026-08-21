import { DeleteVariantInputSchema, deleteVariant } from "../src/tools/deleteVariant.js";

describe("deleteVariant", () => {
  it("requires both product and variant identifiers", () => {
    expect(DeleteVariantInputSchema.safeParse({ variantId: "1" }).success).toBe(false);
    expect(DeleteVariantInputSchema.safeParse({ productId: "2", variantId: "1" }).success).toBe(true);
  });

  it("uses productVariantsBulkDelete with normalized IDs", async () => {
    const request = jest.fn().mockResolvedValue({
      productVariantsBulkDelete: {
        product: {
          id: "gid://shopify/Product/2",
          title: "Needles",
          variantsCount: { count: 5 },
        },
        userErrors: [],
      },
    });
    deleteVariant.initialize({ request } as any);

    const result = await deleteVariant.execute({ productId: "2", variantId: "1" });

    expect(request).toHaveBeenCalledTimes(1);
    const [query, variables] = request.mock.calls[0];
    expect(query).toContain("productVariantsBulkDelete");
    expect(query).not.toContain("productVariantDelete(");
    expect(variables).toEqual({
      productId: "gid://shopify/Product/2",
      variantsIds: ["gid://shopify/ProductVariant/1"],
    });
    expect(result).toMatchObject({
      success: true,
      deletedVariantId: "gid://shopify/ProductVariant/1",
      product: { remainingVariants: 5 },
    });
  });
});
