import {
  StructuralVerifier,
  checkToolAccess,
  createAgentAuthMiddleware,
  configFromEnv,
  AgentIdentity,
  AgentAuthConfig,
} from "./agentAuth.js";

describe("StructuralVerifier", () => {
  const verifier = new StructuralVerifier();

  it("should verify valid credential", async () => {
    const cred = JSON.stringify({
      agentId: "agent-1",
      permissions: ["read", "write"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(true);
    expect(result.identity?.agentId).toBe("agent-1");
  });

  it("should reject invalid JSON", async () => {
    const result = await verifier.verify("not-json");
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("invalid");
  });

  it("should reject missing agentId", async () => {
    const cred = JSON.stringify({ permissions: ["read"], expiry: Date.now() / 1000 + 3600 });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(false);
  });

  it("should reject missing expiry", async () => {
    const cred = JSON.stringify({ agentId: "a", permissions: ["read"] });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("expiry");
  });

  it("should reject expired credential", async () => {
    const cred = JSON.stringify({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) - 100,
    });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("expired");
  });
});

describe("checkToolAccess", () => {
  const readAgent: AgentIdentity = { agentId: "reader", permissions: ["read"], expiry: 0 };
  const writeAgent: AgentIdentity = { agentId: "writer", permissions: ["read", "write"], expiry: 0 };
  const bulkAgent: AgentIdentity = { agentId: "bulk", permissions: ["read", "write", "bulk"], expiry: 0 };
  const noPermsAgent: AgentIdentity = { agentId: "noperms", permissions: [], expiry: 0 };

  it("should allow read agent to use read tools (kebab-case)", () => {
    expect(checkToolAccess(readAgent, "products", { enabled: true })).toBeNull();
    expect(checkToolAccess(readAgent, "get-customers", { enabled: true })).toBeNull();
  });

  it("should deny read agent from write tools (kebab-case)", () => {
    const err = checkToolAccess(readAgent, "create-product", { enabled: true });
    expect(err).toContain("write");
  });

  it("should allow write agent to use write tools", () => {
    expect(checkToolAccess(writeAgent, "update-product", { enabled: true })).toBeNull();
    expect(checkToolAccess(writeAgent, "delete-product", { enabled: true })).toBeNull();
  });

  it("should deny write agent from bulk tools", () => {
    const err = checkToolAccess(writeAgent, "bulk-delete-products", { enabled: true });
    expect(err).toContain("bulk");
  });

  it("should allow bulk agent to use bulk tools", () => {
    expect(checkToolAccess(bulkAgent, "bulk-update-products", { enabled: true })).toBeNull();
  });

  it("should fully block unmapped tools under default deny policy", () => {
    const err = checkToolAccess(readAgent, "unknown-tool", { enabled: true });
    expect(err).toContain("not authorized");
    expect(err).toContain("unmapped");
  });

  it("should allow unmapped tools when defaultPolicy=allow", () => {
    expect(checkToolAccess(noPermsAgent, "unknown-tool", { enabled: true, defaultPolicy: "allow" })).toBeNull();
  });
});

describe("createAgentAuthMiddleware", () => {
  it("should pass through when disabled", async () => {
    const mw = createAgentAuthMiddleware({ enabled: false });
    const err = await mw.authorize(undefined, "create-product");
    expect(err).toBeNull();
  });

  it("should throw when enabled without a verifier", () => {
    expect(() => createAgentAuthMiddleware({ enabled: true })).toThrow("No verifier provided");
  });

  it("should reject missing credential when enabled", async () => {
    const mw = createAgentAuthMiddleware({ enabled: true, verifier: new StructuralVerifier() });
    const err = await mw.authorize(undefined, "products");
    expect(err).toContain("required");
  });

  it("should authorize valid credential with correct permissions", async () => {
    const mw = createAgentAuthMiddleware({ enabled: true, verifier: new StructuralVerifier() });
    const cred = JSON.stringify({
      agentId: "a1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    const err = await mw.authorize(cred, "products");
    expect(err).toBeNull();
  });

  it("should deny valid credential with wrong permissions", async () => {
    const mw = createAgentAuthMiddleware({ enabled: true, verifier: new StructuralVerifier() });
    const cred = JSON.stringify({
      agentId: "a1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    const err = await mw.authorize(cred, "create-product");
    expect(err).toContain("write");
  });
});

describe("configFromEnv", () => {
  const origEnv = process.env;

  afterEach(() => { process.env = origEnv; });

  it("should default to disabled", () => {
    process.env = { ...origEnv };
    const config = configFromEnv();
    expect(config.enabled).toBe(false);
  });

  it("should read AGENT_AUTH_ENABLED", () => {
    process.env = { ...origEnv, AGENT_AUTH_ENABLED: "true" };
    const config = configFromEnv();
    expect(config.enabled).toBe(true);
  });

  it("should read custom header", () => {
    process.env = { ...origEnv, AGENT_AUTH_HEADER: "x-custom" };
    const config = configFromEnv();
    expect(config.credentialHeader).toBe("x-custom");
  });
});
