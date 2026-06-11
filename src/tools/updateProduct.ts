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
  // Unit cost ("cost per item", shop currency) - lives on the inventory item
  cost: z.string().optional(),
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

  // Rename a product option in place (e.g. "Voltage" -> "Model").
  // Existing variants and their IDs are preserved.
  renameOption: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }).optional(),

  // Create additional variants on the product's existing option structure.
  // options = option VALUES in the order of the product's option names;
  // provide one value per option (Shopify rejects incomplete combinations).
  newVariants: z.array(z.object({
    price: z.string(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    compareAtPrice: z.string().optional(),
    cost: z.string().optional(),
    options: z.array(z.string()).min(1),
  })).optional(),

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
// top-level sku or cost; both live on the inventory item
// (InventoryItemInput.sku / InventoryItemInput.cost).
// Exported for unit tests.
export function buildVariantInput(
  id: string,
  fields: { price?: string; compareAtPrice?: string; sku?: string; barcode?: string; cost?: string },
): Record<string, unknown> {
  const v: Record<string, unknown> = { id };
  if (fields.price !== undefined) v.price = fields.price;
  if (fields.compareAtPrice !== undefined) v.compareAtPrice = fields.compareAtPrice;
  if (fields.barcode !== undefined) v.barcode = fields.barcode;
  if (fields.sku !== undefined || fields.cost !== undefined) {
    v.inventoryItem = {
      ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
      ...(fields.cost !== undefined ? { cost: fields.cost } : {}),
    };
  }
  return v;
}

// Map positional option values to optionValues entries using the product's
// option order (e.g. ["1.75mm", "24V"] on a product with options
// [Size, Voltage] -> [{optionName: "Size", name: "1.75mm"}, ...]).
// Exported for unit tests.
export function toOptionValues(
  optionInfo: Array<{ id: string; name: string }>,
  values: string[],
): Array<{ optionName: string; name: string }> {
  return values.map((name, i) => {
    if (!optionInfo[i]) {
      throw new Error(`Option value "${name}" has no matching product option at position ${i + 1}`);
    }
    return { optionName: optionInfo[i].name, name };
  });
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
// responses have the same shape. inventoryItem.unitCost requires the
// read_inventory scope, so it is only selected when the caller actually
// wrote cost - cost-less updates must keep working on tokens that only
// have product scopes.
const productSelection = (includeCost: boolean) => `
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
        barcode${includeCost ? `
        inventoryItem {
          unitCost {
            amount
          }
        }` : ""}
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
        inventoryItem?: { unitCost: { amount: string } | null } | null;
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

      // Only select (and return) cost when the caller wrote one - see
      // productSelection() for the scope rationale.
      const wantsCost =
        (input.variants || []).some((v) => v.cost !== undefined) ||
        (input.newVariants || []).some((v) => v.cost !== undefined);

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
              ${productSelection(wantsCost)}
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
              ${productSelection(wantsCost)}
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

      // Option names are needed whenever option values are written
      const needsOptionNames = Boolean(
        input.renameOption ||
        (input.newVariants && input.newVariants.length > 0) ||
        (input.variants || []).some((v) => v.options && v.options.length > 0)
      );
      let optionInfo: Array<{ id: string; name: string }> = [];
      if (needsOptionNames) {
        const optData = (await shopifyClient.request(
          gql`query productOptions($id: ID!) { product(id: $id) { options { id name } } }`,
          { id: productId }
        )) as { product: { options: Array<{ id: string; name: string }> } | null };
        if (!optData.product) {
          throw new Error("Product not found - check the ID");
        }
        optionInfo = optData.product.options;
      }

      // Rename a product option in place (before any option-value writes)
      if (input.renameOption) {
        const opt = optionInfo.find((o) => o.name === input.renameOption!.from);
        if (!opt) {
          throw new Error(`Option "${input.renameOption.from}" not found on product (has: ${optionInfo.map((o) => o.name).join(", ")})`);
        }
        const renameData = (await shopifyClient.request(
          gql`
            mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!) {
              productOptionUpdate(productId: $productId, option: $option) {
                product { options { id name } }
                userErrors { field message }
              }
            }
          `,
          { productId, option: { id: opt.id, name: input.renameOption.to } }
        )) as {
          productOptionUpdate: {
            product: { options: Array<{ id: string; name: string }> } | null;
            userErrors: UserError[];
          };
        };
        if (renameData.productOptionUpdate.userErrors.length > 0) {
          throw new Error(
            `option rename: ${formatUserErrors(renameData.productOptionUpdate.userErrors)}`
          );
        }
        // Verify the rename actually applied (don't trust empty userErrors)
        const renamed = renameData.productOptionUpdate.product?.options.find((o) => o.id === opt.id);
        if (!renamed || renamed.name !== input.renameOption.to) {
          throw new Error(
            `Option rename did not apply: option ${opt.id} is "${renamed ? renamed.name : "missing"}" (expected "${input.renameOption.to}")`
          );
        }
        opt.name = input.renameOption.to;
      }

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
            throw new Error("each entry in variants requires an id (productVariantsBulkUpdate updates existing variants in place; use newVariants to create variants)");
          }
          const v = buildVariantInput(normalizeVariantId(variant.id), variant);
          if (variant.options && variant.options.length > 0) {
            v.optionValues = toOptionValues(optionInfo, variant.options);
          }
          variantsToUpdate.push(v);
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

      // Create additional variants on the existing option structure
      if (input.newVariants && input.newVariants.length > 0) {
        // Creation needs a complete option-value set per variant (unlike
        // updates, where partial values are valid) - fail clearly before the
        // API round-trip rather than with Shopify's generic rejection.
        for (const v of input.newVariants) {
          if (v.options.length !== optionInfo.length) {
            throw new Error(
              `each newVariants entry needs one option value per product option - product has ${optionInfo.length} (${optionInfo.map((o) => o.name).join(", ")}), got ${v.options.length}`
            );
          }
        }
        const createData = (await shopifyClient.request(
          gql`
            mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkCreate(productId: $productId, variants: $variants) {
                # lean payload - full state (incl. cost when written) comes from
                # the refetch below, which always runs after creation
                productVariants { id title sku price }
                userErrors { field message }
              }
            }
          `,
          {
            productId,
            variants: input.newVariants.map((v) => ({
              price: v.price,
              ...(v.barcode !== undefined ? { barcode: v.barcode } : {}),
              ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice } : {}),
              ...(v.sku !== undefined || v.cost !== undefined
                ? {
                    inventoryItem: {
                      ...(v.sku !== undefined ? { sku: v.sku } : {}),
                      ...(v.cost !== undefined ? { cost: v.cost } : {}),
                    },
                  }
                : {}),
              optionValues: toOptionValues(optionInfo, v.options),
            })),
          }
        )) as {
          productVariantsBulkCreate: {
            productVariants: Array<{ id: string; title: string; sku: string | null; price: string }>;
            userErrors: UserError[];
          };
        };
        if (createData.productVariantsBulkCreate.userErrors.length > 0) {
          throw new Error(
            `variant create: ${formatUserErrors(createData.productVariantsBulkCreate.userErrors)}`
          );
        }
      }

      // Refetch when variants were created (earlier mutation payloads don't
      // include them) or when only a rename ran (no payload at all yet).
      const createdVariants = Boolean(input.newVariants && input.newVariants.length > 0);
      if (createdVariants || (!product && input.renameOption)) {
        const refetch = (await shopifyClient.request(
          gql`
            query productAfterUpdate($id: ID!) {
              product(id: $id) {
                ${productSelection(wantsCost)}
              }
            }
          `,
          { id: productId }
        )) as { product: ProductPayload | null };
        if (!refetch.product) {
          throw new Error("product not found after update - it may have been deleted concurrently");
        }
        product = refetch.product;
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
          variants: product.variants.edges.map((e) => ({
            id: e.node.id,
            title: e.node.title,
            price: e.node.price,
            compareAtPrice: e.node.compareAtPrice,
            sku: e.node.sku,
            barcode: e.node.barcode,
            // cost is only queried (and returned) when the caller wrote one
            ...(wantsCost ? { cost: e.node.inventoryItem?.unitCost?.amount ?? null } : {}),
          })),
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
