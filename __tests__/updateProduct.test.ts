import {
  buildInventoryItemInput,
  selectedOptionsToOptionValues,
  UpdateProductInputSchema,
  updateProduct,
  verifyCategorySet,
} from "../src/tools/updateProduct.js";

describe("update-product SEO forwarding", () => {
  it("accepts SEO and forwards it exactly through ProductSetInput", async () => {
    const request = jest.fn().mockResolvedValueOnce({ productSet: { product: {
      id: "gid://shopify/Product/123", title: "Product", handle: "product",
      descriptionHtml: "", vendor: "", productType: "", category: null,
      status: "DRAFT", tags: [], variants: { edges: [] }, images: { edges: [] },
    }, userErrors: [] } });
    expect(UpdateProductInputSchema.parse({ id: "123", seo: {
      title: "SEO title", description: "SEO description",
    }}).seo).toEqual({ title: "SEO title", description: "SEO description" });
    updateProduct.initialize({ request } as any);
    await updateProduct.execute({ id: "123", seo: {
      title: "SEO title", description: "SEO description",
    }});
    expect(request.mock.calls[0][1].input).toEqual({
      id: "gid://shopify/Product/123",
      seo: { title: "SEO title", description: "SEO description" },
    });
  });

  it("omits SEO when it is not provided", async () => {
    const request = jest.fn().mockResolvedValueOnce({ productSet: { product: {
      id: "gid://shopify/Product/123", title: "Product", handle: "product",
      descriptionHtml: "", vendor: "", productType: "", category: null,
      status: "DRAFT", tags: [], variants: { edges: [] }, images: { edges: [] },
    }, userErrors: [] } });
    updateProduct.initialize({ request } as any);
    await updateProduct.execute({ id: "123", title: "Product" });
    expect(request.mock.calls[0][1].input).toEqual({
      id: "gid://shopify/Product/123", title: "Product",
    });
  });
});

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
  it("reports a missing product when fetching the first variant for a simple field", async () => {
    const request = jest.fn().mockResolvedValueOnce({ product: null });

    updateProduct.initialize({ request } as any);
    await expect(
      updateProduct.execute({ id: "123", price: "9.99" }),
    ).rejects.toThrow(/Product not found/);
    expect(request).toHaveBeenCalledTimes(1);
  });

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
        inventoryItem: { sku: "018.568" },
      }],
    });
    expect(result.product.variants[0].sku).toBe("018.568");
  });
});

describe("update-product additional variant creation", () => {
  it("accepts optionValues publicly and sends them through productVariantsBulkCreate", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        productVariantsBulkCreate: {
          productVariants: [{
            id: "gid://shopify/ProductVariant/789",
            title: "DGK",
            price: "12.00",
            compareAtPrice: null,
            sku: "DGK-001",
            barcode: null,
          }],
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        product: {
          id: "gid://shopify/Product/123",
          title: "Profiles",
          handle: "profiles",
          descriptionHtml: "",
          vendor: "",
          productType: "",
          category: null,
          status: "ACTIVE",
          tags: [],
          variants: { edges: [{ node: {
            id: "gid://shopify/ProductVariant/456", title: "CGL", price: "10.00", compareAtPrice: null, sku: "CGL-001", barcode: null,
          } }, { node: {
            id: "gid://shopify/ProductVariant/789", title: "DGK", price: "12.00", compareAtPrice: null, sku: "DGK-001", barcode: null,
          } }] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    await updateProduct.execute({
      id: "123",
      variants: [{
        optionValues: [{ optionName: "Profile", name: "DGK" }],
        price: "12.00",
        sku: "DGK-001",
      }],
    } as any);

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain("productVariantsBulkCreate");
    expect(request.mock.calls[0][1]).toEqual({
      productId: "gid://shopify/Product/123",
      variants: [{
        optionValues: [{ optionName: "Profile", name: "DGK" }],
        price: "12.00",
        inventoryItem: { sku: "DGK-001" },
      }],
    });
  });
});

describe("update-product handle updates", () => {
  it("uses productUpdate with an atomic native redirect and no unrelated fields", async () => {
    const request = jest.fn().mockResolvedValueOnce({
      productUpdate: {
        product: {
          id: "gid://shopify/Product/123",
          title: "Keihin Float Bowl Screw",
          handle: "keihin-float-bowl-screw-n114-04160",
          descriptionHtml: "<p>Float bowl screw.</p>",
          vendor: "Keihin",
          productType: "Carburetor Part",
          category: null,
          status: "DRAFT",
          tags: ["hermes", "needs-review"],
          variants: { edges: [] },
          images: { edges: [] },
        },
        userErrors: [],
      },
    });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({
      id: "123",
      handle: "keihin-float-bowl-screw-n114-04160",
      redirectNewHandle: true,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toContain("productUpdate");
    expect(request.mock.calls[0][1]).toEqual({
      product: {
        id: "gid://shopify/Product/123",
        handle: "keihin-float-bowl-screw-n114-04160",
        redirectNewHandle: true,
      },
    });
    expect(result.product.handle).toBe("keihin-float-bowl-screw-n114-04160");
    expect(result.redirectNewHandle).toBe(true);
  });
});

describe("update-product buildInventoryItemInput", () => {
  it("returns undefined when neither sku nor cost is set", () => {
    expect(buildInventoryItemInput({})).toBeUndefined();
  });

  it("maps sku alone", () => {
    expect(buildInventoryItemInput({ sku: "ABC" })).toEqual({ sku: "ABC" });
  });

  it("maps cost alone", () => {
    expect(buildInventoryItemInput({ cost: "4.20" })).toEqual({ cost: "4.20" });
  });

  it("merges sku and cost into a single inventoryItem", () => {
    expect(buildInventoryItemInput({ sku: "ABC", cost: "4.20" })).toEqual({
      sku: "ABC",
      cost: "4.20",
    });
  });

  it("passes an empty-string sku through (clears the SKU)", () => {
    expect(buildInventoryItemInput({ sku: "" })).toEqual({ sku: "" });
  });
});

const PRODUCT_FIELDS = {
  id: "gid://shopify/Product/123", title: "Widget", handle: "widget",
  descriptionHtml: "", vendor: "", productType: "", category: null,
  status: "ACTIVE", tags: [],
};

describe("update-product cost per item", () => {
  it("sends cost via inventoryItem on productVariantsBulkUpdate and reads unitCost back", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: {
          ...PRODUCT_FIELDS,
          variants: { edges: [{ node: {
            id: "gid://shopify/ProductVariant/456", title: "Default Title",
            price: "10.00", compareAtPrice: null, sku: "W-1", barcode: null,
            inventoryItem: { unitCost: { amount: "4.20" } },
          } }] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({
      id: "123",
      variants: [{ id: "456", sku: "W-1", cost: "4.20" }],
    });

    // Explicit variant IDs need no preflight fetch
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain("productVariantsBulkUpdate");
    expect(request.mock.calls[0][1]).toEqual({
      productId: "gid://shopify/Product/123",
      variants: [{
        id: "gid://shopify/ProductVariant/456",
        inventoryItem: { sku: "W-1", cost: "4.20" },
      }],
    });
    // unitCost needs read_inventory, so it is only selected when cost was written
    expect(String(request.mock.calls[1][0])).toContain("unitCost");
    expect(result.product.variants[0]).toEqual({
      id: "gid://shopify/ProductVariant/456", title: "Default Title",
      price: "10.00", compareAtPrice: null, sku: "W-1", barcode: null,
      cost: "4.20",
    });
  });

  it("does not select unitCost or return cost when no cost was written", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: { variants: { edges: [{ node: {
          id: "gid://shopify/ProductVariant/456",
          selectedOptions: [{ name: "Title", value: "Default Title" }],
        } }] } },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: {
          ...PRODUCT_FIELDS,
          variants: { edges: [{ node: {
            id: "gid://shopify/ProductVariant/456", title: "Default Title",
            price: "12.00", compareAtPrice: null, sku: null, barcode: null,
          } }] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({ id: "123", price: "12.00" });

    expect(String(request.mock.calls[2][0])).not.toContain("unitCost");
    expect(result.product.variants[0]).not.toHaveProperty("cost");
  });

  it("sends cost via inventoryItem when creating new variants", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        productVariantsBulkCreate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: { ...PRODUCT_FIELDS, variants: { edges: [] }, images: { edges: [] } },
      });

    updateProduct.initialize({ request } as any);
    await updateProduct.execute({
      id: "123",
      variants: [{
        optionValues: [{ optionName: "Size", name: "Large" }],
        price: "12.00",
        sku: "W-L",
        cost: "5.00",
      }],
    });

    expect(request.mock.calls[0][1]).toEqual({
      productId: "gid://shopify/Product/123",
      variants: [{
        optionValues: [{ optionName: "Size", name: "Large" }],
        price: "12.00",
        inventoryItem: { sku: "W-L", cost: "5.00" },
      }],
    });
  });

  it("uses the simple cost field to update the first variant", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: { variants: { edges: [{ node: {
          id: "gid://shopify/ProductVariant/456",
          selectedOptions: [{ name: "Title", value: "Default Title" }],
        } }] } },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: { ...PRODUCT_FIELDS, variants: { edges: [] }, images: { edges: [] } },
      });

    updateProduct.initialize({ request } as any);
    await updateProduct.execute({ id: "123", cost: "3.00" });

    expect(request.mock.calls[1][1].variants).toEqual([{
      id: "gid://shopify/ProductVariant/456",
      inventoryItem: { cost: "3.00" },
    }]);
  });
});

describe("update-product renameOption", () => {
  const options = [
    { id: "gid://shopify/ProductOption/1", name: "Voltage" },
    { id: "gid://shopify/ProductOption/2", name: "Size" },
  ];

  it("renames via productOptionUpdate, verifies the result, and reads the product back", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ product: { options } })
      .mockResolvedValueOnce({
        productOptionUpdate: {
          product: { options: [
            { id: "gid://shopify/ProductOption/1", name: "Model" },
            { id: "gid://shopify/ProductOption/2", name: "Size" },
          ] },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        product: {
          ...PRODUCT_FIELDS,
          options: [
            { id: "gid://shopify/ProductOption/1", name: "Model" },
            { id: "gid://shopify/ProductOption/2", name: "Size" },
          ],
          variants: { edges: [] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({
      id: "123",
      renameOption: { from: "Voltage", to: "Model" },
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(String(request.mock.calls[1][0])).toContain("productOptionUpdate");
    expect(request.mock.calls[1][1]).toEqual({
      productId: "gid://shopify/Product/123",
      option: { id: "gid://shopify/ProductOption/1", name: "Model" },
    });
    expect(String(request.mock.calls[2][0])).not.toContain("productSet");
    expect(result.product.options).toEqual([
      { id: "gid://shopify/ProductOption/1", name: "Model" },
      { id: "gid://shopify/ProductOption/2", name: "Size" },
    ]);
  });

  it("lists the product's actual options when `from` does not match", async () => {
    const request = jest.fn().mockResolvedValueOnce({ product: { options } });

    updateProduct.initialize({ request } as any);
    await expect(
      updateProduct.execute({ id: "123", renameOption: { from: "Colour", to: "Color" } }),
    ).rejects.toThrow(/Option "Colour" not found on product \(has: Voltage, Size\)/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("throws when Shopify returns no userErrors but the rename did not apply", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ product: { options } })
      .mockResolvedValueOnce({
        productOptionUpdate: { product: { options }, userErrors: [] },
      });

    updateProduct.initialize({ request } as any);
    await expect(
      updateProduct.execute({ id: "123", renameOption: { from: "Voltage", to: "Model" } }),
    ).rejects.toThrow(/Option rename did not apply/);
  });

  it("runs the rename before other product-level changes", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({ product: { options } })
      .mockResolvedValueOnce({
        productOptionUpdate: {
          product: { options: [
            { id: "gid://shopify/ProductOption/1", name: "Model" },
            { id: "gid://shopify/ProductOption/2", name: "Size" },
          ] },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productSet: {
          product: { ...PRODUCT_FIELDS, title: "Renamed", variants: { edges: [] }, images: { edges: [] } },
          userErrors: [],
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({
      id: "123",
      title: "Renamed",
      renameOption: { from: "Voltage", to: "Model" },
    });

    expect(String(request.mock.calls[1][0])).toContain("productOptionUpdate");
    expect(String(request.mock.calls[2][0])).toContain("productSet");
    expect(request.mock.calls[2][1].input).toEqual({
      id: "gid://shopify/Product/123",
      title: "Renamed",
    });
    expect(result.product.title).toBe("Renamed");
  });
});

describe("update-product combined product-level and variant edits", () => {
  it("creates variants, writes product and first-variant edits, then reads back once", async () => {
    const firstVariantId = "gid://shopify/ProductVariant/456";
    const updatedVariant = {
      id: firstVariantId, title: "M", price: "9.99",
      compareAtPrice: null, sku: null, barcode: null,
    };
    const createdVariant = {
      id: "gid://shopify/ProductVariant/789", title: "L", price: "5.00",
      compareAtPrice: null, sku: null, barcode: null,
    };
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: { variants: { edges: [{ node: { id: firstVariantId } }] } },
      })
      .mockResolvedValueOnce({
        productVariantsBulkCreate: { productVariants: [createdVariant], userErrors: [] },
      })
      .mockResolvedValueOnce({
        productSet: {
          product: { ...PRODUCT_FIELDS, title: "X", variants: { edges: [] }, images: { edges: [] } },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [updatedVariant], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: {
          ...PRODUCT_FIELDS, title: "X",
          variants: { edges: [{ node: updatedVariant }, { node: createdVariant }] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({
      id: "123", title: "X", price: "9.99",
      variants: [{ optionValues: [{ optionName: "Size", name: "L" }], price: "5.00" }],
    });

    expect(request).toHaveBeenCalledTimes(5);
    expect(String(request.mock.calls[0][0])).toContain("query getProduct");
    expect(String(request.mock.calls[1][0])).toContain("mutation productVariantsBulkCreate");
    expect(request.mock.calls[1][1]).toEqual({
      productId: "gid://shopify/Product/123",
      variants: [{ optionValues: [{ optionName: "Size", name: "L" }], price: "5.00" }],
    });
    expect(String(request.mock.calls[2][0])).toContain("mutation productSet");
    expect(request.mock.calls[2][1].input).toEqual({
      id: "gid://shopify/Product/123", title: "X",
    });
    expect(String(request.mock.calls[3][0])).toContain("mutation productVariantsBulkUpdate");
    expect(request.mock.calls[3][1].variants).toEqual([{ id: firstVariantId, price: "9.99" }]);
    expect(String(request.mock.calls[4][0])).toContain("query getUpdatedProduct");
    expect(result.product.title).toBe("X");
    expect(result.product.variants).toEqual([updatedVariant, createdVariant]);
  });

  it("splits {title, cost} into productSet then productVariantsBulkUpdate", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: { variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/456" } }] } },
      })
      .mockResolvedValueOnce({
        productSet: {
          product: { ...PRODUCT_FIELDS, title: "New title", variants: { edges: [] }, images: { edges: [] } },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: {
          ...PRODUCT_FIELDS,
          title: "New title",
          variants: { edges: [{ node: {
            id: "gid://shopify/ProductVariant/456", title: "Default Title",
            price: "10.00", compareAtPrice: null, sku: null, barcode: null,
            inventoryItem: { unitCost: { amount: "3.00" } },
          } }] },
          images: { edges: [] },
        },
      });

    updateProduct.initialize({ request } as any);
    const result = await updateProduct.execute({ id: "123", title: "New title", cost: "3.00" });

    expect(request).toHaveBeenCalledTimes(4);
    expect(String(request.mock.calls[1][0])).toContain("productSet");
    // productSet payload carries no variants (full-sync semantics would delete the rest)
    expect(request.mock.calls[1][1].input).toEqual({
      id: "gid://shopify/Product/123",
      title: "New title",
    });
    expect(String(request.mock.calls[2][0])).toContain("productVariantsBulkUpdate");
    expect(request.mock.calls[2][1].variants).toEqual([{
      id: "gid://shopify/ProductVariant/456",
      inventoryItem: { cost: "3.00" },
    }]);
    expect(result.product.title).toBe("New title");
    expect(result.product.variants[0].cost).toBe("3.00");
  });

  it("never sends variants through productSet for {title, price}", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        product: { variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/456" } }] } },
      })
      .mockResolvedValueOnce({
        productSet: {
          product: { ...PRODUCT_FIELDS, variants: { edges: [] }, images: { edges: [] } },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantsBulkUpdate: { productVariants: [], userErrors: [] },
      })
      .mockResolvedValueOnce({
        product: { ...PRODUCT_FIELDS, variants: { edges: [] }, images: { edges: [] } },
      });

    updateProduct.initialize({ request } as any);
    await updateProduct.execute({ id: "123", title: "T", price: "9.99" });

    expect(request.mock.calls[1][1].input).not.toHaveProperty("variants");
    expect(request.mock.calls[2][1].variants).toEqual([{
      id: "gid://shopify/ProductVariant/456",
      price: "9.99",
    }]);
  });

  it("rejects a mixed create/update variant payload before renaming the option", async () => {
    const request = jest.fn();

    updateProduct.initialize({ request } as any);
    await expect(
      updateProduct.execute({
        id: "123",
        renameOption: { from: "Voltage", to: "Model" },
        variants: [
          { id: "456", price: "1.00" },
          { optionValues: [{ optionName: "Model", name: "24V" }], price: "2.00" },
        ],
      }),
    ).rejects.toThrow(/cannot be mixed/);

    // No mutation ran, so nothing is left half-applied
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a variant entry with neither id nor optionValues before any write", async () => {
    const request = jest.fn();

    updateProduct.initialize({ request } as any);
    await expect(
      updateProduct.execute({ id: "123", variants: [{ price: "1.00" }] }),
    ).rejects.toThrow(/needs an id .* or optionValues/);
    expect(request).not.toHaveBeenCalled();
  });
});
