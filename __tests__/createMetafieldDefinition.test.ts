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

  it("accepts typed access permissions and rejects unsupported values", () => {
    const input = {
      name: "Gallery", namespace: "custom", key: "gallery",
      ownerType: "COLLECTION", type: "list.metaobject_reference",
    };
    expect(createMetafieldDefinition.schema.parse({
      ...input, access: { storefront: "PUBLIC_READ" },
    }).access).toEqual({ storefront: "PUBLIC_READ" });
    for (const access of [
      { storefront: "PUBLIC_WRITE" }, { admin: "PUBLIC_READ" },
      { storefront: "PUBLIC_READ", unsupported: true },
    ]) {
      expect(() => createMetafieldDefinition.schema.parse({ ...input, access })).toThrow();
    }
  });

  it.each([
    { storefront: "PUBLIC_READ" as const },
    { admin: "MERCHANT_READ_WRITE" as const },
    { admin: "MERCHANT_READ_WRITE" as const, storefront: "PUBLIC_READ" as const },
  ])("forwards and freshly verifies explicit access %j", async (access) => {
    const request = jest.fn()
      .mockResolvedValueOnce({ metafieldDefinitionCreate: { createdDefinition: definition, userErrors: [] } })
      .mockResolvedValueOnce({ metafieldDefinition: definition });
    createMetafieldDefinition.initialize({ request } as never);
    const result = await createMetafieldDefinition.execute({
      name: definition.name, namespace: definition.namespace, key: definition.key,
      ownerType: "PRODUCT", type: definition.type.name,
      description: definition.description, access,
    });
    expect(request.mock.calls[0][1].definition.access).toEqual(access);
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.verified.access).toEqual(definition.access);
  });

  it.each([
    { admin: "MERCHANT_READ_WRITE" as const },
    { storefront: "PUBLIC_READ" as const },
  ])("rejects an explicit access read-back mismatch %j", async (access) => {
    const request = jest.fn()
      .mockResolvedValueOnce({ metafieldDefinitionCreate: { createdDefinition: definition, userErrors: [] } })
      .mockResolvedValueOnce({ metafieldDefinition: {
        ...definition, access: { admin: "MERCHANT_READ", storefront: "NONE" },
      } });
    createMetafieldDefinition.initialize({ request } as never);
    await expect(createMetafieldDefinition.execute({
      name: definition.name, namespace: definition.namespace, key: definition.key,
      ownerType: "PRODUCT", type: definition.type.name,
      description: definition.description, access,
    })).rejects.toThrow("does not match submitted values");
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
