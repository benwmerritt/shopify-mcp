# Shopify MCP Server

(please leave a star if you like!)

MCP Server for Shopify API, enabling interaction with store data through GraphQL API. This server provides tools for managing products, customers, orders, and more.

**📦 Package Name: `shopify-mcp`**  
**🚀 Command: `shopify-mcp` (NOT `shopify-mcp-server`)**

<a href="https://glama.ai/mcp/servers/@GeLi2001/shopify-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@GeLi2001/shopify-mcp/badge" alt="Shopify MCP server" />
</a>

## Features

- **Product Management**: Search, create, update, and delete products and variants
- **Collection Management**: Create, update, delete, and manage collection products
- **Customer Management**: Load customer data and manage customer tags
- **Order Management**: Advanced order querying and updates
- **Inventory Management**: Query inventory levels and adjust quantities
- **Metafields & Redirects**: Manage metafields and URL redirects
- **GraphQL Integration**: Direct integration with Shopify's GraphQL Admin API
- **Comprehensive Error Handling**: Clear error messages for API and authentication issues
- **OAuth Support**: Run an OAuth flow to get and save access tokens

## Prerequisites

1. Node.js (version 18 or higher)
2. Shopify custom app credentials or access token (see setup instructions below)

## Setup

### Shopify Access Token (Manual)

To use this MCP server, you'll need to create a custom app in your Shopify store:

1. From your Shopify admin, go to **Settings** > **Apps and sales channels**
2. Click **Develop apps** (you may need to enable developer preview first)
3. Click **Create an app**
4. Set a name for your app (e.g., "Shopify MCP Server")
5. Click **Configure Admin API scopes**
6. Select the following scopes:
   - `read_products`, `write_products` (products, variants, collections)
   - `read_customers`, `write_customers`
   - `read_orders`, `write_orders`
   - `read_inventory`, `write_inventory`
   - `read_locations`
   - `read_content`, `write_content` (redirects)
   - `read_files`, `write_files` (product images by URL)
7. Click **Save**
8. Click **Install app**
9. Click **Install** to give the app access to your store data
10. After installation, you'll see your **Admin API access token**
11. Copy this token - you'll need it for configuration

### OAuth Flow (Recommended)

If you prefer to authorize via OAuth and store tokens locally:

1. Create a custom app and note its **Client ID** and **Client Secret**
2. In **App setup**, set **App URL** and **Allowed redirection URLs** to `http://localhost:3456/callback`
3. Run the OAuth flow:
   ```
   npx shopify-mcp --oauth --domain=your-store.myshopify.com --clientId=xxx --clientSecret=yyy
   ```
4. Your browser will open to authorize the app (callback at `http://localhost:3456/callback`). The token is saved to:
   `~/.shopify-mcp/tokens.json`
5. After that, you can start the server without passing an access token:
   ```
   npx shopify-mcp --domain=your-store.myshopify.com
   ```

Optional: override default scopes with `--scopes` or `SHOPIFY_SCOPES`.

### Usage with Claude Desktop

Add this to your `claude_desktop_config.json`:

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

Locations for the Claude Desktop config file:

- MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

If you ran the OAuth flow and saved a token, you can omit `--accessToken` and just provide `--domain`.

### Alternative: Run Locally with Environment Variables

If you prefer to use environment variables instead of command-line arguments:

1. Create a `.env` file with your Shopify credentials:

   ```
   SHOPIFY_ACCESS_TOKEN=your_access_token
   MYSHOPIFY_DOMAIN=your-store.myshopify.com
   # Optional OAuth values:
   # SHOPIFY_CLIENT_ID=your_client_id
   # SHOPIFY_CLIENT_SECRET=your_client_secret
   # SHOPIFY_SCOPES=comma,separated,scopes
   ```

2. Run the server with npx:
   ```
   npx shopify-mcp
   ```

### Direct Installation (Optional)

If you want to install the package globally:

```
npm install -g shopify-mcp
```

Then run it:

```
shopify-mcp --accessToken=<YOUR_ACCESS_TOKEN> --domain=<YOUR_SHOP>.myshopify.com
```

**⚠️ Important:** If you see errors about "SHOPIFY_ACCESS_TOKEN environment variable is required" when using command-line arguments, you might have a different package installed. Make sure you're using `shopify-mcp`, not `shopify-mcp-server`.

## Available Tools

### Product Management

1. `get-products`
   - Get all products or search by title
   - Inputs:
     - `searchTitle` (optional string): Filter products by title
     - `limit` (number): Maximum number of products to return
     - `fields` (string | string[]): `"slim" | "standard" | "full"` or list of field names

2. `get-product-by-id`
   - Get a specific product by ID
   - Inputs:
     - `productId` (string): ID of the product to retrieve

3. `create-product`
   - Create new product in store 
   - Inputs:
     - `title` (string): Title of the product
     - `descriptionHtml` (string): Description of the product
     - `vendor` (string): Vendor of the product
     - `productType` (string): Type of the product
     - `tags` (array): Tags of the product
     - `status` (string): Status of the product "ACTIVE", "DRAFT", "ARCHIVED". Default "DRAFT"
     - `price`, `compareAtPrice`, `sku`, `barcode` (optional)
     - `options` (array): Option names (e.g., ["Size", "Color"])
     - `variants` (array): Variant objects with `price`, `compareAtPrice`, `sku`, `barcode`, `options`
     - `images` (array): `{ src, altText }` image URLs

4. `update-product`
   - Update an existing product
   - Inputs:
     - `id` (string, required): Product ID
     - All fields from create-product (optional)
     - `variants` supports updating specific variants by `id`

5. `delete-product`
   - Delete a product (irreversible)
   - Inputs:
     - `productId` (string): Product ID to delete

6. `delete-variant`
   - Delete a specific variant from a product
   - Inputs:
     - `variantId` (string): Variant ID to delete

7. `delete-product-images`
   - Delete images from a product
   - Inputs:
     - `productId` (string): Product ID
     - `imageIds` (array): Array of image/media IDs to delete

8. `search-products` (Advanced)
   - Advanced product search with multiple filters
   - Inputs:
     - `title` (optional): Filter by title
     - `status` (optional): ACTIVE, DRAFT, or ARCHIVED
     - `vendor` (optional): Filter by vendor
     - `tag` / `tagNot` (optional): Include/exclude by tag
     - `productType` (optional): Filter by product type
     - `inventoryTotal`, `inventoryLessThan`, `inventoryGreaterThan` (optional): Inventory filters
     - `createdAfter`, `createdBefore`, `updatedAfter` (optional): Date filters (ISO 8601)
     - `hasImages` (optional boolean): Filter by image presence
     - `limit`, `cursor`: Pagination
     - `fields` (string | string[]): `"slim" | "standard" | "full"` or list of field names

### Bulk Operations

1. `bulk-update-products`
   - Update multiple products at once (max 100)
   - Inputs:
     - `productIds` (array): Array of product IDs
     - `update` (object): Fields to update on all products
       - `status`, `vendor`, `productType`, `tags`, `addTags`, `removeTags`

2. `bulk-delete-products`
   - Delete multiple products at once (max 100, irreversible)
   - Inputs:
     - `productIds` (array): Array of product IDs to delete

### Collection Management

1. `get-collections`
   - List collections with optional filtering
   - Inputs:
     - `title` (optional): Filter by collection title
     - `type` (optional): "smart", "custom", or "all"
     - `limit`, `cursor`: Pagination

2. `manage-collection-products`
   - Add, remove, or list products in a collection
   - Inputs:
     - `collectionId` (string): Collection ID
     - `action` (string): "add", "remove", or "list"
     - `productIds` (array, optional): Product IDs (required for add/remove)

3. `create-collection`
   - Create a custom or smart collection
   - Inputs:
     - `title` (string): Collection title
     - `descriptionHtml` (optional): HTML description
     - `handle` (optional): URL handle
     - `image` (optional): `{ src, altText }`
     - `productIds` (optional): Product IDs to add (custom collections)
     - `rules` (optional): Smart-collection rules with `column`, `relation`, `condition`
     - `rulesApplyDisjunctively` (optional boolean): OR vs AND logic
     - `sortOrder` (optional): MANUAL, BEST_SELLING, ALPHA_ASC, ALPHA_DESC, CREATED_DESC, CREATED, PRICE_DESC, PRICE_ASC

4. `update-collection`
   - Update an existing collection
   - Inputs:
     - `id` (string): Collection ID
     - `title`, `descriptionHtml`, `handle`, `image`, `rules`, `rulesApplyDisjunctively`, `sortOrder` (optional)

5. `delete-collection`
   - Delete a collection by ID (does not delete products)
   - Inputs:
     - `collectionId` (string): Collection ID

### Customer Management

1. `get-customers`
   - Get customers or search by name/email
   - Inputs:
     - `searchQuery` (optional string): Filter customers by name or email
     - `limit` (optional number, default: 10): Maximum number of customers to return

2. `update-customer`
   - Update a customer's information
   - Inputs:
     - `id` (string, required): Shopify customer ID (numeric only)
     - `firstName`, `lastName`, `email`, `phone` (optional)
     - `tags` (array, optional): Tags for the customer
     - `note` (string, optional): Note about the customer
     - `taxExempt` (boolean, optional)
     - `metafields` (array, optional): Customer metafields

3. `get-customer-orders`
   - Get orders for a specific customer
   - Inputs:
     - `customerId` (string, required): Shopify customer ID (numeric only)
     - `limit` (optional number, default: 10)

### Order Management

1. `get-orders`
   - Get orders with optional filtering
   - Inputs:
     - `status` (optional): "any", "open", "closed", "cancelled"
     - `limit` (optional number, default: 10)

2. `get-order-by-id`
   - Get a specific order by ID
   - Inputs:
     - `orderId` (string, required): Full Shopify order ID

3. `update-order`
   - Update an existing order
   - Inputs:
     - `id` (string, required): Shopify order ID
     - `tags`, `email`, `note`, `customAttributes`, `metafields`, `shippingAddress` (optional)

### Inventory Management

1. `get-inventory-levels`
   - Get inventory levels across locations
   - Inputs:
     - `productId` (optional): Get inventory for a specific product
     - `locationId` (optional): Filter by location
     - `limit`, `cursor`: Pagination

2. `update-inventory`
   - Adjust or set inventory quantity
   - Inputs:
     - `inventoryItemId` (string): Inventory item ID
     - `locationId` (string): Location ID
     - `delta` (number, optional): Adjust by this amount
     - `setQuantity` (number, optional): Set to exact quantity
     - `reason` (string): Reason for change (e.g., correction, damaged, received, restock, shrinkage, etc.)

### Metafield Management

1. `get-metafields`
   - Get metafields for any resource type
   - Inputs:
     - `ownerType` (string): PRODUCT, PRODUCTVARIANT, CUSTOMER, ORDER, COLLECTION, or SHOP
     - `ownerId` (string, optional): Resource ID (required except for SHOP)
     - `namespace` (optional): Filter by namespace
     - `limit`: Maximum results

2. `delete-metafield`
   - Delete a specific metafield
   - Inputs:
     - `metafieldId` (string): Metafield ID to delete

### URL Redirects

1. `get-redirects`
   - List URL redirects
   - Inputs:
     - `path` (optional): Filter by source path
     - `limit`, `cursor`: Pagination

2. `create-redirect`
   - Create a URL redirect (useful when deleting products)
   - Inputs:
     - `path` (string): Source path (e.g., /products/old-product)
     - `target` (string): Target URL

3. `delete-redirect`
   - Delete a URL redirect
   - Inputs:
     - `redirectId` (string): Redirect ID to delete

## Debugging

If you encounter issues, check Claude Desktop's MCP logs:

```
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

## License

MIT
