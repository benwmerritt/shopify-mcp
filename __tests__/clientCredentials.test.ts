jest.mock("open", () => jest.fn());

import {
  acquireClientCredentialsToken,
  createAuthenticatedFetch,
  createClientCredentialsTokenProvider,
  type TokenData,
} from "../src/oauth.js";

describe("Shopify client-credentials authentication", () => {
  const domain = "barbecue-alley.myshopify.com";
  const clientId = "client-id";
  const clientSecret = "client-secret";

  it("requests a 24-hour token using Shopify's client_credentials grant", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "fresh-token",
        scope: "read_products,write_products",
        expires_in: 86_399,
      }),
    });

    const token = await acquireClientCredentialsToken(
      domain,
      clientId,
      clientSecret,
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => Date.parse("2026-07-29T03:00:00.000Z"),
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://${domain}/admin/oauth/access_token`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
        }),
      }),
    );
    expect(token).toEqual({
      access_token: "fresh-token",
      scope: "read_products,write_products",
      obtained_at: "2026-07-29T03:00:00.000Z",
      expires_at: "2026-07-30T02:59:59.000Z",
      grant_type: "client_credentials",
      client_id: clientId,
    });
  });

  it("reuses an unexpired cached client-credentials token", async () => {
    const cached: TokenData = {
      access_token: "cached-token",
      scope: "read_products",
      obtained_at: "2026-07-29T01:00:00.000Z",
      expires_at: "2026-07-30T01:00:00.000Z",
      grant_type: "client_credentials",
      client_id: clientId,
    };
    const fetchImpl = jest.fn();
    const saveToken = jest.fn();
    const provider = createClientCredentialsTokenProvider(
      domain,
      clientId,
      clientSecret,
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => Date.parse("2026-07-29T03:00:00.000Z"),
        loadToken: () => cached,
        saveToken,
      },
    );

    await expect(provider()).resolves.toBe("cached-token");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it("refreshes near expiry and coalesces concurrent refreshes", async () => {
    const expiring: TokenData = {
      access_token: "expiring-token",
      scope: "read_products",
      obtained_at: "2026-07-28T03:00:00.000Z",
      expires_at: "2026-07-29T03:03:00.000Z",
      grant_type: "client_credentials",
      client_id: clientId,
    };
    let resolveFetch!: (response: unknown) => void;
    const fetchImpl = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const saveToken = jest.fn();
    const provider = createClientCredentialsTokenProvider(
      domain,
      clientId,
      clientSecret,
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => Date.parse("2026-07-29T03:00:00.000Z"),
        loadToken: () => expiring,
        saveToken,
      },
    );

    const first = provider();
    const second = provider();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({
        access_token: "renewed-token",
        scope: "read_products",
        expires_in: 86_399,
      }),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      "renewed-token",
      "renewed-token",
    ]);
    expect(saveToken).toHaveBeenCalledTimes(1);
  });

  it("injects the provider's current token into every Shopify request", async () => {
    const getAccessToken = jest
      .fn()
      .mockResolvedValueOnce("token-one")
      .mockResolvedValueOnce("token-two");
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
    const authenticatedFetch = createAuthenticatedFetch(
      getAccessToken,
      fetchImpl as unknown as typeof fetch,
    );

    await authenticatedFetch("https://example.test/first", {
      headers: { "Content-Type": "application/json" },
    });
    await authenticatedFetch("https://example.test/second");

    const firstHeaders = new Headers(fetchImpl.mock.calls[0][1].headers);
    const secondHeaders = new Headers(fetchImpl.mock.calls[1][1].headers);
    expect(firstHeaders.get("Content-Type")).toBe("application/json");
    expect(firstHeaders.get("X-Shopify-Access-Token")).toBe("token-one");
    expect(secondHeaders.get("X-Shopify-Access-Token")).toBe("token-two");
  });
});
