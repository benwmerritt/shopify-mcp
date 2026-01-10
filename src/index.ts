#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { GraphQLClient } from "graphql-request";
import minimist from "minimist";
import { z } from "zod";

// Import merged tools
import { products } from "./tools/products.js";
import { orders } from "./tools/orders.js";
import { draftOrders } from "./tools/draftOrders.js";

// Import other tools
import { getCustomers } from "./tools/getCustomers.js";
import { updateCustomer } from "./tools/updateCustomer.js";
import { updateOrder } from "./tools/updateOrder.js";
import { createProduct } from "./tools/createProduct.js";
import { updateProduct } from "./tools/updateProduct.js";
import { deleteProduct } from "./tools/deleteProduct.js";
import { deleteVariant } from "./tools/deleteVariant.js";
import { deleteProductImages } from "./tools/deleteProductImages.js";
import { bulkUpdateProducts } from "./tools/bulkUpdateProducts.js";
import { bulkDeleteProducts } from "./tools/bulkDeleteProducts.js";
import { getCollections } from "./tools/getCollections.js";
import { manageCollectionProducts } from "./tools/manageCollectionProducts.js";
import { createCollection } from "./tools/createCollection.js";
import { updateCollection } from "./tools/updateCollection.js";
import { deleteCollection } from "./tools/deleteCollection.js";
import { getInventoryLevels } from "./tools/getInventoryLevels.js";
import { updateInventory } from "./tools/updateInventory.js";
import { getMetafields } from "./tools/getMetafields.js";
import { deleteMetafield } from "./tools/deleteMetafield.js";
import { setMetafield } from "./tools/setMetafield.js";
import { getLocations } from "./tools/getLocations.js";
import { createDraftOrder } from "./tools/createDraftOrder.js";
import { updateDraftOrder } from "./tools/updateDraftOrder.js";
import { completeDraftOrder } from "./tools/completeDraftOrder.js";
import { getRedirects } from "./tools/getRedirects.js";
import { createRedirect } from "./tools/createRedirect.js";
import { deleteRedirect } from "./tools/deleteRedirect.js";
import { getStoreCounts } from "./tools/getStoreCounts.js";
import { getProductIssues } from "./tools/getProductIssues.js";
import { startBulkExport } from "./tools/startBulkExport.js";
import { getBulkOperationStatus } from "./tools/getBulkOperationStatus.js";
import { getBulkOperationResults } from "./tools/getBulkOperationResults.js";

// Import OAuth helpers
import { runOAuthFlow, loadToken } from "./oauth.js";

// Parse command line arguments
const argv = minimist(process.argv.slice(2));

// Load environment variables from .env file (if it exists)
dotenv.config();

// Get configuration from command line or environment
const MYSHOPIFY_DOMAIN = argv.domain || process.env.MYSHOPIFY_DOMAIN;
const SHOPIFY_CLIENT_ID = argv.clientId || process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = argv.clientSecret || process.env.SHOPIFY_CLIENT_SECRET;
const OAUTH_SCOPES = argv.scopes || process.env.SHOPIFY_SCOPES;
const RUN_OAUTH = argv.oauth === true;

/**
 * Start the MCP server with the given access token
 */
async function startServer(accessToken: string, domain: string): Promise<void> {
  // Store in process.env for backwards compatibility
  process.env.SHOPIFY_ACCESS_TOKEN = accessToken;
  process.env.MYSHOPIFY_DOMAIN = domain;

  // Create Shopify GraphQL client
  const shopifyClient = new GraphQLClient(
    `https://${domain}/admin/api/2023-07/graphql.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    }
  );

  // Initialize merged tools
  products.initialize(shopifyClient);
  orders.initialize(shopifyClient);
  draftOrders.initialize(shopifyClient);

  // Initialize other tools
  getCustomers.initialize(shopifyClient);
  updateCustomer.initialize(shopifyClient);
  updateOrder.initialize(shopifyClient);
  createProduct.initialize(shopifyClient);
  updateProduct.initialize(shopifyClient);
  deleteProduct.initialize(shopifyClient);
  deleteVariant.initialize(shopifyClient);
  deleteProductImages.initialize(shopifyClient);
  bulkUpdateProducts.initialize(shopifyClient);
  bulkDeleteProducts.initialize(shopifyClient);
  getCollections.initialize(shopifyClient);
  manageCollectionProducts.initialize(shopifyClient);
  createCollection.initialize(shopifyClient);
  updateCollection.initialize(shopifyClient);
  deleteCollection.initialize(shopifyClient);
  getInventoryLevels.initialize(shopifyClient);
  updateInventory.initialize(shopifyClient);
  getMetafields.initialize(shopifyClient);
  deleteMetafield.initialize(shopifyClient);
  setMetafield.initialize(shopifyClient);
  getLocations.initialize(shopifyClient);
  createDraftOrder.initialize(shopifyClient);
  updateDraftOrder.initialize(shopifyClient);
  completeDraftOrder.initialize(shopifyClient);
  getRedirects.initialize(shopifyClient);
  createRedirect.initialize(shopifyClient);
  deleteRedirect.initialize(shopifyClient);
  getStoreCounts.initialize(shopifyClient);
  getProductIssues.initialize(shopifyClient);
  startBulkExport.initialize(shopifyClient);
  getBulkOperationStatus.initialize(shopifyClient);
  getBulkOperationResults.initialize(shopifyClient);

  // Set up MCP server
  const server = new McpServer({
    name: "shopify",
    version: "1.0.0",
    description:
      "MCP Server for Shopify API, enabling interaction with store data through GraphQL API"
  });

  // ==================== MERGED PRODUCT TOOL ====================
  // Replaces: get-products, get-product-by-id, search-products
  server.tool(
    "products",
    {
      id: z.string().optional().describe("Product ID for single product lookup (can be numeric or full GID)"),
      title: z.string().optional().describe("Filter by product title (partial match)"),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("Filter by product status"),
      vendor: z.string().optional().describe("Filter by vendor name (exact match)"),
      tag: z.string().optional().describe("Filter products that have this tag"),
      tagNot: z.string().optional().describe("Filter products that do NOT have this tag"),
      productType: z.string().optional().describe("Filter by product type"),
      inventoryTotal: z.number().optional().describe("Filter by exact inventory count"),
      inventoryLessThan: z.number().optional().describe("Filter products with inventory less than this"),
      inventoryGreaterThan: z.number().optional().describe("Filter products with inventory greater than this"),
      createdAfter: z.string().optional().describe("Filter products created after this date (ISO 8601)"),
      createdBefore: z.string().optional().describe("Filter products created before this date (ISO 8601)"),
      updatedAfter: z.string().optional().describe("Filter products updated after this date (ISO 8601)"),
      hasImages: z.boolean().optional().describe("Filter products that have (true) or don't have (false) images"),
      limit: z.number().default(50).describe("Maximum number of products to return (max 250)"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page"),
      fields: z.union([
        z.enum(["slim", "standard", "full"]),
        z.array(z.string())
      ]).default("slim").describe("Fields to return: 'slim' (default), 'standard', 'full', or array of field names")
    },
    async (args) => {
      const result = await products.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  server.tool(
    "get-customers",
    {
      searchQuery: z.string().optional(),
      limit: z.number().default(10),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await getCustomers.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== MERGED ORDERS TOOL ====================
  // Replaces: get-orders, get-order-by-id, get-customer-orders
  server.tool(
    "orders",
    {
      id: z.string().optional().describe("Order ID for single order lookup (can be numeric or full GID)"),
      customerId: z.string().optional().describe("Filter orders by customer ID (numeric)"),
      status: z.enum(["any", "open", "closed", "cancelled"]).default("any").describe("Filter by order status"),
      limit: z.number().default(10).describe("Maximum number of orders to return"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await orders.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Add the updateOrder tool
  server.tool(
    "update-order",
    {
      id: z.string().min(1),
      tags: z.array(z.string()).optional(),
      email: z.string().email().optional(),
      note: z.string().optional(),
      customAttributes: z
        .array(
          z.object({
            key: z.string(),
            value: z.string()
          })
        )
        .optional(),
      metafields: z
        .array(
          z.object({
            id: z.string().optional(),
            namespace: z.string().optional(),
            key: z.string().optional(),
            value: z.string(),
            type: z.string().optional()
          })
        )
        .optional(),
      shippingAddress: z
        .object({
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          company: z.string().optional(),
          country: z.string().optional(),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          phone: z.string().optional(),
          province: z.string().optional(),
          zip: z.string().optional()
        })
        .optional()
    },
    async (args) => {
      const result = await updateOrder.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Add the updateCustomer tool
  server.tool(
    "update-customer",
    {
      id: z
        .string()
        .regex(/^\d+$/, "Customer ID must be numeric")
        .describe("Shopify customer ID, numeric excluding gid prefix"),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
      note: z.string().optional(),
      taxExempt: z.boolean().optional(),
      metafields: z
        .array(
          z.object({
            id: z.string().optional(),
            namespace: z.string().optional(),
            key: z.string().optional(),
            value: z.string(),
            type: z.string().optional()
          })
        )
        .optional()
    },
    async (args) => {
      const result = await updateCustomer.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Add the createProduct tool (enhanced with variants, pricing, images)
  // Note: weight must be set separately via inventory item update
  server.tool(
    "create-product",
    {
      // Basic product fields
      title: z.string().min(1),
      descriptionHtml: z.string().optional(),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),

      // Simple product fields (when no variants)
      price: z.string().optional(),
      compareAtPrice: z.string().optional(),
      sku: z.string().optional(),
      barcode: z.string().optional(),

      // Product options (e.g., ["Size", "Color"])
      options: z.array(z.string()).optional(),

      // Variants for products with multiple options
      variants: z.array(z.object({
        price: z.string(),
        compareAtPrice: z.string().optional(),
        sku: z.string().optional(),
        barcode: z.string().optional(),
        options: z.array(z.string()),
      })).optional(),

      // Images via URL
      images: z.array(z.object({
        src: z.string(),
        altText: z.string().optional(),
      })).optional(),
    },
    async (args) => {
      const result = await createProduct.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Add the updateProduct tool (for mass cleanup of imported products)
  // Note: weight must be set separately via inventory item update
  server.tool(
    "update-product",
    {
      // REQUIRED - product ID
      id: z.string().min(1),

      // Basic product fields (all optional)
      title: z.string().optional(),
      descriptionHtml: z.string().optional(),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),

      // Simple variant fields (auto-updates first variant)
      price: z.string().optional(),
      compareAtPrice: z.string().optional(),
      sku: z.string().optional(),
      barcode: z.string().optional(),

      // For updating specific variants
      variants: z.array(z.object({
        id: z.string().optional(),
        price: z.string().optional(),
        compareAtPrice: z.string().optional(),
        sku: z.string().optional(),
        barcode: z.string().optional(),
        options: z.array(z.string()).optional(),
      })).optional(),

      // Images
      images: z.array(z.object({
        src: z.string(),
        altText: z.string().optional(),
      })).optional(),
    },
    async (args) => {
      const result = await updateProduct.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== DATA CLEANUP TOOLS ====================

  // Delete a single product
  server.tool(
    "delete-product",
    {
      productId: z.string().min(1).describe("Product ID (can be numeric or full GID)")
    },
    async (args) => {
      const result = await deleteProduct.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Delete a product variant
  server.tool(
    "delete-variant",
    {
      variantId: z.string().min(1).describe("Variant ID to delete (can be numeric or full GID)")
    },
    async (args) => {
      const result = await deleteVariant.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Delete product images
  server.tool(
    "delete-product-images",
    {
      productId: z.string().min(1).describe("Product ID (can be numeric or full GID)"),
      imageIds: z.array(z.string().min(1)).min(1).describe("Array of image/media IDs to delete")
    },
    async (args) => {
      const result = await deleteProductImages.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Bulk update products
  server.tool(
    "bulk-update-products",
    {
      productIds: z.array(z.string().min(1)).min(1).max(100).describe("Array of product IDs to update (max 100)"),
      update: z.object({
        status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
        vendor: z.string().optional(),
        productType: z.string().optional(),
        tags: z.array(z.string()).optional().describe("Replace all tags with these"),
        addTags: z.array(z.string()).optional().describe("Add these tags (keeps existing)"),
        removeTags: z.array(z.string()).optional().describe("Remove these specific tags")
      })
    },
    async (args) => {
      const result = await bulkUpdateProducts.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Bulk delete products
  server.tool(
    "bulk-delete-products",
    {
      productIds: z.array(z.string().min(1)).min(1).max(100).describe("Array of product IDs to delete (max 100)")
    },
    async (args) => {
      const result = await bulkDeleteProducts.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== COLLECTION TOOLS ====================

  // Get collections
  server.tool(
    "get-collections",
    {
      title: z.string().optional().describe("Filter by collection title (partial match)"),
      type: z.enum(["smart", "custom", "all"]).default("all").describe("Filter by collection type"),
      limit: z.number().default(50).describe("Maximum number of collections to return"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await getCollections.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Manage collection products (add/remove/list)
  server.tool(
    "manage-collection-products",
    {
      collectionId: z.string().min(1).describe("Collection ID (can be numeric or full GID)"),
      action: z.enum(["add", "remove", "list"]).describe("Action to perform"),
      productIds: z.array(z.string()).optional().describe("Product IDs to add or remove (required for add/remove)")
    },
    async (args) => {
      const result = await manageCollectionProducts.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Create collection (custom or smart)
  server.tool(
    "create-collection",
    {
      title: z.string().min(1).describe("Collection title"),
      descriptionHtml: z.string().optional().describe("HTML description"),
      handle: z.string().optional().describe("URL handle (auto-generated if not provided)"),
      image: z.object({
        src: z.string(),
        altText: z.string().optional()
      }).optional().describe("Collection image"),
      productIds: z.array(z.string()).optional().describe("Product IDs to add (for custom collections)"),
      rules: z.array(z.object({
        column: z.enum(["TAG", "VENDOR", "TYPE", "TITLE", "VARIANT_PRICE", "VARIANT_INVENTORY", "IS_PRICE_REDUCED"]),
        relation: z.enum(["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "GREATER_THAN", "LESS_THAN"]),
        condition: z.string()
      })).optional().describe("Rules for smart collection auto-population"),
      rulesApplyDisjunctively: z.boolean().default(false).describe("true = OR logic, false = AND logic"),
      sortOrder: z.enum(["MANUAL", "BEST_SELLING", "ALPHA_ASC", "ALPHA_DESC", "CREATED_DESC", "CREATED", "PRICE_DESC", "PRICE_ASC"]).optional()
    },
    async (args) => {
      const result = await createCollection.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Update collection
  server.tool(
    "update-collection",
    {
      id: z.string().min(1).describe("Collection ID to update"),
      title: z.string().optional().describe("New collection title"),
      descriptionHtml: z.string().optional().describe("New HTML description"),
      handle: z.string().optional().describe("New URL handle"),
      image: z.object({
        src: z.string(),
        altText: z.string().optional()
      }).optional().describe("New collection image"),
      rules: z.array(z.object({
        column: z.enum(["TAG", "VENDOR", "TYPE", "TITLE", "VARIANT_PRICE", "VARIANT_INVENTORY", "IS_PRICE_REDUCED"]),
        relation: z.enum(["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "ENDS_WITH", "GREATER_THAN", "LESS_THAN"]),
        condition: z.string()
      })).optional().describe("New rules for smart collection (replaces existing)"),
      rulesApplyDisjunctively: z.boolean().optional().describe("true = OR logic, false = AND logic"),
      sortOrder: z.enum(["MANUAL", "BEST_SELLING", "ALPHA_ASC", "ALPHA_DESC", "CREATED_DESC", "CREATED", "PRICE_DESC", "PRICE_ASC"]).optional()
    },
    async (args) => {
      const result = await updateCollection.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Delete collection
  server.tool(
    "delete-collection",
    {
      collectionId: z.string().min(1).describe("Collection ID to delete")
    },
    async (args) => {
      const result = await deleteCollection.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== INVENTORY TOOLS ====================

  // Get inventory levels
  server.tool(
    "get-inventory-levels",
    {
      productId: z.string().optional().describe("Filter by product ID to see inventory for that product"),
      locationId: z.string().optional().describe("Filter by location ID"),
      limit: z.number().default(50).describe("Maximum number of inventory items to return"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await getInventoryLevels.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Update inventory
  server.tool(
    "update-inventory",
    {
      inventoryItemId: z.string().min(1).describe("Inventory item ID (from getInventoryLevels)"),
      locationId: z.string().min(1).describe("Location ID where inventory is stored"),
      delta: z.number().optional().describe("Amount to adjust inventory by (positive or negative)"),
      setQuantity: z.number().optional().describe("Set inventory to this exact quantity"),
      reason: z.enum([
        "correction",
        "cycle_count_available",
        "damaged",
        "movement_created",
        "movement_updated",
        "movement_received",
        "movement_canceled",
        "other",
        "promotion",
        "quality_control",
        "received",
        "reservation_created",
        "reservation_deleted",
        "reservation_updated",
        "restock",
        "safety_stock",
        "shrinkage"
      ]).default("correction").describe("Reason for the inventory change")
    },
    async (args) => {
      const result = await updateInventory.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== METAFIELD TOOLS ====================

  // Get metafields
  server.tool(
    "get-metafields",
    {
      ownerType: z.enum(["PRODUCT", "PRODUCTVARIANT", "CUSTOMER", "ORDER", "COLLECTION", "SHOP"]).describe("Type of resource to get metafields for"),
      ownerId: z.string().optional().describe("ID of the specific resource (required for all except SHOP)"),
      namespace: z.string().optional().describe("Filter by metafield namespace"),
      limit: z.number().default(50).describe("Maximum number of metafields to return")
    },
    async (args) => {
      const result = await getMetafields.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Delete metafield
  server.tool(
    "delete-metafield",
    {
      metafieldId: z.string().min(1).describe("Metafield ID to delete (can be numeric or full GID)")
    },
    async (args) => {
      const result = await deleteMetafield.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Set metafield (create or update)
  server.tool(
    "set-metafield",
    {
      ownerId: z.string().min(1).describe("ID of the resource to set metafield on (Product, Customer, Order, etc.)"),
      ownerType: z.enum(["PRODUCT", "PRODUCTVARIANT", "CUSTOMER", "ORDER", "COLLECTION", "SHOP"]).describe("Type of resource"),
      namespace: z.string().min(1).describe("Metafield namespace (e.g., 'custom', 'my_app')"),
      key: z.string().min(1).describe("Metafield key"),
      value: z.string().describe("Metafield value (JSON string for complex types)"),
      type: z.enum([
        "single_line_text_field",
        "multi_line_text_field",
        "rich_text_field",
        "number_integer",
        "number_decimal",
        "boolean",
        "date",
        "date_time",
        "json",
        "weight",
        "dimension",
        "volume",
        "money",
        "rating",
        "url",
        "color",
        "product_reference",
        "variant_reference",
        "collection_reference",
        "file_reference",
        "page_reference",
        "metaobject_reference",
        "list.single_line_text_field",
        "list.number_integer",
        "list.number_decimal",
        "list.date",
        "list.date_time",
        "list.url",
        "list.color",
        "list.product_reference",
        "list.variant_reference",
        "list.collection_reference",
        "list.file_reference",
        "list.page_reference",
        "list.metaobject_reference"
      ]).default("single_line_text_field").describe("Metafield type (determines how value is stored and validated)")
    },
    async (args) => {
      const result = await setMetafield.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== LOCATION TOOLS ====================

  // Get locations
  server.tool(
    "get-locations",
    {
      includeInactive: z.boolean().default(false).describe("Include inactive locations"),
      includeLegacy: z.boolean().default(false).describe("Include legacy locations"),
      limit: z.number().default(50).describe("Maximum number of locations to return")
    },
    async (args) => {
      const result = await getLocations.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== DRAFT ORDER TOOLS ====================

  // Merged draft-orders tool (replaces get-draft-orders and get-draft-order-by-id)
  server.tool(
    "draft-orders",
    {
      id: z.string().optional().describe("Draft order ID for single lookup (can be numeric or full GID)"),
      status: z.enum(["OPEN", "INVOICE_SENT", "COMPLETED"]).optional().describe("Filter by draft order status"),
      query: z.string().optional().describe("Search query (Shopify search syntax)"),
      limit: z.number().default(50).describe("Maximum number of draft orders to return"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await draftOrders.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Create draft order
  server.tool(
    "create-draft-order",
    {
      lineItems: z.array(z.object({
        variantId: z.string().optional().describe("Product variant ID (for existing products)"),
        quantity: z.number().min(1).describe("Quantity to add"),
        title: z.string().optional().describe("Custom line item title (required if no variantId)"),
        originalUnitPrice: z.string().optional().describe("Price per unit for custom items"),
        taxable: z.boolean().optional(),
        requiresShipping: z.boolean().optional(),
        sku: z.string().optional(),
        appliedDiscount: z.object({
          value: z.number(),
          valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
          title: z.string().optional()
        }).optional()
      })).min(1).describe("Line items (at least 1 required)"),
      email: z.string().email().optional().describe("Customer email"),
      phone: z.string().optional().describe("Customer phone"),
      customerId: z.string().optional().describe("Existing customer ID to attach"),
      shippingAddress: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        phone: z.string().optional()
      }).optional(),
      billingAddress: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        phone: z.string().optional()
      }).optional(),
      appliedDiscount: z.object({
        value: z.number(),
        valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
        title: z.string().optional(),
        description: z.string().optional()
      }).optional().describe("Order-level discount"),
      shippingLine: z.object({
        title: z.string(),
        price: z.string()
      }).optional().describe("Shipping method and price"),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
      taxExempt: z.boolean().optional()
    },
    async (args) => {
      const result = await createDraftOrder.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Update draft order
  server.tool(
    "update-draft-order",
    {
      id: z.string().min(1).describe("Draft order ID to update"),
      lineItems: z.array(z.object({
        variantId: z.string().optional(),
        quantity: z.number().min(1),
        title: z.string().optional(),
        originalUnitPrice: z.string().optional(),
        taxable: z.boolean().optional(),
        requiresShipping: z.boolean().optional(),
        sku: z.string().optional(),
        appliedDiscount: z.object({
          value: z.number(),
          valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
          title: z.string().optional()
        }).optional()
      })).optional().describe("Replace line items (omit to keep existing)"),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      customerId: z.string().optional(),
      shippingAddress: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        phone: z.string().optional()
      }).optional(),
      billingAddress: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        phone: z.string().optional()
      }).optional(),
      appliedDiscount: z.object({
        value: z.number(),
        valueType: z.enum(["FIXED_AMOUNT", "PERCENTAGE"]),
        title: z.string().optional(),
        description: z.string().optional()
      }).optional(),
      shippingLine: z.object({
        title: z.string(),
        price: z.string()
      }).optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
      taxExempt: z.boolean().optional()
    },
    async (args) => {
      const result = await updateDraftOrder.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Complete draft order
  server.tool(
    "complete-draft-order",
    {
      id: z.string().min(1).describe("Draft order ID to complete"),
      paymentPending: z.boolean().default(false).describe("If true, marks payment as pending. If false, marks as paid.")
    },
    async (args) => {
      const result = await completeDraftOrder.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== URL REDIRECT TOOLS ====================

  // Get redirects
  server.tool(
    "get-redirects",
    {
      path: z.string().optional().describe("Filter redirects by source path (partial match)"),
      limit: z.number().default(50).describe("Maximum number of redirects to return"),
      cursor: z.string().optional().describe("Pagination cursor for fetching next page")
    },
    async (args) => {
      const result = await getRedirects.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Create redirect
  server.tool(
    "create-redirect",
    {
      path: z.string().min(1).describe("Source path to redirect from (e.g., /products/old-product)"),
      target: z.string().min(1).describe("Target URL to redirect to (e.g., /products/new-product or full URL)")
    },
    async (args) => {
      const result = await createRedirect.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Delete redirect
  server.tool(
    "delete-redirect",
    {
      redirectId: z.string().min(1).describe("Redirect ID to delete (can be numeric or full GID)")
    },
    async (args) => {
      const result = await deleteRedirect.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== ANALYTICS TOOLS ====================

  // Get store counts
  server.tool(
    "get-store-counts",
    {},
    async (args) => {
      const result = await getStoreCounts.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Get product issues (audit tool)
  server.tool(
    "get-product-issues",
    {
      issues: z.array(z.enum([
        "zero_inventory",
        "low_stock",
        "missing_images",
        "zero_price"
      ])).optional().describe("Which issues to check (defaults to all)"),
      lowStockThreshold: z.number().default(10).describe("Threshold for low stock warning"),
      sampleSize: z.number().default(10).describe("Number of example products to return per issue")
    },
    async (args) => {
      const result = await getProductIssues.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // ==================== BULK OPERATIONS TOOLS ====================

  // Start bulk export
  server.tool(
    "start-bulk-export",
    {
      type: z.enum(["products", "orders", "customers", "inventory", "custom"]).describe("Type of export to run"),
      query: z.string().optional().describe("Filter query (e.g., 'status:active' for products)"),
      dateFrom: z.string().optional().describe("Start date for orders (ISO 8601)"),
      dateTo: z.string().optional().describe("End date for orders (ISO 8601)"),
      customQuery: z.string().optional().describe("Custom GraphQL query (required if type='custom')"),
      includeMetafields: z.boolean().default(false).describe("Include metafields in export")
    },
    async (args) => {
      const result = await startBulkExport.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Get bulk operation status
  server.tool(
    "get-bulk-operation-status",
    {
      operationId: z.string().optional().describe("Specific operation ID to check. If omitted, checks the current/most recent operation.")
    },
    async (args) => {
      const result = await getBulkOperationStatus.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Get bulk operation results
  server.tool(
    "get-bulk-operation-results",
    {
      operationId: z.string().optional().describe("Specific operation ID. If omitted, uses the most recent completed operation."),
      format: z.enum(["summary", "sample", "full"]).default("summary").describe("Output format: 'summary' (metadata only), 'sample' (first N objects), 'full' (up to 1000 objects)"),
      sampleSize: z.number().default(10).describe("Number of objects to return for 'sample' format (default 10)")
    },
    async (args) => {
      const result = await getBulkOperationResults.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Handle OAuth flow mode
  if (RUN_OAUTH) {
    if (!MYSHOPIFY_DOMAIN) {
      console.error("Error: --domain is required for OAuth flow.");
      console.error("  Example: --domain=your-store.myshopify.com");
      process.exit(1);
    }
    if (!SHOPIFY_CLIENT_ID) {
      console.error("Error: --clientId or SHOPIFY_CLIENT_ID is required for OAuth flow.");
      process.exit(1);
    }
    if (!SHOPIFY_CLIENT_SECRET) {
      console.error("Error: --clientSecret or SHOPIFY_CLIENT_SECRET is required for OAuth flow.");
      process.exit(1);
    }

    // Run OAuth flow and exit
    await runOAuthFlow(MYSHOPIFY_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, OAUTH_SCOPES);
    return;
  }

  // Normal MCP server mode
  let accessToken = argv.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;

  // If no access token provided, try to load from saved tokens
  if (!accessToken && MYSHOPIFY_DOMAIN) {
    const savedToken = loadToken(MYSHOPIFY_DOMAIN);
    if (savedToken) {
      accessToken = savedToken.access_token;
      console.error(`Using saved token for ${MYSHOPIFY_DOMAIN} (obtained: ${savedToken.obtained_at})`);
    }
  }

  // If still no token but we have client credentials, suggest OAuth
  if (!accessToken && SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET) {
    console.error("Error: No access token found.");
    console.error("Run with --oauth to authorize and obtain an access token:");
    console.error(`  npx shopify-mcp --oauth --domain=${MYSHOPIFY_DOMAIN || "your-store.myshopify.com"}`);
    process.exit(1);
  }

  // Validate required configuration
  if (!accessToken) {
    console.error("Error: SHOPIFY_ACCESS_TOKEN is required.");
    console.error("Please provide it via command line argument, .env file, or run OAuth flow.");
    console.error("  Command line: --accessToken=your_token");
    console.error("  OAuth flow:   --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=xxx");
    process.exit(1);
  }

  if (!MYSHOPIFY_DOMAIN) {
    console.error("Error: MYSHOPIFY_DOMAIN is required.");
    console.error("Please provide it via command line argument or .env file.");
    console.error("  Command line: --domain=your-store.myshopify.com");
    process.exit(1);
  }

  await startServer(accessToken, MYSHOPIFY_DOMAIN);
}

// Run main
main().catch((error) => {
  console.error("Failed to start Shopify MCP Server:", error);
  process.exit(1);
});
