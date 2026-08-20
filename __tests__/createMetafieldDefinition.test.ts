import { createMetafieldDefinition } from "../src/tools/createMetafieldDefinition.js";

const definition = {
  id: "gid://shopify/MetafieldDefinition/123",
  name: "Spigot outer diameter",
  namespace: "custom",
  key: "spigot_outer_diameter_mm",
  description: "Engine-side carburetor spigot outside diameter in millimetres.",
  type: { name: "number_decimal", category: "NUMBER" },
  ownerType: "PRODUCT",
  pinnedPosition: null,
  validations: [],
  access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
};

describe("create-metafield-definition", () => {
  it("accepts product number definitions", () => {
    expect(() =>
      createMetafieldDefinition.schema.parse({
        name: "Spigot outer diameter",
        namespace: "custom",
        key: "spigot_outer_diameter_mm",
        ownerType: "PRODUCT",
        type: "number_decimal",
        description: "Engine-side carburetor spigot outside diameter in millimetres.",
      }),
    ).not.toThrow();
  });

  it("creates a definition, preserves mutation evidence, and independently verifies it", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        metafieldDefinitionCreate: {
          createdDefinition: definition,
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({ metafieldDefinition: definition });
    createMetafieldDefinition.initialize({ request } as never);

    const result = await createMetafieldDefinition.execute({
      name: "Spigot outer diameter",
      namespace: "custom",
      key: "spigot_outer_diameter_mm",
      ownerType: "PRODUCT",
      type: "number_decimal",
      description: "Engine-side carburetor spigot outside diameter in millimetres.",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toEqual({
      definition: {
        name: "Spigot outer diameter",
        namespace: "custom",
        key: "spigot_outer_diameter_mm",
        ownerType: "PRODUCT",
        type: "number_decimal",
        description: "Engine-side carburetor spigot outside diameter in millimetres.",
      },
    });
    expect(request.mock.calls[1][1]).toEqual({
      identifier: {
        namespace: "custom",
        key: "spigot_outer_diameter_mm",
        ownerType: "PRODUCT",
      },
    });
    expect(result.mutation.userErrors).toEqual([]);
    expect(result.verified).toEqual(
      expect.objectContaining({
        id: "gid://shopify/MetafieldDefinition/123",
        fullKey: "custom.spigot_outer_diameter_mm",
        ownerType: "PRODUCT",
        type: { name: "number_decimal", category: "NUMBER" },
      }),
    );
  });

  it("rejects a verification mismatch", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        metafieldDefinitionCreate: { createdDefinition: definition, userErrors: [] },
      })
      .mockResolvedValueOnce({
        metafieldDefinition: {
          ...definition,
          type: { name: "single_line_text_field", category: "TEXT" },
        },
      });
    createMetafieldDefinition.initialize({ request } as never);

    await expect(
      createMetafieldDefinition.execute({
        name: "Spigot outer diameter",
        namespace: "custom",
        key: "spigot_outer_diameter_mm",
        ownerType: "PRODUCT",
        type: "number_decimal",
        description: "Engine-side carburetor spigot outside diameter in millimetres.",
      }),
    ).rejects.toThrow("does not match submitted values");
  });
});
