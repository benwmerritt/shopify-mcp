import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { products } from "./tools/products.js";
import { orders } from "./tools/orders.js";
import { draftOrders } from "./tools/draftOrders.js";
import { getCustomers } from "./tools/getCustomers.js";
import { updateCustomer } from "./tools/updateCustomer.js";
import { updateOrder } from "./tools/updateOrder.js";
import { createProduct } from "./tools/createProduct.js";
import { updateProduct } from "./tools/updateProduct.js";
import { createProductOption } from "./tools/createProductOption.js";
import { deleteProduct } from "./tools/deleteProduct.js";
import { deleteVariant } from "./tools/deleteVariant.js";
import { deleteProductImages } from "./tools/deleteProductImages.js";
import { bulkUpdateProducts } from "./tools/bulkUpdateProducts.js";
import { bulkSetVariantMetafields } from "./tools/bulkSetVariantMetafields.js";
import { bulkDeleteProducts } from "./tools/bulkDeleteProducts.js";
import { getCollections } from "./tools/getCollections.js";
import { manageCollectionProducts } from "./tools/manageCollectionProducts.js";
import { createCollection } from "./tools/createCollection.js";
import { updateCollection } from "./tools/updateCollection.js";
import { deleteCollection } from "./tools/deleteCollection.js";
import { getInventoryLevels } from "./tools/getInventoryLevels.js";
import { updateInventory } from "./tools/updateInventory.js";
import { updateInventoryItemCustoms } from "./tools/updateInventoryItemCustoms.js";
import { updateInventoryItemShipping } from "./tools/updateInventoryItemShipping.js";
import { getMetafields } from "./tools/getMetafields.js";
import { deleteMetafield } from "./tools/deleteMetafield.js";
import { setMetafield } from "./tools/setMetafield.js";
import { listMetafieldDefinitions } from "./tools/listMetafieldDefinitions.js";
import { createMetafieldDefinition } from "./tools/createMetafieldDefinition.js";
import { updateMetafieldDefinitionAccess } from "./tools/updateMetafieldDefinitionAccess.js";
import { getMetafieldOptions } from "./tools/getMetafieldOptions.js";
import { createMetaobject } from "./tools/createMetaobject.js";
import { updateMetaobject } from "./tools/updateMetaobject.js";
import { deleteMetaobject } from "./tools/deleteMetaobject.js";
import { listMetaobjects } from "./tools/listMetaobjects.js";
import { getMetaobject } from "./tools/getMetaobject.js";
import { listMetaobjectDefinitions } from "./tools/listMetaobjectDefinitions.js";
import { getMetaobjectDefinition } from "./tools/getMetaobjectDefinition.js";
import { updateMetaobjectDefinition } from "./tools/updateMetaobjectDefinition.js";
import { getLocations } from "./tools/getLocations.js";
import { createDraftOrder } from "./tools/createDraftOrder.js";
import { updateDraftOrder } from "./tools/updateDraftOrder.js";
import { completeDraftOrder } from "./tools/completeDraftOrder.js";
import { getRedirects } from "./tools/getRedirects.js";
import { createRedirect } from "./tools/createRedirect.js";
import { deleteRedirect } from "./tools/deleteRedirect.js";
import { getStoreCounts } from "./tools/getStoreCounts.js";
import { countProductsByTag } from "./tools/countProductsByTag.js";
import { getProductIssues } from "./tools/getProductIssues.js";
import { startBulkExport } from "./tools/startBulkExport.js";
import { getBulkOperationStatus } from "./tools/getBulkOperationStatus.js";
import { getBulkOperationResults } from "./tools/getBulkOperationResults.js";
import { getStatus } from "./tools/getStatus.js";
import { searchTaxonomy } from "./tools/searchTaxonomy.js";
import { findProductsByMetafield } from "./tools/findProductsByMetafield.js";
import { createFileUploadSession } from "./tools/createFileUploadSession.js";
import { uploadLocalFile } from "./tools/uploadLocalFile.js";
import { getFileUploadSession } from "./tools/getFileUploadSession.js";
import { getFiles } from "./tools/getFiles.js";
import { attachFileToProduct } from "./tools/attachFileToProduct.js";
import { detachFileFromProduct } from "./tools/detachFileFromProduct.js";
import { reorderDraftProductMedia } from "./tools/reorderDraftProductMedia.js";

/**
 * The shape every module under src/tools exports. The module's `schema` is
 * the single source of truth for the MCP input schema; nothing in index.ts
 * restates it.
 */
export type ToolModule = {
  name: string;
  description: string;
  schema: z.ZodType;
  // Each tool narrows its own input type; the registry only forwards the
  // arguments the MCP server has already validated against the schema.
  execute: (input: any) => Promise<unknown>;
};

/** Tools initialised with the Shopify GraphQL client and exposed in every mode. */
export const shopifyClientTools = [
  products,
  getCustomers,
  orders,
  updateOrder,
  updateCustomer,
  createProduct,
  updateProduct,
  createProductOption,
  deleteProduct,
  deleteVariant,
  deleteProductImages,
  bulkUpdateProducts,
  bulkSetVariantMetafields,
  bulkDeleteProducts,
  getCollections,
  manageCollectionProducts,
  createCollection,
  updateCollection,
  deleteCollection,
  getInventoryLevels,
  updateInventory,
  updateInventoryItemCustoms,
  updateInventoryItemShipping,
  getMetafields,
  deleteMetafield,
  setMetafield,
  listMetafieldDefinitions,
  createMetafieldDefinition,
  updateMetafieldDefinitionAccess,
  getMetafieldOptions,
  createMetaobject,
  updateMetaobject,
  deleteMetaobject,
  listMetaobjects,
  getMetaobject,
  listMetaobjectDefinitions,
  getMetaobjectDefinition,
  updateMetaobjectDefinition,
  getLocations,
  draftOrders,
  createDraftOrder,
  updateDraftOrder,
  completeDraftOrder,
  getRedirects,
  createRedirect,
  deleteRedirect,
  getStoreCounts,
  countProductsByTag,
  getProductIssues,
  startBulkExport,
  getBulkOperationStatus,
  getBulkOperationResults,
  getStatus,
  searchTaxonomy,
  findProductsByMetafield,
  getFiles,
  attachFileToProduct,
  detachFileFromProduct,
  reorderDraftProductMedia,
] satisfies ToolModule[];

/**
 * Tools only exposed in remote (HTTP) mode. `getFileUploadSession` takes the
 * GraphQL client; `createFileUploadSession` needs the public app URL instead.
 */
export const remoteOnlyTools = [
  createFileUploadSession,
  getFileUploadSession,
] satisfies ToolModule[];

/** Tools only exposed in local (stdio) mode, where the server can read the host filesystem. */
export const localOnlyTools = [uploadLocalFile] satisfies ToolModule[];

export const allTools: ToolModule[] = [
  ...shopifyClientTools,
  ...remoteOnlyTools,
  ...localOnlyTools,
];

/**
 * Tools exposed for one transport. Remote mode hands out upload URLs; local
 * mode can read files straight from the host.
 */
export function toolsForMode(remoteMode: boolean): ToolModule[] {
  return [
    ...shopifyClientTools,
    ...(remoteMode ? remoteOnlyTools : localOnlyTools),
  ];
}

/**
 * The zod object handed to the MCP server as a tool's `inputSchema`.
 *
 * SDK v2 takes the whole schema, not a raw shape: it advertises
 * `~standard.jsonSchema` in `tools/list` and runs `~standard.validate` on
 * every `tools/call`. Passing the module's own object therefore enforces
 * object-level `.refine()` / `.superRefine()` rules at the server, before
 * `execute` runs; in zod 4 those return the same `ZodObject` and are simply
 * omitted from the JSON Schema. The refining tools keep their own
 * `schema.parse` as well, so direct callers of `execute` see the same errors.
 *
 * zod 4.6's JSON Schema output inlines reused sub-schema instances, so no
 * `$ref` / `$defs` reach clients; `__tests__/toolRegistry.test.ts` guards that.
 *
 * MCP requires an object root, and the SDK only reports a non-object schema
 * lazily (at `tools/list`), so check it here at registration time instead.
 */
export function toolInputSchema(tool: ToolModule): z.ZodObject {
  if (!(tool.schema instanceof z.ZodObject)) {
    throw new Error(
      `Tool "${tool.name}" schema must be a zod object, got ${tool.schema.constructor.name}`,
    );
  }
  return tool.schema;
}

/** Register one tool module on an MCP server, forwarding its result as a JSON text block. */
export function registerTool(server: McpServer, tool: ToolModule): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: toolInputSchema(tool),
    },
    async (args) => {
      const result = await tool.execute(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
