import { StructuralVerifier, checkToolAccess, AgentIdentity, AgentAuthConfig } from "./agentAuth.js";

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
    expect(result.identity?.permissions).toEqual(["read", "write"]);
  });

  it("should reject invalid JSON", async () => {
    const result = await verifier.verify("not-json");
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("invalid");
  });

  it("should reject missing agentId", async () => {
    const result = await verifier.verify(JSON.stringify({ permissions: ["read"] }));
    expect(result.verified).toBe(false);
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
  const config: AgentAuthConfig = { enabled: true };

  const readAgent: AgentIdentity = {
    agentId: "reader",
    permissions: ["read"],
    expiry: 0,
  };

  const writeAgent: AgentIdentity = {
    agentId: "writer",
    permissions: ["read", "write"],
    expiry: 0,
  };

  const bulkAgent: AgentIdentity = {
    agentId: "bulk-op",
    permissions: ["read", "write", "bulk"],
    expiry: 0,
  };

  it("should allow read agent to use read tools", () => {
    expect(checkToolAccess(readAgent, "products", config)).toBeNull();
  });

  it("should deny read agent from write tools", () => {
    const err = checkToolAccess(readAgent, "createProduct", config);
    expect(err).toContain("lacks permissions");
    expect(err).toContain("write");
  });

  it("should allow write agent to use write tools", () => {
    expect(checkToolAccess(writeAgent, "updateProduct", config)).toBeNull();
  });

  it("should deny write agent from bulk tools", () => {
    const err = checkToolAccess(writeAgent, "bulkDeleteProducts", config);
    expect(err).toContain("bulk");
  });

  it("should allow bulk agent to use bulk tools", () => {
    expect(checkToolAccess(bulkAgent, "bulkUpdateProducts", config)).toBeNull();
  });

  it("should allow any agent for unmapped tools", () => {
    expect(checkToolAccess(readAgent, "unknownTool", config)).toBeNull();
  });
});
