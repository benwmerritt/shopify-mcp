import { readdirSync } from "node:fs";
import { join } from "node:path";

import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from "zod";

import {
  READ_ONLY_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  applyToolAccessPolicy,
} from "../src/toolAccess.js";
import {
  allTools,
  registerTool,
  shopifyClientTools,
  toolInputSchema,
  toolsForMode,
  type ToolModule,
} from "../src/toolRegistry.js";

const toolsDir = join(process.cwd(), "src", "tools");

// Files under src/tools that are helpers rather than tool modules.
const NON_TOOL_FILES = new Set(["metaobjectDefinitionUtils.ts"]);

function kebabCase(fileBase: string): string {
  return fileBase.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("tool registry", () => {
  const names = allTools.map((tool) => tool.name);

  it("gives every tool a unique name", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("registers every tool module under src/tools", () => {
    const expected = readdirSync(toolsDir)
      .filter((file) => file.endsWith(".ts") && !NON_TOOL_FILES.has(file))
      .map((file) => kebabCase(file.replace(/\.ts$/, "")))
      .sort();

    expect([...names].sort()).toEqual(expected);
  });

  it("exposes a zod object and a description for every tool", () => {
    for (const tool of allTools) {
      expect(toolInputSchema(tool)).toBeInstanceOf(z.ZodObject);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("serves every tool schema without $ref", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    for (const tool of allTools) {
      registerTool(server, tool);
    }
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    await client.close();
    await server.close();

    expect(tools).toHaveLength(allTools.length);
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"$ref"');
      expect(tool.description).toBeTruthy();
    }
  });

  it("selects upload tools by transport", async () => {
    const shared = shopifyClientTools.map((tool) => tool.name).sort();
    const listNames = async (remoteMode: boolean, readOnly: boolean) => {
      const server = applyToolAccessPolicy(
        new McpServer({ name: "test", version: "0" }),
        readOnly,
      );
      for (const tool of toolsForMode(remoteMode)) {
        registerTool(server, tool);
      }
      const client = await connectClient(server);
      const { tools } = await client.listTools();
      await client.close();
      await server.close();
      return tools.map((tool) => tool.name).sort();
    };

    expect(await listNames(false, false)).toEqual([...shared, "upload-local-file"].sort());
    expect(await listNames(true, false)).toEqual(
      [...shared, "create-file-upload-session", "get-file-upload-session"].sort(),
    );

    const readOnlyIn = (names: string[]) =>
      names.filter((name) => READ_ONLY_TOOL_NAMES.has(name) && !WRITE_TOOL_NAMES.has(name));
    expect(await listNames(false, true)).toEqual(readOnlyIn(await listNames(false, false)));
    expect(await listNames(true, true)).toEqual(readOnlyIn(await listNames(true, false)));
  });

  it("only allowlists tool names that exist", () => {
    const registered = new Set(names);
    for (const name of [...READ_ONLY_TOOL_NAMES, ...WRITE_TOOL_NAMES]) {
      expect(registered).toContain(name);
    }
  });

  it("rejects a schema that is not a zod object", () => {
    const bad: ToolModule = {
      name: "bad",
      description: "bad",
      schema: z.string(),
      execute: async () => null,
    };
    expect(() => toolInputSchema(bad)).toThrow(/must be a zod object/);
  });

  it("registers name, description and schema on an MCP server and forwards results as JSON", async () => {
    const echo: ToolModule = {
      name: "echo",
      description: "Echo the input back",
      schema: z
        .object({ message: z.string().describe("Text to echo"), times: z.number().default(1) })
        .refine((input) => input.message !== "nope", { message: "nope is not echoed" }),
      execute: async (input: { message: string; times: number }) => ({
        echoed: input.message.repeat(input.times),
      }),
    };

    const server = new McpServer({ name: "test", version: "0" });
    registerTool(server, echo);
    const client = await connectClient(server);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
    expect(tools[0].description).toBe("Echo the input back");
    expect(tools[0].inputSchema.properties).toMatchObject({
      message: { type: "string", description: "Text to echo" },
      times: { type: "number", default: 1 },
    });

    const result = await client.callTool({ name: "echo", arguments: { message: "ab", times: 2 } });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ echoed: "abab" }) }]);

    // Object-level refinements run at the server, before execute.
    const refused = await client.callTool({ name: "echo", arguments: { message: "nope" } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain("nope is not echoed");

    await client.close();
    await server.close();
  });
});
