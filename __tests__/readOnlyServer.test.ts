import { execFileSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

jest.setTimeout(30_000);

async function listServerTools(readOnly: boolean) {
  const args = [
    "dist/index.js",
    "--domain=test-shop.myshopify.com",
    "--accessToken=test-token",
  ];
  if (readOnly) {
    args.push("--read-only");
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    stderr: "pipe",
  });
  const client = new Client({
    name: "read-only-mode-integration-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
  }
}

describe("read-only MCP server integration", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  });

  it("exposes reads and hides mutations without changing normal mode", async () => {
    const [readOnlyDefinitions, normalDefinitions] = await Promise.all([
      listServerTools(true),
      listServerTools(false),
    ]);
    const readOnlyTools = readOnlyDefinitions.map(({ name }) => name).sort();
    const normalTools = normalDefinitions.map(({ name }) => name).sort();
    const createDefinition = normalDefinitions.find(({ name }) => name === "create-metafield-definition");
    expect(createDefinition?.inputSchema.properties?.access).toEqual(
      expect.objectContaining({ type: "object", properties: expect.objectContaining({
        storefront: expect.objectContaining({ enum: ["NONE", "PUBLIC_READ"] }),
      }) }),
    );

    expect(readOnlyTools).toEqual(
      expect.arrayContaining(["products", "list-metaobjects", "get-status"]),
    );
    expect(readOnlyTools.length).toBeLessThan(normalTools.length);

    const mutationTools = [
      "update-product",
      "update-inventory-item-customs",
      "update-inventory-item-shipping",
      "update-metaobject",
      "update-metaobject-definition",
      "create-metafield-definition",
      "update-metafield-definition-access",
      "delete-product",
      "set-metafield",
      "upload-local-file",
      "start-bulk-export",
      "reorder-draft-product-media",
    ];
    for (const toolName of mutationTools) {
      expect(readOnlyTools).not.toContain(toolName);
      expect(normalTools).toContain(toolName);
    }
  });
});
