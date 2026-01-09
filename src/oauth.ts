import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import open from "open";

const CALLBACK_PORT = 3456;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const TOKEN_DIR = path.join(os.homedir(), ".shopify-mcp");
const TOKEN_FILE = path.join(TOKEN_DIR, "tokens.json");

const DEFAULT_SCOPES = [
  "read_products",
  "write_products",
  "read_customers",
  "write_customers",
  "read_orders",
  "write_orders",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_content",
  "write_content"
].join(",");

export interface TokenData {
  access_token: string;
  scope: string;
  obtained_at: string;
}

interface TokenStore {
  [domain: string]: TokenData;
}

/**
 * Build the Shopify OAuth authorization URL
 */
function buildAuthorizationUrl(
  domain: string,
  clientId: string,
  scopes: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: REDIRECT_URI,
    state: state
  });
  return `https://${domain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Start a temporary HTTP server to capture the OAuth callback
 */
function startCallbackServer(
  expectedState: string
): Promise<{ code: string; shop: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const shop = url.searchParams.get("shop");

      // Validate state to prevent CSRF
      if (state !== expectedState) {
        res.writeHead(400);
        res.end("Invalid state parameter. Possible CSRF attack.");
        server.close();
        reject(new Error("Invalid state parameter"));
        return;
      }

      if (!code || !shop) {
        res.writeHead(400);
        res.end("Missing code or shop parameter");
        server.close();
        reject(new Error("Missing code or shop parameter"));
        return;
      }

      // Send success response to browser
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; text-align: center; }
            h1 { color: #008060; }
            p { color: #637381; }
          </style>
        </head>
        <body>
          <h1>Authorization Successful!</h1>
          <p>You can close this window and return to your terminal.</p>
          <p>The Shopify MCP is now connected to your store.</p>
        </body>
        </html>
      `);

      server.close();
      resolve({ code, shop });
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`Callback server listening on port ${CALLBACK_PORT}...`);
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 5 minutes"));
    }, 5 * 60 * 1000);
  });
}

/**
 * Exchange the authorization code for an access token
 */
async function exchangeCodeForToken(
  domain: string,
  clientId: string,
  clientSecret: string,
  code: string
): Promise<TokenData> {
  const response = await fetch(
    `https://${domain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to exchange code for token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as { access_token: string; scope: string };

  return {
    access_token: data.access_token,
    scope: data.scope,
    obtained_at: new Date().toISOString()
  };
}

/**
 * Save token to disk
 */
function saveToken(domain: string, tokenData: TokenData): void {
  // Ensure token directory exists
  if (!fs.existsSync(TOKEN_DIR)) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  }

  // Load existing tokens or create new store
  let tokens: TokenStore = {};
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    } catch {
      // If file is corrupted, start fresh
      tokens = {};
    }
  }

  // Add/update token for this domain
  tokens[domain] = tokenData;

  // Write back with restricted permissions
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Token saved for ${domain}`);
}

/**
 * Load token from disk
 */
export function loadToken(domain: string): TokenData | null {
  if (!fs.existsSync(TOKEN_FILE)) {
    return null;
  }

  try {
    const tokens: TokenStore = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    return tokens[domain] || null;
  } catch {
    return null;
  }
}

/**
 * Run the full OAuth flow
 */
export async function runOAuthFlow(
  domain: string,
  clientId: string,
  clientSecret: string,
  scopes?: string
): Promise<TokenData> {
  const effectiveScopes = scopes || DEFAULT_SCOPES;
  const state = crypto.randomBytes(16).toString("hex");

  console.log("\n=== Shopify OAuth Authorization ===\n");
  console.log(`Store: ${domain}`);
  console.log(`Scopes: ${effectiveScopes}`);
  console.log("\nOpening browser for authorization...\n");

  // Build auth URL and open browser
  const authUrl = buildAuthorizationUrl(domain, clientId, effectiveScopes, state);

  // Start callback server before opening browser
  const callbackPromise = startCallbackServer(state);

  // Open browser
  await open(authUrl);
  console.log("If the browser didn't open, visit this URL:");
  console.log(authUrl);
  console.log("\nWaiting for authorization...\n");

  // Wait for callback
  const { code, shop } = await callbackPromise;
  console.log(`Authorization received from ${shop}`);

  // Exchange code for token
  console.log("Exchanging code for access token...");
  const tokenData = await exchangeCodeForToken(domain, clientId, clientSecret, code);

  // Save token
  saveToken(domain, tokenData);

  console.log("\n=== Authorization Complete ===");
  console.log(`Access token obtained with scopes: ${tokenData.scope}`);
  console.log("\nYou can now use the Shopify MCP. The token has been saved.");
  console.log("Run the MCP without --oauth to start using it.\n");

  return tokenData;
}
