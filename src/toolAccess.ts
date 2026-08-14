type ToolRegistrar = (name: string, ...args: unknown[]) => unknown;

type ToolServer = {
  tool: unknown;
  registerTool?: unknown;
};

type ToolRegistrarKey = "tool" | "registerTool";

/**
 * Tools that cannot mutate Shopify catalogue, customer, order, file, redirect,
 * inventory, or local upload-session state.
 *
 * Read-only mode is fail-closed: new tools are hidden until explicitly added
 * here after review.
 */
export const READ_ONLY_TOOL_NAMES = new Set([
  "products",
  "get-customers",
  "orders",
  "get-collections",
  "get-inventory-levels",
  "get-metafields",
  "list-metafield-definitions",
  "get-metafield-options",
  "list-metaobject-definitions",
  "get-metaobject-definition",
  "list-metaobjects",
  "get-metaobject",
  "get-locations",
  "draft-orders",
  "get-redirects",
  "get-store-counts",
  "count-products-by-tag",
  "get-product-issues",
  "get-bulk-operation-status",
  "get-bulk-operation-results",
  "get-status",
  "get-files",
  "get-file-upload-session",
  "search-taxonomy",
  "find-products-by-metafield",
]);

/**
 * Sensitive write tools called out explicitly in addition to the fail-closed
 * read allowlist. A tool listed in both sets is always treated as a write.
 */
export const WRITE_TOOL_NAMES = new Set([
  "update-inventory-item-customs",
  "update-inventory-item-shipping",
]);

export function parseReadOnlyMode(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Wrap an MCP server's tool registrar so read-only instances expose only the
 * reviewed allowlist. The Shopify token should still be least-privilege; this
 * policy is an additional server-side capability boundary.
 */
export function applyToolAccessPolicy<T extends ToolServer>(
  server: T,
  readOnly: boolean,
): T {
  if (!readOnly) {
    return server;
  }

  const wrapRegistrar = (key: ToolRegistrarKey): void => {
    const registrar = server[key];
    if (typeof registrar !== "function") {
      return;
    }

    const registerTool = (registrar as ToolRegistrar).bind(server);
    server[key] = ((name: string, ...args: unknown[]) => {
      if (WRITE_TOOL_NAMES.has(name) || !READ_ONLY_TOOL_NAMES.has(name)) {
        return undefined;
      }

      return registerTool(name, ...args);
    }) as T[typeof key];
  };

  wrapRegistrar("tool");
  wrapRegistrar("registerTool");

  return server;
}
