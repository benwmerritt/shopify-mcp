# Shopify MCP Server

MCP server for Shopify's Admin GraphQL API. Built to let agents read and manage store data through a clean set of tools.

**Package:** `shopify-mcp`  
**Command:** `shopify-mcp`

## What this server does

- Products: search, create, update, delete, and tidy variants/images
- Collections: create/update/delete and manage products in collections
- Orders: list, fetch, and update
- Customers: list, update, and fetch order history
- Inventory: query levels and adjust quantities
- Locations: list store locations for inventory operations
- Metafields: read, create, update, and delete custom data
- URL redirects: manage URL redirects
- OAuth flow: authorize once, store tokens locally, and reuse

## Requirements

- Node.js 18+
- A Shopify custom app (token or OAuth credentials)

## Setup

### Option A: OAuth (recommended)

1. Create a custom app and copy **Client ID** + **Client Secret**
2. In **App setup**, set **App URL** and **Allowed redirection URLs** to:
   `http://localhost:3456/callback`
3. Run the OAuth flow:

```
npx shopify-mcp --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=yyy
```

Your browser will open for authorization. Tokens are saved to:
`~/.shopify-mcp/tokens.json`

Then you can run the server without an access token:

```
npx shopify-mcp --domain=your-store.myshopify.com
```

Optional: override scopes with `--scopes` or `SHOPIFY_SCOPES`.

### Option B: Access token (manual)

1. Create a custom app in Shopify
2. Configure Admin API scopes:
   - `read_products`, `write_products`
   - `read_customers`, `write_customers`
   - `read_orders`, `write_orders`
   - `read_inventory`, `write_inventory`
   - `read_locations`
   - `read_content`, `write_content`
   - `read_files`, `write_files`
3. Install the app and copy the Admin API access token

Run with the token:

```
shopify-mcp --accessToken=<YOUR_ACCESS_TOKEN> --domain=<YOUR_SHOP>.myshopify.com
```

## Usage

### Claude Desktop config

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

If you ran the OAuth flow and saved a token, you can omit `--accessToken` and just provide `--domain`.

Config paths:
- MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

### .env (optional)

```
SHOPIFY_ACCESS_TOKEN=your_access_token
MYSHOPIFY_DOMAIN=your-store.myshopify.com
# Optional OAuth values:
# SHOPIFY_CLIENT_ID=your_client_id
# SHOPIFY_CLIENT_SECRET=your_client_secret
# SHOPIFY_SCOPES=comma,separated,scopes
```

## Tool catalog (30 total)

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

### Inventory
- `get-inventory-levels`
- `update-inventory`

### Locations
- `get-locations`

### Metafields
- `get-metafields`
- `set-metafield` (create or update)
- `delete-metafield`

### URL redirects
- `get-redirects`
- `create-redirect`
- `delete-redirect`

## Debugging

Tail Claude Desktop logs:

```
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

## License

MIT
