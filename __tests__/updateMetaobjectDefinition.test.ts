import { updateMetaobjectDefinition } from "../src/tools/updateMetaobjectDefinition.js";

describe("update-metaobject-definition", () => {
  it("accepts additive field definitions with validations", () => {
    expect(() =>
      updateMetaobjectDefinition.schema.parse({
        id: "gid://shopify/MetaobjectDefinition/1",
        fields: [
          {
            key: "hotspots",
            name: "Hotspots",
            description: "Interactive diagram hotspots",
            type: "json",
            required: false,
            validations: [{ name: "max", value: "10000" }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("creates fields, preserves mutation evidence, and independently verifies every submitted field", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        metaobjectDefinitionUpdate: {
          metaobjectDefinition: {
            id: "gid://shopify/MetaobjectDefinition/1",
            type: "parts_diagram",
            name: "Parts diagram",
            description: null,
            displayNameKey: null,
            metaobjectsCount: 0,
            access: { admin: "MERCHANT_READ_WRITE", storefront: "NONE" },
            capabilities: {
              publishable: { enabled: false },
              translatable: { enabled: false },
              renderable: { enabled: false },
            },
            fieldDefinitions: [],
          },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        metaobjectDefinition: {
          id: "gid://shopify/MetaobjectDefinition/1",
          type: "parts_diagram",
          name: "Parts diagram",
          description: null,
          displayNameKey: null,
          metaobjectsCount: 0,
          access: { admin: "MERCHANT_READ_WRITE", storefront: "NONE" },
          capabilities: {
            publishable: { enabled: false },
            translatable: { enabled: false },
            renderable: { enabled: false },
          },
          fieldDefinitions: [
            {
              key: "hotspots",
              name: "Hotspots",
              description: "Interactive diagram hotspots",
              required: false,
              type: { name: "json" },
              validations: [{ name: "max", value: "10000" }],
            },
          ],
        },
      });
    updateMetaobjectDefinition.initialize({ request } as never);

    const result = await updateMetaobjectDefinition.execute({
      id: "gid://shopify/MetaobjectDefinition/1",
      fields: [
        {
          key: "hotspots",
          name: "Hotspots",
          description: "Interactive diagram hotspots",
          type: "json",
          required: false,
          validations: [{ name: "max", value: "10000" }],
        },
      ],
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toEqual({
      id: "gid://shopify/MetaobjectDefinition/1",
      definition: {
        fieldDefinitions: [
          {
            create: {
              key: "hotspots",
              name: "Hotspots",
              description: "Interactive diagram hotspots",
              type: "json",
              required: false,
              validations: [{ name: "max", value: "10000" }],
            },
          },
        ],
      },
    });
    expect(result.mutation.userErrors).toEqual([]);
    expect(result.verified.fieldDefinitions).toEqual([
      expect.objectContaining({ key: "hotspots", type: "json" }),
    ]);
  });
});
