
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

By default this server runs as a local stdio MCP. Passing `--remote` (or setting
`REMOTE_MCP=true`) switches it to HTTP/SSE mode so it can be deployed as a remote
MCP server for Claude.ai or other remote clients. This repo ships a `Dockerfile`
and `railway.json` so Railway builds and starts it in remote mode out of the box.

**1. Get a token locally (one-time):**
```bash
npx shopify-mcp --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=yyy
# Token saved to ~/.shopify-mcp/tokens.json
```

**2. Deploy to Railway:**
- Create a project from this repo. Railway reads `railway.json` and builds the
  `Dockerfile`, which starts the server with `--remote`.
- Set the service environment variables (Railway injects `PORT` automatically):

```bash
SHOPIFY_ACCESS_TOKEN=shpat_xxx           # from tokens.json (or use the OAuth vars)
MYSHOPIFY_DOMAIN=your-store.myshopify.com
MCP_API_KEY=choose-a-long-random-string  # required to authenticate remote clients
# REMOTE_MCP=true is already implied by the Dockerfile's --remote flag
# PORT is injected by Railway (defaults to 3000 when run locally)
```

**3. Connect:**
- Health check: `GET /health`
- MCP endpoint (SSE): `GET /mcp?apiKey=<MCP_API_KEY>`
- Messages: `POST /messages?apiKey=<MCP_API_KEY>`

Auth uses the `apiKey` **query parameter**; requests without a matching
`MCP_API_KEY` receive `401`.

**Test the container locally before deploying:**
```bash
docker build -t shopify-mcp .
docker run -p 3000:3000 \
  -e MYSHOPIFY_DOMAIN=your-store.myshopify.com \
  -e SHOPIFY_ACCESS_TOKEN=shpat_xxx \
  -e MCP_API_KEY=test \
  shopify-mcp
# then in another shell: curl localhost:3000/health
```

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
- `products` — unified lookup/search/filter. Pass `id` for a single product; omit `id` to list/search with filters (`title`, `status`, `vendor`, `tag`, inventory, dates, `hasImages`, …). Returns the product's Shopify Standard Product Taxonomy `category` (`{id, name, fullName}`) in `slim`/`standard`/`full`. Page size capped at 100.
- `create-product`
- `update-product` — accepts `category` (Shopify Standard Product Taxonomy GID, `vp-*` prefix); the tool verifies the category actually stuck and throws a loud, actionable error if Shopify silently rejected the GID, instead of leaving you with a null `category`.
- `delete-product`
- `delete-variant`
- `delete-product-images`
- `bulk-update-products`
- `bulk-delete-products`
- `count-products-by-tag`
- `find-products-by-metafield` — list products that have / don't have / both for a given `namespace.key`, paginated across the whole catalog via cursor
- `search-taxonomy` — browse Shopify's product category taxonomy; set `includeAttributes:true` to also return each category's attributes (e.g. Color, Pattern) and their allowed values

### Collections
- `get-collections`
- `manage-collection-products`
- `create-collection`
- `update-collection`
- `delete-collection`

### Customers
- `get-customers` (supports pagination via `cursor`)
- `update-customer`

### Orders
- `orders` — unified lookup/list. Pass `id` for a single order; omit `id` to list with filters (`customerId`, `status`, pagination via `cursor`). Replaces `get-orders`, `get-order-by-id`, and `get-customer-orders`.
- `update-order`

### Draft Orders
- `draft-orders` — unified lookup/list. Pass `id` for a single draft order; omit `id` to list with filters (`status`, `query`, pagination via `cursor`).
- `create-draft-order`
- `update-draft-order`
- `complete-draft-order`

### Inventory
- `get-inventory-levels`
- `update-inventory`

### Locations
- `get-locations`

### Metafields
- `get-metafields` — server-side filter with `key`+`namespace` (single field) or `keys: ["namespace.key", …]` (multi) via Shopify's native `metafields(keys:)`; set `includeDefinitions:true` to merge ALL definitions with current values so empty/unfilled fields show up (`value:null`, `isSet:false`)
- `set-metafield` (create or update; supports `metaobject_reference` / `list.metaobject_reference`)
- `bulk-set-variant-metafields` — set metafields across many variants of one product in a single `productVariantsBulkUpdate` call (up to 250 variants/call). UNIFORM mode (`metafields`) fans one value out to every variant and auto-discovers the variant IDs; PER-VARIANT mode (`variants`) sets different values per variant. Avoids one `set-metafield` call per variant.
- `delete-metafield`
- `list-metafield-definitions` — discover metafield definitions for an owner type (PRODUCT, ORDER, CUSTOMER, …); each entry now includes `constraints` (e.g. `{key:"category", values:["vp-2","vp-2-2-3", …]}`) so agents can see category-gating *before* writing (e.g. `vehicle_*` requires `vp-2*` Vehicle categories; values on disallowed categories are silently filtered out by Shopify on read).
- `get-metafield-options` — resolve a metafield's selectable options in one call (for metaobject-reference fields, returns the available metaobject entries; for choice-lists, the allowed choices)

### Metaobjects
- `list-metaobject-definitions`
- `get-metaobject-definition`
- `create-metaobject` — optional `status` (`ACTIVE`/`DRAFT`); defaults to Shopify's `DRAFT` for publishable definitions, pass `ACTIVE` to publish on create
- `update-metaobject` — edit fields on an existing entry (only provided keys change); optional `status` to publish (`ACTIVE`) or unpublish (`DRAFT`)
- `delete-metaobject`
- `list-metaobjects` — returns `status` per entry; optional `status` filter (applied client-side to the fetched page)
- `get-metaobject` — returns the entry's publish `status`

### Files
- `get-files` — list/search files in the store
- `attach-file-to-product` — attach an existing media file to a product
- `detach-file-from-product` — remove a media file from a product
- `create-file-upload-session` — start a browser upload session (**remote mode only**)
- `get-file-upload-session` — check an upload session (**remote mode only**)

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

### Server
- `get-status` - Report MCP server status, configured store, and connection health

## Debugging

Tail Claude Desktop logs:

```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

## License

MIT
