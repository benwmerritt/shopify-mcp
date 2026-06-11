import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Variant update schema
// Note: weight/weightUnit are not supported on ProductVariantsBulkInput - must be set via inventory item
const VariantUpdateSchema = z.object({
  id: z.string().optional(),
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  options: z.array(z.string()).optional(),
});

// Image schema
const ImageSchema = z.object({
  src: z.string(),
  altText: z.string().optional(),
});

// Update product input schema
const UpdateProductInputSchema = z.object({
  // REQUIRED - product ID
  id: z.string().min(1),

  // Basic product fields (all optional)
  title: z.string().optional(),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  category: z.string().optional().describe("Shopify Standard Product Taxonomy GID. New format uses `vp-*` for Vehicles & Parts (e.g. 'gid://shopify/TaxonomyCategory/vp-2-2-3-2' = Non-Electric Motorcycles & Scooters). Use `search-taxonomy` to find IDs — don't guess. The tool VERIFIES the category stuck by comparing the returned product.category.id to what you sent; if they don't match it throws a clear error instead of silently returning null."),
  tags: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),

  // Simple variant fields (auto-updates first variant)
  // Note: weight must be set separately via inventory item update
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),

  // For updating specific variants
  variants: z.array(VariantUpdateSchema).optional(),

  // Images
  images: z.array(ImageSchema).optional(),
});

type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Verify that productSet actually applied the requested category — Shopify
// silently returns null when it doesn't recognise the GID (e.g. wrong taxonomy
// namespace), so we surface a loud error instead of leaking that silent failure.
// Exported for unit tests.
export function verifyCategorySet(
  returnedProduct: { category: { id: string } | null },
  requestedCategoryGid: string,
): void {
  const got = returnedProduct.category?.id ?? null;
  if (got === requestedCategoryGid) {
    return;
  }
  throw new Error(
    `Category did not stick. Sent "${requestedCategoryGid}", got back ${
      got ? `"${got}"` : "null"
    }. Verify the GID via search-taxonomy (the new Shopify Standard Product Taxonomy uses prefixes like vp-* for Vehicles & Parts; vp-2-2-3-2 = Non-Electric Motorcycles & Scooters).`,
  );
}

// Build a ProductVariantsBulkInput entry. ProductVariantsBulkInput has no
// top-level sku; SKU lives on the inventory item (InventoryItemInput.sku).
// Exported for unit tests.
export function buildVariantInput(
  id: string,
  fields: { price?: string; compareAtPrice?: string; sku?: string; barcode?: string },
): Record<string, unknown> {
  const v: Record<string, unknown> = { id };
  if (fields.price !== undefined) v.price = fields.price;
  if (fields.compareAtPrice !== undefined) v.compareAtPrice = fields.compareAtPrice;
  if (fields.barcode !== undefined) v.barcode = fields.barcode;
  if (fields.sku !== undefined) v.inventoryItem = { sku: fields.sku };
  return v;
}

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

// Helper to normalize variant ID to GID format
function normalizeVariantId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/ProductVariant/${id}`;
}

// Shared product selection so productSet and productVariantsBulkUpdate
// responses have the same shape.
const PRODUCT_SELECTION = `
  id
  title
  handle
  descriptionHtml
  vendor
  productType
  category {
    id
    name
    fullName
  }
  status
  tags
  variants(first: 100) {
    edges {
      node {
        id
        title
        price
        compareAtPrice
        sku
        barcode
      }
    }
  }
  images(first: 20) {
    edges {
      node {
        id
        url
        altText
      }
    }
  }
`;

type ProductPayload = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  category: { id: string; name: string; fullName: string } | null;
  status: string;
  tags: string[];
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        compareAtPrice: string | null;
        sku: string | null;
        barcode: string | null;
      };
    }>;
  };
  images: {
    edges: Array<{
      node: {
        id: string;
        url: string;
        altText: string | null;
      };
    }>;
  };
};

type UserError = { field: string[] | null; message: string };

// Format userErrors for error messages. field is nullable on the API side,
// and a field-less error should read "message", not ": message".
// Exported for unit tests.
export function formatUserErrors(errors: UserError[]): string {
  return errors
    .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
    .join(", ");
}

const updateProduct = {
  name: "update-product",
  description: "Update an existing product - can modify title, description, vendor, type, tags, status, price, SKU, and more",
  schema: UpdateProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateProductInput) => {
    try {
      const productId = normalizeProductId(input.id);

      // First, fetch the product to get current variant IDs if needed
      let firstVariantId: string | null = null;
      // !== undefined (not truthiness): an empty string is a valid value,
      // e.g. sku: "" clears the SKU.
      const hasSimpleVariantFields =
        input.price !== undefined ||
        input.sku !== undefined ||
        input.compareAtPrice !== undefined ||
        input.barcode !== undefined;

      if (hasSimpleVariantFields && !input.variants) {
        // Need to get the first variant ID
        const fetchQuery = gql`
          query getProduct($id: ID!) {
            product(id: $id) {
              variants(first: 1) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `;

        const fetchData = await shopifyClient.request(fetchQuery, { id: productId }) as {
          product: { variants: { edges: Array<{ node: { id: string } }> } } | null;
        };

        if (fetchData.product?.variants?.edges?.[0]) {
          firstVariantId = fetchData.product.variants.edges[0].node.id;
        }
      }

      // Product-level fields go through productSet; variant field updates go
      // through productVariantsBulkUpdate. productSet must NOT receive a
      // partial variants list: ProductSetInput.variants is a full sync (any
      // variant missing from the list is DELETED), and on current API
      // versions each entry also requires optionValues. The previous
      // implementation passed only the updated variants, which either errored
      // (missing optionValues) or destroyed the product's other variants.
      const productSetQuery = gql`
        mutation productSet($input: ProductSetInput!, $synchronous: Boolean) {
          productSet(input: $input, synchronous: $synchronous) {
            product {
              ${PRODUCT_SELECTION}
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const bulkVariantQuery = gql`
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product {
              ${PRODUCT_SELECTION}
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Build the product input
      const productInput: Record<string, unknown> = {
        id: productId,
      };

      // Add basic fields if provided
      if (input.title !== undefined) productInput.title = input.title;
      if (input.descriptionHtml !== undefined) productInput.descriptionHtml = input.descriptionHtml;
      if (input.vendor !== undefined) productInput.vendor = input.vendor;
      if (input.productType !== undefined) productInput.productType = input.productType;
      if (input.category !== undefined) productInput.category = input.category;
      if (input.tags !== undefined) productInput.tags = input.tags;
      if (input.status !== undefined) productInput.status = input.status;

      // Handle variants (applied via productVariantsBulkUpdate, not productSet)
      const variantsToUpdate: Array<Record<string, unknown>> = [];

      // If simple variant fields provided, update first variant
      if (hasSimpleVariantFields && firstVariantId) {
        variantsToUpdate.push(buildVariantInput(firstVariantId, input));
      }

      // Add explicitly provided variants
      if (input.variants) {
        for (const variant of input.variants) {
          if (!variant.id) {
            throw new Error("each entry in variants requires an id (productVariantsBulkUpdate updates existing variants in place)");
          }
          variantsToUpdate.push(buildVariantInput(normalizeVariantId(variant.id), variant));
        }
      }

      // Handle images via URL
      if (input.images && input.images.length > 0) {
        productInput.files = input.images.map(img => ({
          originalSource: img.src,
          alt: img.altText || undefined,
        }));
      }

      const hasProductLevelChanges = Object.keys(productInput).length > 1;
      let product: ProductPayload | null = null;

      if (hasProductLevelChanges) {
        const data = (await shopifyClient.request(productSetQuery, {
          input: productInput,
          synchronous: true,
        })) as {
          productSet: { product: ProductPayload | null; userErrors: UserError[] };
        };

        // Check for errors (the outer catch adds the "Failed to update product" prefix)
        if (data.productSet.userErrors.length > 0) {
          throw new Error(formatUserErrors(data.productSet.userErrors));
        }

        if (!data.productSet.product) {
          throw new Error("Product update returned no product - check if the ID is valid");
        }

        // Loud-fail if the caller asked to set the category and Shopify silently
        // ignored it (invalid taxonomy GID, wrong namespace, etc).
        if (input.category !== undefined) {
          verifyCategorySet(data.productSet.product, input.category);
        }

        product = data.productSet.product;
      }

      if (variantsToUpdate.length > 0) {
        const data = (await shopifyClient.request(bulkVariantQuery, {
          productId,
          variants: variantsToUpdate,
        })) as {
          productVariantsBulkUpdate: { product: ProductPayload | null; userErrors: UserError[] };
        };

        if (data.productVariantsBulkUpdate.userErrors.length > 0) {
          throw new Error(
            `variant updates: ${formatUserErrors(data.productVariantsBulkUpdate.userErrors)}`
          );
        }

        if (!data.productVariantsBulkUpdate.product && !product) {
          throw new Error("variant update returned no product - check the product ID");
        }
        product = data.productVariantsBulkUpdate.product || product;
      }

      if (!product) {
        throw new Error("No changes provided - pass at least one product or variant field to update");
      }

      // Format response
      return {
        product: {
          id: product.id,
          title: product.title,
          handle: product.handle,
          descriptionHtml: product.descriptionHtml,
          vendor: product.vendor,
          productType: product.productType,
          category: product.category,
          status: product.status,
          tags: product.tags,
          variants: product.variants.edges.map((e) => e.node),
          images: product.images.edges.map((e) => e.node),
        },
      };
    } catch (error) {
      console.error("Error updating product:", error);
      throw new Error(
        `Failed to update product: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
};

export { updateProduct };
