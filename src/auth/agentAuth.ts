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

import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  /** Unique agent identifier */
  agentId: string;
  /** Permissions this agent holds */
  permissions: string[];
  /** When the credential expires (unix timestamp) */
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
 */
export class StructuralVerifier implements AgentVerifier {
  async verify(credential: string): Promise<VerificationResult> {
    try {
      const data = JSON.parse(credential);
      if (!data.agentId || !Array.isArray(data.permissions)) {
        return { verified: false, reason: "missing agentId or permissions" };
      }
      if (data.expiry && data.expiry < Date.now() / 1000) {
        return { verified: false, reason: "credential expired" };
      }
      return {
        verified: true,
        identity: {
          agentId: data.agentId,
          permissions: data.permissions,
          expiry: data.expiry || 0,
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
 * Tools not listed here require no special permissions beyond basic auth.
 */
const DEFAULT_TOOL_PERMISSIONS: Record<string, string[]> = {
  // Read-only tools — require "read" permission
  products: ["read"],
  orders: ["read"],
  getCustomers: ["read"],
  getCollections: ["read"],
  getInventoryLevels: ["read"],
  getMetafields: ["read"],

  // Write tools — require "write" permission
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

  // Bulk operations — require "write" + "bulk" permissions
  bulkUpdateProducts: ["write", "bulk"],
  bulkDeleteProducts: ["write", "bulk"],
  bulkSetVariantMetafields: ["write", "bulk"],
};

// ---------------------------------------------------------------------------
// Middleware
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
}

/**
 * Check if an agent is authorized to use a specific tool.
 *
 * @param identity - The verified agent identity
 * @param toolName - The MCP tool being called
 * @param config - Auth configuration
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
  if (!required) return null; // no specific permissions required

  const missing = required.filter(p => !identity.permissions.includes(p));
  if (missing.length > 0) {
    return `Agent '${identity.agentId}' lacks permissions [${missing.join(", ")}] for tool '${toolName}'`;
  }

  return null;
}

/**
 * Create an agent auth configuration from environment variables.
 */
export function configFromEnv(): AgentAuthConfig {
  return {
    enabled: process.env.AGENT_AUTH_ENABLED === "true",
    credentialHeader: process.env.AGENT_AUTH_HEADER || "x-agent-credential",
  };
}
