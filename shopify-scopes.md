# Shopify Admin API Scopes

## Required for MCP Tools (40 tools)

Copy this comma-separated list:

```
read_customers,write_customers,read_price_rules,write_discounts,write_draft_orders,read_draft_orders,read_files,write_files,read_fulfillments,write_fulfillments,write_inventory,read_inventory,write_locations,read_locations,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_online_store_pages,write_online_store_pages,read_orders,write_orders,read_product_listings,write_product_listings,read_products,write_products,read_publications,write_publications,write_reports,read_reports,read_shipping,write_shipping,read_content,write_content,read_themes,write_themes,customer_read_companies,customer_write_companies,customer_write_customers,customer_read_customers,customer_read_orders,customer_write_orders,customer_read_quick_sale,unauthenticated_write_bulk_operations,unauthenticated_read_bulk_operations,unauthenticated_read_bundles,unauthenticated_write_customers,unauthenticated_read_customers,unauthenticated_read_customer_tags,unauthenticated_read_metaobjects,unauthenticated_read_product_inventory,unauthenticated_read_product_listings,unauthenticated_read_product_tags,unauthenticated_read_content
```

## Tool → Scope Mapping

| Tools | Scopes Required |
|-------|-----------------|
| get-products, get-product-by-id, search-products, get-product-issues, get-collections | read_products |
| create-product, update-product, delete-product, delete-variant, delete-product-images, bulk-update-products, bulk-delete-products, create-collection, update-collection, delete-collection, manage-collection-products | write_products |
| get-orders, get-order-by-id, get-customer-orders | read_orders |
| update-order | write_orders |
| get-draft-orders, get-draft-order-by-id | read_draft_orders |
| create-draft-order, update-draft-order, complete-draft-order | write_draft_orders |
| get-customers | read_customers |
| update-customer | write_customers |
| get-inventory-levels | read_inventory |
| update-inventory | write_inventory |
| get-locations | read_locations |
| get-metafields | read_metaobjects |
| set-metafield, delete-metafield | write_metaobjects |
| get-redirects | read_online_store_navigation |
| create-redirect, delete-redirect | write_online_store_navigation |
| start-bulk-export, get-bulk-operation-status, get-bulk-operation-results | read_products (+ others depending on export type) |
| get-store-counts | read_products, read_orders, read_customers |

## Extended List (with extras for future-proofing)

```
read_products,write_products,read_product_listings,read_inventory,write_inventory,read_locations,read_orders,write_orders,read_draft_orders,write_draft_orders,read_fulfillments,write_fulfillments,read_shipping,write_shipping,read_customers,write_customers,read_content,write_content,read_files,write_files,read_metaobjects,write_metaobjects,read_price_rules,write_discounts,read_publications,write_publications,read_online_store_pages,write_online_store_pages,read_online_store_navigation,write_online_store_navigation,read_themes,read_reports,write_reports
```
