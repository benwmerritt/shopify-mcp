import { updateMetafieldDefinitionAccess as tool } from "../src/tools/updateMetafieldDefinitionAccess.js";
const id = "gid://shopify/MetafieldDefinition/123";
const definition = { id, access: { admin: "PUBLIC_READ_WRITE", storefront: "PUBLIC_READ" } };
describe("update-metafield-definition-access", () => {
  it("restricts input to definition IDs and valid storefront permissions", () => {
    expect(() => tool.schema.parse({ id, storefront: "PUBLIC_READ" })).not.toThrow();
    expect(() => tool.schema.parse({ id: "gid://shopify/Product/123", storefront: "PUBLIC_READ" })).toThrow();
    expect(() => tool.schema.parse({ id, storefront: "PUBLIC_WRITE" })).toThrow();
  });
  it("updates only access and freshly verifies it", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ node: { id, namespace: "custom", key: "gallery", ownerType: "COLLECTION" } })
      .mockResolvedValueOnce({ metafieldDefinitionUpdate: { updatedDefinition: definition, userErrors: [] } })
      .mockResolvedValueOnce({ node: definition });
    tool.initialize({ request } as never);
    const result = await tool.execute({ id, storefront: "PUBLIC_READ" });
    expect(request.mock.calls[1][1]).toEqual({ definition: { namespace: "custom", key: "gallery", ownerType: "COLLECTION", access: { storefront: "PUBLIC_READ" } } });
    expect(request.mock.calls[2][1]).toEqual({ id });
    expect(result.verified).toEqual(definition);
  });
  it("rejects user errors without a read-back", async () => {
    const request = jest.fn().mockResolvedValueOnce({ node: { id, namespace: "custom", key: "gallery", ownerType: "COLLECTION" } }).mockResolvedValueOnce({ metafieldDefinitionUpdate: { updatedDefinition: null, userErrors: [{ field: ["access"], message: "Denied" }] } });
    tool.initialize({ request } as never);
    await expect(tool.execute({ id, storefront: "PUBLIC_READ" })).rejects.toThrow("Denied");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([null, { ...definition, access: { ...definition.access, storefront: "NONE" } }, { ...definition, id: "gid://shopify/MetafieldDefinition/456" }])("rejects read-back mismatches %j", async node => {
    const request = jest.fn()
      .mockResolvedValueOnce({ node: { id, namespace: "custom", key: "gallery", ownerType: "COLLECTION" } })
      .mockResolvedValueOnce({ metafieldDefinitionUpdate: { updatedDefinition: definition, userErrors: [] } })
      .mockResolvedValueOnce({ node });
    tool.initialize({ request } as never);
    await expect(tool.execute({ id, storefront: "PUBLIC_READ" })).rejects.toThrow("Verification failed");
  });
});
