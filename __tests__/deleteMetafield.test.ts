import { deleteMetafield } from "../src/tools/deleteMetafield.js";

describe("delete-metafield", () => {
  it("resolves a metafield ID and deletes it with Shopify's plural metafieldsDelete mutation", async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        node: {
          id: "gid://shopify/Metafield/456",
          namespace: "custom",
          key: "spec_type",
          owner: { id: "gid://shopify/Product/123" },
        },
      })
      .mockResolvedValueOnce({
        metafieldsDelete: {
          deletedMetafields: [
            {
              ownerId: "gid://shopify/Product/123",
              namespace: "custom",
              key: "spec_type",
            },
          ],
          userErrors: [],
        },
      });

    deleteMetafield.initialize({ request } as any);

    const result = await deleteMetafield.execute({ metafieldId: "456" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0][0])).toContain("node(id: $id)");
    expect(request.mock.calls[0][1]).toEqual({
      id: "gid://shopify/Metafield/456",
    });
    expect(String(request.mock.calls[1][0])).toContain("metafieldsDelete");
    expect(String(request.mock.calls[1][0])).not.toContain("metafieldDelete(input:");
    expect(request.mock.calls[1][1]).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Product/123",
          namespace: "custom",
          key: "spec_type",
        },
      ],
    });
    expect(result).toEqual({
      success: true,
      deletedId: "gid://shopify/Metafield/456",
      message: "Metafield gid://shopify/Metafield/456 has been deleted",
    });
  });
});
