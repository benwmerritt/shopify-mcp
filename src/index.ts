#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
// import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { Request, Response } from "express";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { GraphQLClient } from "graphql-request";
import minimist from "minimist";
import multer from "multer";

import {
  registerTool,
  shopifyClientTools,
  toolsForMode,
} from "./toolRegistry.js";
import { createFileUploadSession } from "./tools/createFileUploadSession.js";
import { getFileUploadSession } from "./tools/getFileUploadSession.js";
import { uploadLocalFile } from "./tools/uploadLocalFile.js";

// Import OAuth helpers
import {
  createAuthenticatedFetch,
  createClientCredentialsTokenProvider,
  loadToken,
  runOAuthFlow,
} from "./oauth.js";
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_FILE_UPLOAD_MAX_BYTES,
  SHOPIFY_FILE_UPLOAD_SESSION_TTL_MINUTES,
  getPublicAppUrl,
} from "./config.js";
import { cleanupExpiredUploadSessions, getUploadSession, updateUploadSession } from "./files/uploadSessions.js";
import { escapeHtml } from "./files/uploadUtils.js";
import { uploadFileToShopify } from "./files/uploadPipeline.js";
import {
  applyToolAccessPolicy,
  parseReadOnlyMode,
} from "./toolAccess.js";

// Parse command line arguments
const argv = minimist(process.argv.slice(2));

// Load environment variables from .env file (if it exists)
dotenv.config();

// Get configuration from command line or environment
const MYSHOPIFY_DOMAIN = argv.domain || process.env.MYSHOPIFY_DOMAIN;
const SHOPIFY_CLIENT_ID = argv.clientId || process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET =
  argv.clientSecret || process.env.SHOPIFY_CLIENT_SECRET;
const OAUTH_SCOPES = argv.scopes || process.env.SHOPIFY_SCOPES;
const RUN_OAUTH = argv.oauth === true;
const REMOTE_MODE = argv.remote === true || process.env.REMOTE_MCP === "true";
const READ_ONLY_MODE = parseReadOnlyMode(
  argv.readOnly ?? argv["read-only"] ?? process.env.SHOPIFY_MCP_READ_ONLY,
);
const PORT = parseInt(process.env.PORT || "3000", 10);

type UploadedFile = {
  path: string;
  originalname: string;
  mimetype?: string;
};

function isMulterLimitError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

type AccessTokenProvider = () => Promise<string>;

/**
 * Start the MCP server with an access-token provider. Client-credentials
 * providers renew Shopify's 24-hour tokens before they expire.
 */
async function startServer(
  getAccessToken: AccessTokenProvider,
  domain: string,
): Promise<void> {
  const initialAccessToken = await getAccessToken();

  // Store the initial value in process.env for backwards compatibility.
  process.env.SHOPIFY_ACCESS_TOKEN = initialAccessToken;
  process.env.MYSHOPIFY_DOMAIN = domain;
  process.env.SHOPIFY_MCP_READ_ONLY = READ_ONLY_MODE ? "true" : "false";

  // Create Shopify GraphQL client. The fetch wrapper asks the provider for the
  // current token on every request, so long-running MCP processes renew safely.
  const shopifyClient = new GraphQLClient(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      fetch: createAuthenticatedFetch(getAccessToken),
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  // Initialize tools with shopifyClient
  for (const tool of [...shopifyClientTools, getFileUploadSession]) {
    tool.initialize(shopifyClient);
  }

  const publicAppUrl = getPublicAppUrl(PORT);
  createFileUploadSession.initialize({
    remoteMode: REMOTE_MODE,
    publicAppUrl,
  });
  uploadLocalFile.initialize({
    client: shopifyClient,
    localMode: !REMOTE_MODE,
  });

  const tools = toolsForMode(REMOTE_MODE);

  // Function to create a new MCP server with all tools registered
  // This is called per-connection in remote mode, once in local mode
  function createMcpServer(): McpServer {
    const server = new McpServer({
      name: READ_ONLY_MODE ? "shopify-read-only" : "shopify",
      version: "1.0.0",
      description: READ_ONLY_MODE
        ? "Read-only MCP Server for Shopify API; mutating tools are not exposed"
        : "MCP Server for Shopify API, enabling interaction with store data through GraphQL API",
    });

    applyToolAccessPolicy(server, READ_ONLY_MODE);

    if (READ_ONLY_MODE) {
      console.error("Shopify MCP read-only mode enabled: fail-closed tool allowlist active");
    }

    for (const tool of tools) {
      registerTool(server, tool);
    }

    return server;
  }

  // Start the server based on mode
  if (REMOTE_MODE) {
    // Remote mode: Express + SSE
    const app = express();
    const uploadTmpDir = join(tmpdir(), "shopify-mcp-uploads");
    mkdirSync(uploadTmpDir, { recursive: true });

    const upload = multer({
      dest: uploadTmpDir,
      limits: {
        fileSize: SHOPIFY_FILE_UPLOAD_MAX_BYTES,
      },
    });

    const cleanupInterval = setInterval(() => {
      cleanupExpiredUploadSessions();
    }, 60_000);
    cleanupInterval.unref();

    // CORS middleware
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") return res.sendStatus(200);
      next();
    });

    const wantsJson = (req: Request): boolean => {
      if (req.query.format === "json") {
        return true;
      }

      return req.accepts(["html", "json"]) === "json";
    };

    const renderPage = (title: string, body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 2rem; color: #111827; }
      main { max-width: 42rem; margin: 0 auto; }
      form { display: grid; gap: 1rem; margin-top: 1.5rem; }
      input[type="file"] { padding: 0.5rem 0; }
      button { background: #111827; border: 0; border-radius: 0.5rem; color: white; cursor: pointer; padding: 0.75rem 1rem; }
      .meta { color: #4b5563; font-size: 0.95rem; }
      .error { color: #991b1b; }
      .success { color: #065f46; }
      code { background: #f3f4f6; border-radius: 0.25rem; padding: 0.125rem 0.25rem; }
      pre { background: #f3f4f6; border-radius: 0.5rem; overflow: auto; padding: 1rem; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      ${body}
    </main>
  </body>
</html>`;

    const sendUploadResult = (
      req: Request,
      res: Response,
      statusCode: number,
      payload: Record<string, unknown>,
      title: string,
      bodyHtml: string,
    ) => {
      if (wantsJson(req)) {
        res.status(statusCode).json(payload);
        return;
      }

      res.status(statusCode).send(renderPage(title, bodyHtml));
    };

    // Store active sessions: each connection gets its own server + transport
    const sessions = new Map<
      string,
      { server: McpServer; transport: SSEServerTransport }
    >();

    // API key validation middleware
    const validateApiKey = (req: Request, res: Response, next: () => void) => {
      const apiKey = req.query.apiKey as string;
      const expectedKey = process.env.MCP_API_KEY;

      if (!expectedKey) {
        // No API key configured - allow all requests (dev mode)
        return next();
      }

      if (!apiKey || apiKey !== expectedKey) {
        res
          .status(401)
          .json({ error: "Unauthorized: Invalid or missing API key" });
        return;
      }

      next();
    };

    // Health check endpoint (no auth required)
    app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        mode: "remote",
        domain: domain,
        publicAppUrl,
        apiVersion: SHOPIFY_API_VERSION,
      });
    });

    app.get("/uploads/shopify-files/:sessionId", (req: Request, res: Response) => {
      cleanupExpiredUploadSessions();

      const session = getUploadSession(req.params.sessionId);
      if (!session) {
        sendUploadResult(
          req,
          res,
          404,
          { error: "Upload session not found." },
          "Upload Session Not Found",
          "<h1>Upload Session Not Found</h1><p class=\"error\">This upload link is invalid or has already been cleaned up.</p>",
        );
        return;
      }

      if (session.state === "EXPIRED") {
        sendUploadResult(
          req,
          res,
          410,
          {
            sessionId: session.id,
            sessionState: session.state,
            error: "Upload session expired.",
          },
          "Upload Session Expired",
          `<h1>Upload Session Expired</h1><p class="error">This upload link expired at <code>${escapeHtml(
            new Date(session.expiresAt).toISOString(),
          )}</code>.</p>`,
        );
        return;
      }

      if (session.state === "COMPLETE") {
        sendUploadResult(
          req,
          res,
          200,
          {
            sessionId: session.id,
            sessionState: session.state,
            fileId: session.fileId,
          },
          "Upload Complete",
          `<h1>Upload Complete</h1><p class="success">This session already uploaded a file to Shopify.</p><p class="meta">Session ID: <code>${escapeHtml(
            session.id,
          )}</code></p><p class="meta">Use <code>get-file-upload-session</code> in MCP to inspect the uploaded file.</p>`,
        );
        return;
      }

      const errorHtml =
        session.state === "FAILED" && session.error
          ? `<p class="error">Previous upload failed: ${escapeHtml(
              session.error,
            )}</p>`
          : "";

      sendUploadResult(
        req,
        res,
        200,
        {
          sessionId: session.id,
          sessionState: session.state,
          uploadUrl: session.uploadUrl,
          expiresAt: new Date(session.expiresAt).toISOString(),
        },
        "Upload File to Shopify",
        `<h1>Upload File to Shopify</h1>
         <p class="meta">This browser form uploads one file into Shopify Files.</p>
         <p class="meta">Requested kind: <code>${escapeHtml(session.kind)}</code></p>
         <p class="meta">Expires at: <code>${escapeHtml(
           new Date(session.expiresAt).toISOString(),
         )}</code></p>
         ${
           session.altText
             ? `<p class="meta">Alt text: <code>${escapeHtml(session.altText)}</code></p>`
             : ""
         }
         ${errorHtml}
         <form method="post" enctype="multipart/form-data">
           <label>
             <span>Choose file</span><br />
             <input type="file" name="file" required />
           </label>
           <button type="submit">Upload to Shopify</button>
         </form>`,
      );
    });

    app.post("/uploads/shopify-files/:sessionId", (req: Request, res: Response) => {
      upload.single("file")(req, res, (uploadError: unknown) => {
        void (async () => {
          cleanupExpiredUploadSessions();

          const session = getUploadSession(req.params.sessionId);
          if (!session) {
            sendUploadResult(
              req,
              res,
              404,
              { error: "Upload session not found." },
              "Upload Session Not Found",
              "<h1>Upload Session Not Found</h1><p class=\"error\">This upload link is invalid or has already been cleaned up.</p>",
            );
            return;
          }

          if (session.state === "EXPIRED") {
            sendUploadResult(
              req,
              res,
              410,
              {
                sessionId: session.id,
                sessionState: session.state,
                error: "Upload session expired.",
              },
              "Upload Session Expired",
              "<h1>Upload Session Expired</h1><p class=\"error\">This upload link can no longer accept files.</p>",
            );
            return;
          }

          if (session.state === "UPLOADING") {
            sendUploadResult(
              req,
              res,
              409,
              {
                sessionId: session.id,
                sessionState: session.state,
                error: "Upload already in progress.",
              },
              "Upload In Progress",
              "<h1>Upload In Progress</h1><p class=\"error\">This session is already uploading a file.</p>",
            );
            return;
          }

          if (session.state === "COMPLETE") {
            sendUploadResult(
              req,
              res,
              409,
              {
                sessionId: session.id,
                sessionState: session.state,
                error: "Upload session already completed.",
              },
              "Upload Already Complete",
              "<h1>Upload Already Complete</h1><p class=\"error\">This session already uploaded a file.</p>",
            );
            return;
          }

          if (uploadError) {
            const errorMessage =
              isMulterLimitError(uploadError) &&
              uploadError.code === "LIMIT_FILE_SIZE"
                ? `File exceeds the maximum allowed size of ${SHOPIFY_FILE_UPLOAD_MAX_BYTES} bytes.`
                : uploadError instanceof Error
                  ? uploadError.message
                  : String(uploadError);

            updateUploadSession(session.id, {
              state: "FAILED",
              error: errorMessage,
            });

            sendUploadResult(
              req,
              res,
              400,
              {
                sessionId: session.id,
                sessionState: "FAILED",
                error: errorMessage,
              },
              "Upload Failed",
              `<h1>Upload Failed</h1><p class="error">${escapeHtml(
                errorMessage,
              )}</p>`,
            );
            return;
          }

          const uploadedFile = (req as Request & { file?: UploadedFile }).file;
          if (!uploadedFile) {
            sendUploadResult(
              req,
              res,
              400,
              {
                sessionId: session.id,
                sessionState: session.state,
                error: "No file was provided.",
              },
              "No File Provided",
              "<h1>No File Provided</h1><p class=\"error\">Choose a file before submitting the form.</p>",
            );
            return;
          }

          updateUploadSession(session.id, {
            state: "UPLOADING",
            error: undefined,
          });

          try {
            const createdFile = await uploadFileToShopify({
              shopifyClient,
              filePath: uploadedFile.path,
              filename: uploadedFile.originalname,
              mimeType: uploadedFile.mimetype || "application/octet-stream",
              requestedKind: session.kind,
              altText: session.altText,
              duplicateResolutionMode: session.duplicateResolutionMode,
            });

            updateUploadSession(session.id, {
              state: "COMPLETE",
              fileId: createdFile.id,
              error: undefined,
            });

            sendUploadResult(
              req,
              res,
              200,
              {
                sessionId: session.id,
                sessionState: "COMPLETE",
                file: createdFile,
              },
              "Upload Complete",
              `<h1>Upload Complete</h1>
               <p class="success">Your file was uploaded to Shopify Files.</p>
               <p class="meta">File ID: <code>${escapeHtml(
                 createdFile.id,
               )}</code></p>
               <p class="meta">File status: <code>${escapeHtml(
                 createdFile.fileStatus ?? "unknown",
               )}</code></p>
               <p class="meta">Use <code>get-file-upload-session</code> or <code>get-files</code> in MCP to inspect the uploaded file.</p>`,
            );
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            updateUploadSession(session.id, {
              state: "FAILED",
              error: errorMessage,
            });

            sendUploadResult(
              req,
              res,
              500,
              {
                sessionId: session.id,
                sessionState: "FAILED",
                error: errorMessage,
              },
              "Upload Failed",
              `<h1>Upload Failed</h1><p class="error">${escapeHtml(
                errorMessage,
              )}</p>`,
            );
          }
        })().catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          sendUploadResult(
            req,
            res,
            500,
            { error: errorMessage },
            "Upload Failed",
            `<h1>Upload Failed</h1><p class="error">${escapeHtml(
              errorMessage,
            )}</p>`,
          );
        });
      });
    });

    // MCP endpoint - client connects here for server-sent events
    // Each connection gets its own McpServer instance (MCP servers are stateful per-connection)
    app.get("/mcp", validateApiKey, async (req: Request, res: Response) => {
      const apiKey = req.query.apiKey as string | undefined;

      try {
        // Create a NEW server for this connection
        const server = createMcpServer();
        const endpointPath = apiKey
          ? `/messages?apiKey=${encodeURIComponent(apiKey)}`
          : "/messages";
        const transport = new SSEServerTransport(endpointPath, res);
        sessions.set(transport.sessionId, { server, transport });

        console.error(
          `SSE connection from ${req.ip}, session: ${transport.sessionId}`,
        );

        res.on("close", () => {
          sessions.delete(transport.sessionId);
          console.error(`SSE connection closed: ${transport.sessionId}`);
        });

        await server.connect(transport);
      } catch (err) {
        console.error(`SSE error: ${err}`);
      }
    });

    // Messages endpoint - client sends messages here
    app.post(
      "/messages",
      express.json(),
      validateApiKey,
      async (req: Request, res: Response) => {
        console.error(`POST /messages received`);
        const sessionId = req.query.sessionId as string | undefined;
        if (!sessionId) {
          res.status(400).json({ error: "Missing sessionId" });
          return;
        }
        const session = sessions.get(sessionId);
        if (!session) {
          res.status(404).json({ error: "No active SSE connection" });
          return;
        }
        await session.transport.handlePostMessage(req, res, req.body);
      },
    );

    app.listen(PORT, () => {
      console.error(`Shopify MCP Server running in REMOTE mode`);
      console.error(`  Health: http://localhost:${PORT}/health`);
      console.error(`  MCP:    http://localhost:${PORT}/mcp`);
      console.error(`  Public: ${publicAppUrl}`);
      console.error(`  Store:  ${domain}`);
    });
  } else {
    // Local mode: stdio transport - create single server instance
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
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
      console.error(
        "Error: --clientId or SHOPIFY_CLIENT_ID is required for OAuth flow.",
      );
      process.exit(1);
    }
    if (!SHOPIFY_CLIENT_SECRET) {
      console.error(
        "Error: --clientSecret or SHOPIFY_CLIENT_SECRET is required for OAuth flow.",
      );
      process.exit(1);
    }

    // Run OAuth flow and exit
    await runOAuthFlow(
      MYSHOPIFY_DOMAIN,
      SHOPIFY_CLIENT_ID,
      SHOPIFY_CLIENT_SECRET,
      OAUTH_SCOPES,
    );
    return;
  }

  // Normal MCP server mode
  if (!MYSHOPIFY_DOMAIN) {
    console.error("Error: MYSHOPIFY_DOMAIN is required.");
    console.error("Please provide it via command line argument or environment.");
    console.error("  Command line: --domain=your-store.myshopify.com");
    process.exit(1);
  }

  const explicitAccessToken =
    argv.accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
  let getAccessToken: AccessTokenProvider | null = null;

  if (explicitAccessToken) {
    getAccessToken = async () => explicitAccessToken;
  } else if (SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET) {
    getAccessToken = createClientCredentialsTokenProvider(
      MYSHOPIFY_DOMAIN,
      SHOPIFY_CLIENT_ID,
      SHOPIFY_CLIENT_SECRET,
    );
    console.error(
      `Using renewable client-credentials authentication for ${MYSHOPIFY_DOMAIN}`,
    );
  } else if (SHOPIFY_CLIENT_ID || SHOPIFY_CLIENT_SECRET) {
    console.error(
      "Error: Both SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required for client-credentials authentication.",
    );
    process.exit(1);
  } else {
    const savedToken = loadToken(MYSHOPIFY_DOMAIN);
    if (savedToken) {
      getAccessToken = async () => savedToken.access_token;
      console.error(
        `Using saved token for ${MYSHOPIFY_DOMAIN} (obtained: ${savedToken.obtained_at})`,
      );
    }
  }

  if (!getAccessToken) {
    console.error("Error: Shopify authentication is required.");
    console.error(
      "Provide SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET, an explicit access token, or run the authorization-code flow.",
    );
    process.exit(1);
  }

  await startServer(getAccessToken, MYSHOPIFY_DOMAIN);
}

// Run main
main().catch((error) => {
  console.error("Failed to start Shopify MCP Server:", error);
  process.exit(1);
});
