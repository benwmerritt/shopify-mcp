
```
███████╗██╗  ██╗ ██████╗ ██████╗ ██╗███████╗██╗   ██╗    ███╗   ███╗ ██████╗██████╗ 
██╔════╝██║  ██║██╔═══██╗██╔══██╗██║██╔════╝╚██╗ ██╔╝    ████╗ ████║██╔════╝██╔══██╗
███████╗███████║██║   ██║██████╔╝██║█████╗   ╚████╔╝     ██╔████╔██║██║     ██████╔╝
╚════██║██╔══██║██║   ██║██╔═══╝ ██║██╔══╝    ╚██╔╝      ██║╚██╔╝██║██║     ██╔═══╝ 
███████║██║  ██║╚██████╔╝██║     ██║██║        ██║       ██║ ╚═╝ ██║╚██████╗██║     
╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝        ╚═╝       ╚═╝     ╚═╝ ╚═════╝╚═╝     
```

# Shopify MCP

A Model Context Protocol (MCP) server that connects agents to the Shopify Admin GraphQL API. Use it to browse, edit, and clean up store data via a curated set of tools.

**npm:** `shopify-mcp`  
**binary:** `shopify-mcp`

## Highlights

- CRUD for products, collections, orders, and customers
- Draft orders for quotes, manual orders, and B2B pricing
- Inventory and location lookups for stock workflows
- Metafields for custom data
- Metaobject entry creation and lookup for existing definitions
- URL redirects management
- OAuth login flow with local token caching
- Bulk product cleanup utilities

## Prerequisites

- Node.js 18+
- A Shopify custom app (OAuth or Admin API token)

## Local setup (this repo)

Use this when you want to run the MCP server from this local checkout instead of a remote deployment.

1. Install dependencies and build:

```bash
npm install
npm run build
```

2. Create local env config:

```bash
cp .env.example .env
```

Set at least:
- `MYSHOPIFY_DOMAIN=your-store.myshopify.com`
- `SHOPIFY_ACCESS_TOKEN=shpat_xxx`
- `REMOTE_MCP=false`

3. Start local MCP (stdio):

```bash
npm run start:local
```

`start:local` uses stdio mode. Remote mode is only enabled with `--remote` or `REMOTE_MCP=true`.

## Install + run

### OAuth flow (recommended)

1. Create a custom app and copy **Client ID** and **Client Secret**.
2. In **App setup**, set **App URL** and **Allowed redirection URLs** to:
   `http://localhost:3456/callback`
3. Start the OAuth flow:

```bash
npx shopify-mcp --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=yyy
```

Tokens are stored at `~/.shopify-mcp/tokens.json`. After that, start the server with just the domain:

```bash
npx shopify-mcp --domain=your-store.myshopify.com
```

Optional: override scopes with `--scopes` or `SHOPIFY_SCOPES`.

### Access token (manual)

1. Create a custom app in Shopify
2. Enable Admin API scopes:
   - `read_products`, `write_products`
   - `read_customers`, `write_customers`
   - `read_orders`, `write_orders`
   - `read_draft_orders`, `write_draft_orders`
   - `read_inventory`, `write_inventory`
   - `read_locations`
   - `read_content`, `write_content`
   - `read_files`, `write_files`
3. Install the app and copy the Admin API access token

Run:

```bash
shopify-mcp --accessToken=<YOUR_ACCESS_TOKEN> --domain=<YOUR_SHOP>.myshopify.com
```

## MCP client setup

### Claude Desktop (local repo build)

Build first (`npm run build`), then point Claude Desktop at this repo's built entrypoint:

```json
{
  "mcpServers": {
    "shopify-local": {
      "command": "node",
      "args": [
        "/absolute/path/to/shopify-mcp/dist/index.js",
        "--domain",
        "your-store.myshopify.com"
      ],
      "env": {
        "SHOPIFY_ACCESS_TOKEN": "shpat_xxx",
        "REMOTE_MCP": "false"
      }
    }
  }
}
```

If you completed OAuth locally, remove `SHOPIFY_ACCESS_TOKEN` and keep `--domain`.

### Claude Desktop (npm package)

```json
{
  "mcpServers": {
    "shopify": {
      "command": "npx",
      "args": [
        "shopify-mcp",
        "--accessToken",
        "<YOUR_ACCESS_TOKEN>",
        "--domain",
        "<YOUR_SHOP>.myshopify.com"
      ]
    }
  }
}
```

If you completed OAuth, omit `--accessToken` and keep `--domain`.

Config paths:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

### Remote MCP (Railway, etc.)

Deploy as a remote MCP server for use with Claude.ai or other remote clients.

**1. Get token locally (one-time):**
```bash
npx shopify-mcp --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=yyy
# Token saved to ~/.shopify-mcp/tokens.json
```

**2. Set environment variables on your hosting platform:**
```bash
REMOTE_MCP=true
SHOPIFY_ACCESS_TOKEN=shpat_xxx   # From tokens.json
MYSHOPIFY_DOMAIN=your-store.myshopify.com
PORT=3000                         # Optional, defaults to 3000
```

**3. Deploy and connect:**
- Health check: `GET /health`
- MCP endpoint: `GET /mcp?apiKey=xxx`
- Messages: `POST /messages?apiKey=xxx`

### Environment variables (optional)

```bash
SHOPIFY_ACCESS_TOKEN=your_access_token
MYSHOPIFY_DOMAIN=your-store.myshopify.com
# Optional OAuth values:
# SHOPIFY_CLIENT_ID=your_client_id
# SHOPIFY_CLIENT_SECRET=your_client_secret
# SHOPIFY_SCOPES=comma,separated,scopes
```

## Tool catalog

### Products
- `get-products` (supports `fields`: `slim | standard | full | []`)
- `get-product-by-id`
- `create-product`
- `update-product`
- `delete-product`
- `delete-variant`
- `delete-product-images`
- `search-products` (supports `fields`)
- `bulk-update-products`
- `bulk-delete-products`

### Collections
- `get-collections`
- `manage-collection-products`
- `create-collection`
- `update-collection`
- `delete-collection`

### Customers
- `get-customers` (supports pagination via `cursor`)
- `update-customer`
- `get-customer-orders` (supports pagination via `cursor`)

### Orders
- `get-orders` (supports pagination via `cursor`)
- `get-order-by-id`
- `update-order`

### Draft Orders
- `get-draft-orders` (supports pagination via `cursor`)
- `get-draft-order-by-id`
- `create-draft-order`
- `update-draft-order`
- `complete-draft-order`

### Inventory
- `get-inventory-levels`
- `update-inventory`

### Locations
- `get-locations`

### Metafields
- `get-metafields`
- `set-metafield` (create or update)
- `delete-metafield`

### Metaobjects
- `list-metaobject-definitions`
- `get-metaobject-definition`
- `create-metaobject`
- `list-metaobjects`
- `get-metaobject`

### URL redirects
- `get-redirects`
- `create-redirect`
- `delete-redirect`

### Analytics
- `get-store-counts` - Get all key counts in one call (products, variants, orders, customers, collections)
- `get-product-issues` - Audit products for problems (zero inventory, low stock, missing images, zero price)

### Bulk Operations
- `start-bulk-export` - Start async bulk export (products, orders, customers, inventory, or custom query)
- `get-bulk-operation-status` - Check progress of bulk operation
- `get-bulk-operation-results` - Download and parse completed results (summary, sample, or full)

## Debugging

Tail Claude Desktop logs:

```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

## License

MIT
