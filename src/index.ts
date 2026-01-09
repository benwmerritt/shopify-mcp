#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { GraphQLClient } from "graphql-request";
import minimist from "minimist";
import { z } from "zod";

// Import tools
import { getCustomerOrders } from "./tools/getCustomerOrders.js";
import { getCustomers } from "./tools/getCustomers.js";
import { getOrderById } from "./tools/getOrderById.js";
import { getOrders } from "./tools/getOrders.js";
import { getProductById } from "./tools/getProductById.js";
import { getProducts } from "./tools/getProducts.js";
import { updateCustomer } from "./tools/updateCustomer.js";
import { updateOrder } from "./tools/updateOrder.js";
import { createProduct } from "./tools/createProduct.js";

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

  // Initialize tools with shopifyClient
  getProducts.initialize(shopifyClient);
  getProductById.initialize(shopifyClient);
  getCustomers.initialize(shopifyClient);
  getOrders.initialize(shopifyClient);
  getOrderById.initialize(shopifyClient);
  updateOrder.initialize(shopifyClient);
  getCustomerOrders.initialize(shopifyClient);
  updateCustomer.initialize(shopifyClient);
  createProduct.initialize(shopifyClient);

  // Set up MCP server
  const server = new McpServer({
    name: "shopify",
    version: "1.0.0",
    description:
      "MCP Server for Shopify API, enabling interaction with store data through GraphQL API"
  });

  // Add tools individually, using their schemas directly
  server.tool(
    "get-products",
    {
      searchTitle: z.string().optional(),
      limit: z.number().default(10)
    },
    async (args) => {
      const result = await getProducts.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  server.tool(
    "get-product-by-id",
    {
      productId: z.string().min(1)
    },
    async (args) => {
      const result = await getProductById.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  server.tool(
    "get-customers",
    {
      searchQuery: z.string().optional(),
      limit: z.number().default(10)
    },
    async (args) => {
      const result = await getCustomers.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  server.tool(
    "get-orders",
    {
      status: z.enum(["any", "open", "closed", "cancelled"]).default("any"),
      limit: z.number().default(10)
    },
    async (args) => {
      const result = await getOrders.execute(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    }
  );

  // Add the getOrderById tool
  server.tool(
    "get-order-by-id",
    {
      orderId: z.string().min(1)
    },
    async (args) => {
      const result = await getOrderById.execute(args);
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

  // Add the getCustomerOrders tool
  server.tool(
    "get-customer-orders",
    {
      customerId: z
        .string()
        .regex(/^\d+$/, "Customer ID must be numeric")
        .describe("Shopify customer ID, numeric excluding gid prefix"),
      limit: z.number().default(10)
    },
    async (args) => {
      const result = await getCustomerOrders.execute(args);
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

  // Add the createProduct tool
  server.tool(
    "create-product",
    {
      title: z.string().min(1),
      descriptionHtml: z.string().optional(),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).optional(),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
    },
    async (args) => {
      const result = await createProduct.execute(args);
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
