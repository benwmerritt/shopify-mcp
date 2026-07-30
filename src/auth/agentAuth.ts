/**
 * Optional agent authentication middleware for shopify-mcp.
 *
 * Adds per-agent identity verification and tool-level access control.
 * Disabled by default — opt in via AGENT_AUTH_ENABLED=true.
 *
 * Without this middleware, any agent with the store's OAuth token has
 * full access to all 30+ tools. This adds a second layer: verify the
 * agent's identity and check which tools it's allowed to use.
 *
 * The verifier interface is pluggable — implement AgentVerifier for
 * any identity system (JWT, DID, ZKP, API keys, etc.).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  /** Unique agent identifier */
  agentId: string;
  /** Permissions this agent holds */
  permissions: string[];
  /** When the credential expires (unix timestamp, required) */
  expiry: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface VerificationResult {
  verified: boolean;
  identity?: AgentIdentity;
  reason?: string;
}

/**
 * Pluggable agent verifier interface.
 * Implement this to use any identity system.
 */
export interface AgentVerifier {
  verify(credential: string): Promise<VerificationResult>;
}

// ---------------------------------------------------------------------------
// Built-in verifiers
// ---------------------------------------------------------------------------

/**
 * Structural verifier — checks JSON credential format only.
 * For development and testing. NOT for production.
 *
 * WARNING: This verifier only checks structure, not cryptographic validity.
 * Any caller can self-assert any permissions. Use SharedSecretVerifier or
 * a real verifier (JWT, DID, ZKP, etc.) in production.
 */
export class StructuralVerifier implements AgentVerifier {
  async verify(credential: string): Promise<VerificationResult> {
    try {
      const data = JSON.parse(credential);
      if (!data.agentId || !Array.isArray(data.permissions)) {
        return { verified: false, reason: "missing agentId or permissions" };
      }
      if (!Number.isFinite(data.expiry) || data.expiry <= 0 || !Number.isInteger(data.expiry)) {
        return { verified: false, reason: "missing or invalid expiry (required, must be integer unix timestamp)" };
      }
      if (data.expiry < Date.now() / 1000) {
        return { verified: false, reason: "credential expired" };
      }
      return {
        verified: true,
        identity: {
          agentId: data.agentId,
          permissions: data.permissions,
          expiry: data.expiry,
          metadata: data.metadata,
        },
      };
    } catch {
      return { verified: false, reason: "invalid credential format" };
    }
  }
}

/**
 * Shared-secret verifier — validates HMAC-SHA256 signed credentials.
 * Suitable for production when you control both the agent and the server.
 *
 * Credential format: <base64url-signature>.<base64url-payload>
 * Payload is JSON with { agentId, permissions, expiry }.
 * Signature = HMAC-SHA256(secret, payload_bytes).
 *
 * Generate a secret: openssl rand -hex 32
 * Set via AGENT_AUTH_SECRET env var or pass to constructor.
 */
export class SharedSecretVerifier implements AgentVerifier {
  private secret: Uint8Array;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error(
        "[agent-auth] SharedSecretVerifier requires a secret of at least 32 characters. " +
          "Generate one with: openssl rand -hex 32",
      );
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async verify(credential: string): Promise<VerificationResult> {
    try {
      const dotIndex = credential.indexOf(".");
      if (dotIndex < 1) {
        return { verified: false, reason: "invalid credential format: expected <signature>.<payload>" };
      }

      const signatureB64 = credential.slice(0, dotIndex);
      const payloadB64 = credential.slice(dotIndex + 1);

      const payloadBytes = Buffer.from(payloadB64, "base64url");
      const expectedSig = Buffer.from(signatureB64, "base64url");

      // Compute HMAC-SHA256
      const { createHmac, timingSafeEqual } = await import("node:crypto");
      const actualSig = createHmac("sha256", this.secret)
        .update(payloadBytes)
        .digest();

      if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
        return { verified: false, reason: "invalid signature" };
      }

      const data = JSON.parse(payloadBytes.toString("utf-8"));
      if (!data.agentId || !Array.isArray(data.permissions)) {
        return { verified: false, reason: "missing agentId or permissions" };
      }
      if (!Number.isFinite(data.expiry) || data.expiry <= 0 || !Number.isInteger(data.expiry)) {
        return { verified: false, reason: "missing or invalid expiry (required, must be integer unix timestamp)" };
      }
      if (data.expiry < Date.now() / 1000) {
        return { verified: false, reason: "credential expired" };
      }

      return {
        verified: true,
        identity: {
          agentId: data.agentId,
          permissions: data.permissions,
          expiry: data.expiry,
          metadata: data.metadata,
        },
      };
    } catch {
      return { verified: false, reason: "invalid credential format" };
    }
  }
}

// ---------------------------------------------------------------------------
// Tool access control
// ---------------------------------------------------------------------------

/**
 * Default tool-to-permission mapping.
 * Unmapped tools default to the configured defaultPolicy.
 */
const DEFAULT_TOOL_PERMISSIONS: Record<string, string[]> = {
  // Read-only tools (kebab-case — matches server.tool() registration)
  "products": ["read"],
  "orders": ["read"],
  "draft-orders": ["read"],
  "get-customers": ["read"],
  "get-collections": ["read"],
  "get-inventory-levels": ["read"],
  "get-metafields": ["read"],
  "get-metafield-options": ["read"],
  "get-locations": ["read"],
  "get-redirects": ["read"],
  "get-status": ["read"],
  "get-store-counts": ["read"],
  "get-product-issues": ["read"],
  "get-files": ["read"],
  "get-metaobject": ["read"],
  "get-metaobject-definition": ["read"],
  "list-metafield-definitions": ["read"],
  "list-metaobject-definitions": ["read"],
  "list-metaobjects": ["read"],
  "search-taxonomy": ["read"],
  "count-products-by-tag": ["read"],
  "find-products-by-metafield": ["read"],
  "get-bulk-operation-status": ["read"],
  "get-bulk-operation-results": ["read"],

  // Write tools
  "create-product": ["write"],
  "update-product": ["write"],
  "delete-product": ["write"],
  "delete-variant": ["write"],
  "delete-product-images": ["write"],
  "attach-file-to-product": ["write"],
  "detach-file-from-product": ["write"],
  "create-draft-order": ["write"],
  "update-draft-order": ["write"],
  "complete-draft-order": ["write"],
  "update-customer": ["write"],
  "update-order": ["write"],
  "create-collection": ["write"],
  "update-collection": ["write"],
  "delete-collection": ["write"],
  "manage-collection-products": ["write"],
  "update-inventory": ["write"],
  "set-metafield": ["write"],
  "delete-metafield": ["write"],
  "create-metaobject": ["write"],
  "update-metaobject": ["write"],
  "delete-metaobject": ["write"],
  "create-redirect": ["write"],
  "delete-redirect": ["write"],
  "create-file-upload-session": ["write"],
  "get-file-upload-session": ["write"],

  // Bulk operations
  "bulk-update-products": ["write", "bulk"],
  "bulk-delete-products": ["write", "bulk"],
  "bulk-set-variant-metafields": ["write", "bulk"],
  "start-bulk-export": ["read", "bulk"],
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AgentAuthConfig {
  /** Enable agent authentication (default: false) */
  enabled?: boolean;
  /** Verifier implementation (default: StructuralVerifier) */
  verifier?: AgentVerifier;
  /** Custom tool-to-permission mapping (merged with defaults) */
  toolPermissions?: Record<string, string[]>;
  /** Header name for agent credential (default: x-agent-credential) */
  credentialHeader?: string;
  /**
   * Policy for tools not in the permission map.
   * "deny" (default) = unmapped tools are blocked entirely.
   * "allow" = unmapped tools are open to any authenticated agent.
   */
  defaultPolicy?: "allow" | "deny";
}

/**
 * Check if an agent is authorized to use a specific tool.
 *
 * @returns null if authorized, or an error message string if denied
 */
export function checkToolAccess(
  identity: AgentIdentity,
  toolName: string,
  config: AgentAuthConfig,
): string | null {
  const permissions = {
    ...DEFAULT_TOOL_PERMISSIONS,
    ...config.toolPermissions,
  };

  const required = permissions[toolName];
  if (!required) {
    // Unmapped tool — check defaultPolicy
    if (config.defaultPolicy === "allow") return null;
    // Default: deny — block entirely (fail closed)
    return `Agent '${identity.agentId}' is not authorized for unmapped tool '${toolName}'`;
  }

  const missing = required.filter(p => !identity.permissions.includes(p));
  if (missing.length > 0) {
    return `Agent '${identity.agentId}' lacks permissions [${missing.join(", ")}] for tool '${toolName}'`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware function
// ---------------------------------------------------------------------------

/**
 * Create an agent auth middleware that wraps MCP tool handlers.
 *
 * Usage:
 *   // Via environment (AGENT_AUTH_ENABLED=true, AGENT_AUTH_SECRET=...):
 *   const authMiddleware = createAgentAuthMiddleware(configFromEnv());
 *
 *   // Or with a custom verifier:
 *   const authMiddleware = createAgentAuthMiddleware({
 *     ...configFromEnv(),
 *     verifier: new MyProductionVerifier(),
 *   });
 *
 *   // Wrap a tool handler:
 *   const protectedHandler = authMiddleware.protect("create-product", originalHandler);
 *
 *   // Or check manually:
 *   const error = await authMiddleware.authorize(credentialString, "create-product");
 *   if (error) return { content: [{ type: "text", text: error }] };
 */
export function createAgentAuthMiddleware(config: AgentAuthConfig) {
  const headerName = config.credentialHeader ?? "x-agent-credential";

  if (config.enabled && !config.verifier) {
    throw new Error(
      "[agent-auth] No verifier provided. When auth is enabled, you MUST " +
        "supply a real AgentVerifier implementation (JWT, DID, ZKP, API key " +
        "lookup). StructuralVerifier is available for development only — " +
        "pass it explicitly if you understand the risk: " +
        "{ verifier: new StructuralVerifier(), enabled: true }",
    );
  }

  const verifier = config.verifier ?? new StructuralVerifier();

  return {
    /** Whether auth is enabled */
    enabled: config.enabled ?? false,

    /** The header name to read credentials from */
    headerName,

    /**
     * Verify a credential and check tool access in one call.
     * Returns null if authorized, or an error message if denied.
     */
    async authorize(credential: string | undefined, toolName: string): Promise<string | null> {
      if (!config.enabled) return null;

      if (!credential) {
        return `Agent authentication required. Provide credential via '${headerName}' header.`;
      }

      const result = await verifier.verify(credential);
      if (!result.verified) {
        return `Agent authentication failed: ${result.reason}`;
      }

      return checkToolAccess(result.identity!, toolName, config);
    },

    /**
     * Wrap a tool handler with agent auth.
     * The wrapped handler checks auth before calling the original.
     *
     * MCP SDK tool callbacks receive (args, extra). HTTP headers are at
     * extra.requestInfo.headers, not on the top-level extra object.
     */
    protect<T extends (...args: any[]) => any>(toolName: string, handler: T): T {
      if (!config.enabled) return handler;

      const wrapped = async (...args: any[]) => {
        // MCP SDK passes (args, extra) — headers live at extra.requestInfo.headers
        const extra = args.find(
          (a) => a && typeof a === "object" && "requestInfo" in a,
        );
        const headers = extra?.requestInfo?.headers;
        const credential =
          headers?.[headerName] ??       // IncomingHttpHeaders (lowercase)
          headers?.[headerName.toLowerCase()] ??
          undefined;

        const error = await wrapped.__middleware.authorize(credential, toolName);
        if (error) {
          return { content: [{ type: "text", text: error }], isError: true };
        }
        return handler(...args);
      };
      wrapped.__middleware = { authorize: this.authorize.bind(this) };
      return wrapped as unknown as T;
    },
  };
}

/**
 * Create config from environment variables.
 *
 * Set AGENT_AUTH_ENABLED=true and AGENT_AUTH_SECRET=<secret> to enable
 * auth with the built-in SharedSecretVerifier (HMAC-SHA256).
 *
 * For custom verifiers, merge your own:
 *   createAgentAuthMiddleware({
 *     ...configFromEnv(),
 *     verifier: new MyProductionVerifier(),
 *   });
 */
export function configFromEnv(): AgentAuthConfig {
  const enabled = process.env.AGENT_AUTH_ENABLED === "true";
  const secret = process.env.AGENT_AUTH_SECRET;

  let verifier: AgentVerifier | undefined;
  if (enabled && secret) {
    verifier = new SharedSecretVerifier(secret);
  }

  return {
    enabled,
    verifier,
    credentialHeader: process.env.AGENT_AUTH_HEADER || "x-agent-credential",
    defaultPolicy: (process.env.AGENT_AUTH_DEFAULT_POLICY as "allow" | "deny") || "deny",
  };
}
