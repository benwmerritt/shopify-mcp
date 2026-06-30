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
 * Use a real verifier (JWT, DID, ZKP, etc.) in production.
 */
export class StructuralVerifier implements AgentVerifier {
  async verify(credential: string): Promise<VerificationResult> {
    try {
      const data = JSON.parse(credential);
      if (!data.agentId || !Array.isArray(data.permissions)) {
        return { verified: false, reason: "missing agentId or permissions" };
      }
      if (!data.expiry || typeof data.expiry !== "number" || data.expiry <= 0) {
        return { verified: false, reason: "missing or invalid expiry (required)" };
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
  // Read-only tools
  products: ["read"],
  orders: ["read"],
  getCustomers: ["read"],
  getCollections: ["read"],
  getInventoryLevels: ["read"],
  getMetafields: ["read"],

  // Write tools
  createProduct: ["write"],
  updateProduct: ["write"],
  deleteProduct: ["write"],
  createDraftOrder: ["write"],
  updateDraftOrder: ["write"],
  completeDraftOrder: ["write"],
  updateCustomer: ["write"],
  updateOrder: ["write"],
  createCollection: ["write"],
  updateCollection: ["write"],
  deleteCollection: ["write"],
  updateInventory: ["write"],
  setMetafield: ["write"],
  deleteMetafield: ["write"],

  // Bulk operations
  bulkUpdateProducts: ["write", "bulk"],
  bulkDeleteProducts: ["write", "bulk"],
  bulkSetVariantMetafields: ["write", "bulk"],
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
   * "deny" (default) = unmapped tools require "read" permission.
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
    // Default: deny — require at least "read"
    if (!identity.permissions.includes("read")) {
      return `Agent '${identity.agentId}' lacks 'read' permission for unmapped tool '${toolName}'`;
    }
    return null;
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
 *   const authMiddleware = createAgentAuthMiddleware(configFromEnv());
 *
 *   // Wrap a tool handler:
 *   const protectedHandler = authMiddleware.protect("createProduct", originalHandler);
 *
 *   // Or check manually:
 *   const error = await authMiddleware.authorize(credentialString, "createProduct");
 *   if (error) return { content: [{ type: "text", text: error }] };
 */
export function createAgentAuthMiddleware(config: AgentAuthConfig) {
  const verifier = config.verifier ?? new StructuralVerifier();
  const headerName = config.credentialHeader ?? "x-agent-credential";

  if (config.enabled && verifier instanceof StructuralVerifier) {
    console.warn(
      "[agent-auth] WARNING: Using StructuralVerifier with auth enabled. " +
        "This only checks credential format, NOT cryptographic validity. " +
        "Use a real verifier (JWT, DID, ZKP) in production.",
    );
  }

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
     */
    protect<T extends (...args: any[]) => any>(toolName: string, handler: T): T {
      if (!config.enabled) return handler;

      const wrapped = async (...args: any[]) => {
        // Extract credential from the request context if available
        const requestContext = args.find(
          (a) => a && typeof a === "object" && headerName in a,
        );
        const credential = requestContext?.[headerName];

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
 * Create an agent auth configuration from environment variables.
 */
export function configFromEnv(): AgentAuthConfig {
  return {
    enabled: process.env.AGENT_AUTH_ENABLED === "true",
    credentialHeader: process.env.AGENT_AUTH_HEADER || "x-agent-credential",
    defaultPolicy: (process.env.AGENT_AUTH_DEFAULT_POLICY as "allow" | "deny") || "deny",
  };
}
