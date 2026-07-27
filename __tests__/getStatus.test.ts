import { getStatus } from "../src/tools/getStatus.js";

describe("get-status access mode", () => {
  const originalReadOnly = process.env.SHOPIFY_MCP_READ_ONLY;

  afterEach(() => {
    if (originalReadOnly === undefined) {
      delete process.env.SHOPIFY_MCP_READ_ONLY;
    } else {
      process.env.SHOPIFY_MCP_READ_ONLY = originalReadOnly;
    }
  });

  it("reports the effective server-enforced read-only boundary", async () => {
    process.env.SHOPIFY_MCP_READ_ONLY = "true";
    const request = jest.fn().mockResolvedValue({
      shop: {
        name: "Test Shop",
        url: "https://test-shop.myshopify.com",
        myshopifyDomain: "test-shop.myshopify.com",
        primaryDomain: {
          url: "https://test-shop.myshopify.com",
          host: "test-shop.myshopify.com",
        },
        plan: {
          displayName: "Development",
          partnerDevelopment: true,
          shopifyPlus: false,
        },
        currencyCode: "AUD",
        timezoneAbbreviation: "ACST",
      },
      app: {
        installation: {
          accessScopes: [
            { handle: "read_metaobjects" },
            { handle: "write_metaobjects" },
          ],
        },
      },
    });

    getStatus.initialize({ request } as any);
    const result = await getStatus.execute();

    expect(result.server).toMatchObject({
      accessMode: "read-only",
      readOnlyEnforced: true,
      writeToolsExposed: false,
    });
    expect(result.scopes).toMatchObject({
      granted: ["read_metaobjects", "write_metaobjects"],
    });
  });
});
