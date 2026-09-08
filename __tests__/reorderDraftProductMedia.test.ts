import { reorderDraftProductMedia } from "../src/tools/reorderDraftProductMedia.js";

describe("reorder-draft-product-media", () => {
  it("reads an exact DRAFT MediaImage order, submits only moves, waits, and verifies the full order", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        product: {
          id: "gid://shopify/Product/1",
          status: "DRAFT",
          media: {
            nodes: [
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/1", alt: "one", image: { url: "https://cdn/1" } },
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/2", alt: "two", image: { url: "https://cdn/2" } },
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/3", alt: null, image: { url: "https://cdn/3" } },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      })
      .mockResolvedValueOnce({
        productReorderMedia: {
          job: { id: "gid://shopify/Job/9", done: false },
          mediaUserErrors: [],
        },
      })
      .mockResolvedValueOnce({ job: { id: "gid://shopify/Job/9", done: true } })
      .mockResolvedValueOnce({
        product: {
          id: "gid://shopify/Product/1",
          status: "DRAFT",
          media: {
            nodes: [
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/2", alt: "two", image: { url: "https://cdn/2" } },
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/1", alt: "one", image: { url: "https://cdn/1" } },
              { __typename: "MediaImage", id: "gid://shopify/MediaImage/3", alt: null, image: { url: "https://cdn/3" } },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      });

    reorderDraftProductMedia.initialize({ request } as any);
    const result = await reorderDraftProductMedia.execute({
      productId: "1",
      mediaIds: [
        "gid://shopify/MediaImage/2",
        "gid://shopify/MediaImage/1",
        "gid://shopify/MediaImage/3",
      ],
      pollIntervalMs: 0,
    });

    expect(request).toHaveBeenCalledTimes(4);
    expect(String(request.mock.calls[0][0])).toContain("status");
    expect(request.mock.calls[1][1]).toEqual({
      productId: "gid://shopify/Product/1",
      moves: [
        { id: "gid://shopify/MediaImage/2", newPosition: "0" },
        { id: "gid://shopify/MediaImage/1", newPosition: "1" },
      ],
    });
    expect(result).toMatchObject({
      productId: "gid://shopify/Product/1",
      status: "DRAFT",
      mediaIds: [
        "gid://shopify/MediaImage/2",
        "gid://shopify/MediaImage/1",
        "gid://shopify/MediaImage/3",
      ],
      changed: true,
    });
  });

  it("fails closed when the requested IDs are not exactly the attached MediaImage IDs", async () => {
    const request = jest.fn().mockResolvedValueOnce({
      product: {
        id: "gid://shopify/Product/1",
        status: "DRAFT",
        media: {
          nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/1", alt: null, image: { url: "u" } }],
          pageInfo: { hasNextPage: false },
        },
      },
    });
    reorderDraftProductMedia.initialize({ request } as any);

    await expect(reorderDraftProductMedia.execute({
      productId: "1",
      mediaIds: ["gid://shopify/MediaImage/999"],
      pollIntervalMs: 0,
    })).rejects.toThrow("exactly match");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects non-DRAFT products before any mutation", async () => {
    const request = jest.fn().mockResolvedValueOnce({
      product: {
        id: "gid://shopify/Product/1",
        status: "ACTIVE",
        media: { nodes: [], pageInfo: { hasNextPage: false } },
      },
    });
    reorderDraftProductMedia.initialize({ request } as any);

    await expect(reorderDraftProductMedia.execute({ productId: "1", mediaIds: [], pollIntervalMs: 0 }))
      .rejects.toThrow("DRAFT");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fails verification if reorder changes media metadata", async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ product: { id: "gid://shopify/Product/1", status: "DRAFT", media: {
        nodes: [
          { __typename: "MediaImage", id: "gid://shopify/MediaImage/1", alt: "one", image: { url: "u1" } },
          { __typename: "MediaImage", id: "gid://shopify/MediaImage/2", alt: "two", image: { url: "u2" } },
        ], pageInfo: { hasNextPage: false },
      } } })
      .mockResolvedValueOnce({ productReorderMedia: { job: { id: "gid://shopify/Job/9", done: true }, mediaUserErrors: [] } })
      .mockResolvedValueOnce({ product: { id: "gid://shopify/Product/1", status: "DRAFT", media: {
        nodes: [
          { __typename: "MediaImage", id: "gid://shopify/MediaImage/2", alt: "changed", image: { url: "u2" } },
          { __typename: "MediaImage", id: "gid://shopify/MediaImage/1", alt: "one", image: { url: "u1" } },
        ], pageInfo: { hasNextPage: false },
      } } });
    reorderDraftProductMedia.initialize({ request } as any);

    await expect(reorderDraftProductMedia.execute({ productId: "1", mediaIds: [
      "gid://shopify/MediaImage/2", "gid://shopify/MediaImage/1",
    ], pollIntervalMs: 0 })).rejects.toThrow("metadata changed");
  });
});
