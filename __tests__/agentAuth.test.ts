import { createHmac } from "node:crypto";
import {
  StructuralVerifier,
  SharedSecretVerifier,
  checkToolAccess,
  createAgentAuthMiddleware,
  configFromEnv,
  AgentIdentity,
  AgentAuthConfig,
} from "../src/auth/agentAuth.js";

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

  it("should reject Infinity expiry", async () => {
    const cred = JSON.stringify({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: 1e309, // parses as Infinity
    });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("expiry");
  });

  it("should reject float expiry", async () => {
    const cred = JSON.stringify({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Date.now() / 1000 + 3600.5,
    });
    const result = await verifier.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("integer");
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

  it("should create SharedSecretVerifier when AGENT_AUTH_SECRET is set", () => {
    process.env = { ...origEnv, AGENT_AUTH_ENABLED: "true", AGENT_AUTH_SECRET: "a".repeat(32) };
    const config = configFromEnv();
    expect(config.enabled).toBe(true);
    expect(config.verifier).toBeInstanceOf(SharedSecretVerifier);
  });

  it("should not crash when enabled with AGENT_AUTH_SECRET", () => {
    process.env = { ...origEnv, AGENT_AUTH_ENABLED: "true", AGENT_AUTH_SECRET: "a".repeat(32) };
    const config = configFromEnv();
    expect(() => createAgentAuthMiddleware(config)).not.toThrow();
  });
});

describe("SharedSecretVerifier", () => {
  const secret = "test-secret-that-is-at-least-32-characters-long";

  function signCredential(payload: Record<string, unknown>, secretKey: string): string {
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    const payloadB64 = payloadBytes.toString("base64url");
    const sig = createHmac("sha256", secretKey).update(payloadBytes).digest();
    const sigB64 = sig.toString("base64url");
    return `${sigB64}.${payloadB64}`;
  }

  it("should reject secret shorter than 32 characters", () => {
    expect(() => new SharedSecretVerifier("short")).toThrow("at least 32");
  });

  it("should verify a correctly signed credential", async () => {
    const v = new SharedSecretVerifier(secret);
    const cred = signCredential({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    }, secret);
    const result = await v.verify(cred);
    expect(result.verified).toBe(true);
    expect(result.identity?.agentId).toBe("agent-1");
  });

  it("should reject a credential signed with wrong secret", async () => {
    const v = new SharedSecretVerifier(secret);
    const cred = signCredential({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    }, "wrong-secret-that-is-also-at-least-32-chars");
    const result = await v.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("signature");
  });

  it("should reject tampered payload", async () => {
    const v = new SharedSecretVerifier(secret);
    const cred = signCredential({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    }, secret);
    // Tamper with the payload portion
    const [sig] = cred.split(".");
    const tampered = Buffer.from(JSON.stringify({
      agentId: "agent-1",
      permissions: ["read", "write", "bulk"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const result = await v.verify(`${sig}.${tampered}`);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("signature");
  });

  it("should reject expired credential", async () => {
    const v = new SharedSecretVerifier(secret);
    const cred = signCredential({
      agentId: "agent-1",
      permissions: ["read"],
      expiry: Math.floor(Date.now() / 1000) - 100,
    }, secret);
    const result = await v.verify(cred);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("should reject credential without dot separator", async () => {
    const v = new SharedSecretVerifier(secret);
    const result = await v.verify("nodot");
    expect(result.verified).toBe(false);
  });

  it("should reject self-issued credential (no HMAC)", async () => {
    const v = new SharedSecretVerifier(secret);
    // Try to pass a raw JSON credential like StructuralVerifier accepts
    const cred = JSON.stringify({
      agentId: "attacker",
      permissions: ["read", "write", "bulk"],
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await v.verify(cred);
    expect(result.verified).toBe(false);
  });
});
