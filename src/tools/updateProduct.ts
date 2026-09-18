import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Variant update schema
// Note: weight/weightUnit are not supported on ProductVariantSetInput - must be set via inventory item
const VariantUpdateSchema = z.object({
  id: z.string().optional(),
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  options: z.array(z.string()).optional(),
  optionValues: z.array(z.object({
    optionName: z.string().min(1),
    name: z.string().min(1),
  })).optional(),
  // Unit cost ("cost per item", shop currency). Lives on the inventory item,
  // not the variant, so it is sent as inventoryItem.cost.
  cost: z.string().optional(),
});

// Image schema
const ImageSchema = z.object({
  src: z.string(),
  altText: z.string().optional(),
});

const SeoSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
});

// Update product input schema
export const UpdateProductInputSchema = z.object({
  // REQUIRED - product ID
  id: z.string().min(1),

  // Basic product fields (all optional)
  title: z.string().optional(),
  handle: z.string().min(1).optional(),
  redirectNewHandle: z.boolean().optional().describe(
    "When changing handle, create Shopify's native redirect from the previous handle",
  ),
  descriptionHtml: z.string().optional(),
  seo: SeoSchema.optional(),
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
  cost: z.string().optional().describe("Unit cost (cost per item) in the shop currency"),

  // For updating specific variants
  variants: z.array(VariantUpdateSchema).optional(),

  // Rename a product option in place (e.g. "Voltage" -> "Model").
  // Existing variants and their IDs are preserved.
  renameOption: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }).optional().describe("Rename a product option in place; variants and their IDs are preserved"),

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

// Map a variant's selectedOptions to optionValues entries. No longer used by
// execute() (variant edits go through productVariantsBulkUpdate, which does
// not need them); kept for callers and tests.
export function selectedOptionsToOptionValues(
  selectedOptions: Array<{ name: string; value: string }>,
): Array<{ optionName: string; name: string }> {
  return selectedOptions.map(({ name, value }) => ({
    optionName: name,
    name: value,
  }));
}

// ProductVariantsBulkInput has no top-level sku or cost; both live on the
// inventory item (InventoryItemInput.sku / InventoryItemInput.cost). Merge
// them into a single inventoryItem object so neither clobbers the other.
// Exported for unit tests.
export function buildInventoryItemInput(
  fields: { sku?: string; cost?: string },
): { sku?: string; cost?: string } | undefined {
  if (fields.sku === undefined && fields.cost === undefined) return undefined;
  return {
    ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
    ...(fields.cost !== undefined ? { cost: fields.cost } : {}),
  };
}

// inventoryItem.unitCost needs the read_inventory scope, so it is only
// selected when the caller actually wrote a cost. Cost-less updates must keep
// working on tokens that only carry product scopes.
const variantSelection = (includeCost: boolean) =>
  `id title price compareAtPrice sku barcode${
    includeCost ? " inventoryItem { unitCost { amount } }" : ""
  }`;

type VariantNode = {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  barcode: string | null;
  inventoryItem?: { unitCost: { amount: string } | null } | null;
};

// Flatten unitCost onto the variant as `cost` when it was requested; leave the
// response shape unchanged otherwise.
function formatVariant(node: VariantNode, includeCost: boolean): Record<string, unknown> {
  const { inventoryItem, ...rest } = node;
  if (!includeCost) return rest;
  return { ...rest, cost: inventoryItem?.unitCost?.amount ?? null };
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

const updateProduct = {
  name: "update-product",
  description: "Update an existing product - can modify title, description, vendor, type, tags, status, price, SKU, and more",
  schema: UpdateProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (
    input: UpdateProductInput,
  ): Promise<{ product: Record<string, any>; redirectNewHandle?: boolean }> => {
    try {
      const productId = normalizeProductId(input.id);

      // productSet accepts handles but has no redirectNewHandle argument. Route
      // the narrow handle+redirect operation through productUpdate so the URL
      // redirect is atomic with the rename and does not require a separate
      // write_online_store_navigation mutation.
      if (input.handle !== undefined && input.redirectNewHandle === true) {
        const otherChanges =
          input.title !== undefined || input.descriptionHtml !== undefined ||
          input.seo !== undefined ||
          input.vendor !== undefined || input.productType !== undefined ||
          input.category !== undefined || input.tags !== undefined ||
          input.status !== undefined || input.price !== undefined ||
          input.compareAtPrice !== undefined || input.sku !== undefined ||
          input.barcode !== undefined || input.cost !== undefined ||
          input.variants !== undefined || input.renameOption !== undefined ||
          input.images !== undefined;
        if (otherChanges) {
          throw new Error("Handle+redirect updates must be submitted alone");
        }
        const handleQuery = gql`
          mutation productUpdateHandle($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product {
                id title handle descriptionHtml vendor productType status tags updatedAt
                category { id name fullName }
                variants(first: 100) {
                  edges { node { id title price compareAtPrice sku barcode } }
                }
                images(first: 20) {
                  edges { node { id url altText width height } }
                }
              }
              userErrors { field message }
            }
          }
        `;
        const handleData = (await shopifyClient.request(handleQuery, {
          product: {
            id: productId,
            handle: input.handle,
            redirectNewHandle: true,
          },
        })) as {
          productUpdate: {
            product: null | {
              variants: { edges: Array<{ node: Record<string, unknown> }> };
              images: { edges: Array<{ node: Record<string, unknown> }> };
              [key: string]: unknown;
            };
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };
        if (handleData.productUpdate.userErrors.length > 0) {
          throw new Error(handleData.productUpdate.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`).join(", "));
        }
        const product = handleData.productUpdate.product;
        if (!product) throw new Error("Product handle update returned no product");
        return {
          product: {
            ...product,
            variants: product.variants.edges.map((e) => e.node),
            images: product.images.edges.map((e) => e.node),
          },
          redirectNewHandle: true,
        };
      }

      // Validate the variant payload before any mutation runs, so a rejected
      // combination cannot leave the product half-updated (e.g. option renamed
      // but variants untouched, with the original name gone for a retry).
      const variantsToCreate = (input.variants ?? []).filter(
        (variant) => !variant.id && variant.optionValues !== undefined,
      );
      if (variantsToCreate.length > 0 && variantsToCreate.length !== (input.variants ?? []).length) {
        throw new Error("New variants with optionValues cannot be mixed with variant updates");
      }
      const orphanVariants = (input.variants ?? []).filter(
        (variant) => !variant.id && variant.optionValues === undefined,
      );
      if (orphanVariants.length > 0) {
        throw new Error("each entry in variants needs an id (to update) or optionValues (to create)");
      }
      // The simple fields target "the first variant", but productVariantsBulkCreate
      // deletes a lone "Default Title" variant under its default strategy, so the
      // ID resolved before creation may be gone by the time the update runs.
      const hasSimpleVariantFields =
        input.price !== undefined || input.sku !== undefined ||
        input.compareAtPrice !== undefined || input.barcode !== undefined ||
        input.cost !== undefined;
      if (variantsToCreate.length > 0 && hasSimpleVariantFields) {
        throw new Error(
          "Top-level price/sku/compareAtPrice/barcode/cost cannot be combined with new variants - put those fields on a variants[] entry with an id instead",
        );
      }
      // The public schema accepts variants[].options (positional values) but
      // nothing has ever mapped it; refuse it rather than silently drop it.
      if ((input.variants ?? []).some((v) => v.options !== undefined)) {
        throw new Error(
          "variants[].options is not supported - use variants[].optionValues ([{optionName, name}]) instead",
        );
      }

      // Rename a product option in place. productOptionUpdate cannot be rolled
      // back, so it must be the only write in the request: anything that could
      // fail afterwards would leave the rename applied and `from` gone for a
      // retry. Shopify can return empty userErrors without applying the rename,
      // so the returned options are checked rather than trusted.
      if (input.renameOption) {
        const otherWrites =
          input.title !== undefined || input.handle !== undefined ||
          input.descriptionHtml !== undefined || input.seo !== undefined ||
          input.vendor !== undefined || input.productType !== undefined ||
          input.category !== undefined || input.tags !== undefined ||
          input.status !== undefined || input.images !== undefined ||
          hasSimpleVariantFields || input.variants !== undefined;
        if (otherWrites) {
          throw new Error("renameOption must be submitted alone - send other changes in a separate call");
        }
        const { from, to } = input.renameOption;
        const optData = (await shopifyClient.request(
          gql`query productOptions($id: ID!) { product(id: $id) { options { id name } } }`,
          { id: productId },
        )) as { product: { options: Array<{ id: string; name: string }> } | null };
        if (!optData.product) {
          throw new Error("Product not found - check the ID");
        }
        const option = optData.product.options.find((o) => o.name === from);
        if (!option) {
          const names = optData.product.options.map((o) => o.name).join(", ");
          throw new Error(`Option "${from}" not found on product (has: ${names})`);
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
          { productId, option: { id: option.id, name: to } },
        )) as {
          productOptionUpdate: {
            product: { options: Array<{ id: string; name: string }> } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
          };
        };
        if (renameData.productOptionUpdate.userErrors.length > 0) {
          throw new Error(
            `option rename: ${renameData.productOptionUpdate.userErrors
              .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
              .join(", ")}`,
          );
        }
        const renamed = renameData.productOptionUpdate.product?.options.find((o) => o.id === option.id);
        if (!renamed || renamed.name !== to) {
          throw new Error(
            `Option rename did not apply: option ${option.id} is "${renamed ? renamed.name : "missing"}" (expected "${to}")`,
          );
        }
      }

      // Only select (and return) cost when the caller wrote one - see
      // variantSelection() for the scope rationale.
      const wantsCost =
        input.cost !== undefined ||
        (input.variants ?? []).some((v) => v.cost !== undefined);

      // First, fetch the product to get the first variant ID if needed
      let firstVariantId: string | null = null;

      if (hasSimpleVariantFields) {
        const fetchQuery = gql`
          query getProduct($id: ID!) {
            product(id: $id) {
              variants(first: 1) {
                edges { node { id } }
              }
            }
          }
        `;

        const fetchData = await shopifyClient.request(fetchQuery, { id: productId }) as {
          product: { variants: { edges: Array<{ node: { id: string } }> } } | null;
        };

        if (!fetchData.product) {
          throw new Error("Product not found - check the ID");
        }
        firstVariantId = fetchData.product.variants?.edges?.[0]?.node.id ?? null;
      }

      const productSelection = `
        id
        title
        handle
        descriptionHtml
        vendor
        productType
        seo { title description }
        category { id name fullName }
        status
        tags
        ${input.renameOption ? "options { id name }" : ""}
        variants(first: 100) {
          edges { node { ${variantSelection(wantsCost)} } }
        }
        images(first: 20) {
          edges { node { id url altText } }
        }
      `;

      type ProductPayload = {
        id: string;
        title: string;
        handle: string;
        descriptionHtml: string;
        vendor: string;
        productType: string;
        seo?: { title: string | null; description: string | null };
        category: { id: string; name: string; fullName: string } | null;
        status: string;
        tags: string[];
        options?: Array<{ id: string; name: string }>;
        variants: { edges: Array<{ node: VariantNode }> };
        images: { edges: Array<{ node: Record<string, unknown> }> };
      };

      const formatProduct = (product: ProductPayload) => ({
        product: {
          ...product,
          variants: product.variants.edges.map((e) => formatVariant(e.node, wantsCost)),
          images: product.images.edges.map((e) => e.node),
        },
      });

      const readProduct = async (failure: string): Promise<ProductPayload> => {
        const readData = (await shopifyClient.request(
          gql`query getUpdatedProduct($id: ID!) { product(id: $id) { ${productSelection} } }`,
          { id: productId },
        )) as { product: ProductPayload | null };
        if (!readData.product) throw new Error(failure);
        return readData.product;
      };

      // Build the product-level input for productSet
      const productInput: Record<string, unknown> = {
        id: productId,
      };

      if (input.title !== undefined) productInput.title = input.title;
      if (input.handle !== undefined) productInput.handle = input.handle;
      if (input.descriptionHtml !== undefined) productInput.descriptionHtml = input.descriptionHtml;
      if (input.seo !== undefined) productInput.seo = input.seo;
      if (input.vendor !== undefined) productInput.vendor = input.vendor;
      if (input.productType !== undefined) productInput.productType = input.productType;
      if (input.category !== undefined) productInput.category = input.category;
      if (input.tags !== undefined) productInput.tags = input.tags;
      if (input.status !== undefined) productInput.status = input.status;
      if (input.images && input.images.length > 0) {
        productInput.files = input.images.map(img => ({
          originalSource: img.src,
          alt: img.altText || undefined,
        }));
      }

      const hasProductLevelChanges = Object.keys(productInput).length > 1;

      // Existing-variant updates. These never go through productSet:
      // ProductSetInput.variants is a full sync (anything omitted is deleted)
      // and requires productOptions on API 2026-01. productVariantsBulkUpdate
      // touches only the listed variants.
      const variantsToUpdate: Array<Record<string, unknown>> = [];

      if (hasSimpleVariantFields && firstVariantId) {
        const simpleVariant: Record<string, unknown> = { id: firstVariantId };
        if (input.price !== undefined) simpleVariant.price = input.price;
        if (input.compareAtPrice !== undefined) simpleVariant.compareAtPrice = input.compareAtPrice;
        if (input.barcode !== undefined) simpleVariant.barcode = input.barcode;
        const inventoryItem = buildInventoryItemInput(input);
        if (inventoryItem) simpleVariant.inventoryItem = inventoryItem;
        variantsToUpdate.push(simpleVariant);
      }

      for (const variant of input.variants ?? []) {
        if (!variant.id) continue;
        const v: Record<string, unknown> = { id: normalizeVariantId(variant.id) };
        if (variant.price !== undefined) v.price = variant.price;
        if (variant.compareAtPrice !== undefined) v.compareAtPrice = variant.compareAtPrice;
        if (variant.barcode !== undefined) v.barcode = variant.barcode;
        if (variant.optionValues !== undefined) v.optionValues = variant.optionValues;
        const inventoryItem = buildInventoryItemInput(variant);
        if (inventoryItem) v.inventoryItem = inventoryItem;
        variantsToUpdate.push(v);
      }

      // New variants must use the purpose-built bulk-create mutation. The
      // public ProductSetInput schema does not expose variants[].optionValues
      // for additional variants on API 2026-01.
      let createdVariants = false;
      if (variantsToCreate.length > 0) {
        const bulkCreateQuery = gql`
          mutation productVariantsBulkCreate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkCreate(
              productId: $productId
              variants: $variants
            ) {
              productVariants { id title price compareAtPrice sku barcode }
              userErrors { field message }
            }
          }
        `;
        const bulkCreateVariants = variantsToCreate.map((variant) => {
          const created: Record<string, unknown> = {
            optionValues: variant.optionValues,
          };
          if (variant.price !== undefined) created.price = variant.price;
          if (variant.compareAtPrice !== undefined) created.compareAtPrice = variant.compareAtPrice;
          const inventoryItem = buildInventoryItemInput(variant);
          if (inventoryItem) created.inventoryItem = inventoryItem;
          if (variant.barcode !== undefined) created.barcode = variant.barcode;
          return created;
        });
        const bulkCreateData = (await shopifyClient.request(bulkCreateQuery, {
          productId,
          variants: bulkCreateVariants,
        })) as {
          productVariantsBulkCreate: {
            productVariants: Array<Record<string, unknown>>;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };
        if (bulkCreateData.productVariantsBulkCreate.userErrors.length > 0) {
          throw new Error(
            `Failed to create product variants: ${bulkCreateData.productVariantsBulkCreate.userErrors
              .map((e) => `${e.field.join(".")}: ${e.message}`).join(", ")}`,
          );
        }
        createdVariants = true;
      }

      // Product-level fields via productSet (no variants in the payload).
      let product: ProductPayload | null = null;
      if (hasProductLevelChanges) {
        const query = gql`
          mutation productSet($input: ProductSetInput!, $synchronous: Boolean) {
            productSet(input: $input, synchronous: $synchronous) {
              product { ${productSelection} }
              userErrors { field message }
            }
          }
        `;

        const data = (await shopifyClient.request(query, {
          input: productInput,
          synchronous: true,
        })) as {
          productSet: {
            product: ProductPayload | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
          };
        };

        if (data.productSet.userErrors.length > 0) {
          throw new Error(
            `Failed to update product: ${data.productSet.userErrors
              .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
              .join(", ")}`
          );
        }

        if (!data.productSet.product) {
          throw new Error("Product update returned no product - check if the ID is valid");
        }

        product = data.productSet.product;

        // Loud-fail if the caller asked to set the category and Shopify silently
        // ignored it (invalid taxonomy GID, wrong namespace, etc).
        if (input.category !== undefined) {
          verifyCategorySet(product, input.category);
        }
      }

      if (variantsToUpdate.length > 0) {
        const bulkQuery = gql`
          mutation productVariantsBulkUpdate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(
              productId: $productId
              variants: $variants
            ) {
              productVariants { id title price compareAtPrice sku barcode }
              userErrors { field message }
            }
          }
        `;

        const bulkData = (await shopifyClient.request(bulkQuery, {
          productId,
          variants: variantsToUpdate,
        })) as {
          productVariantsBulkUpdate: {
            productVariants: Array<Record<string, unknown>>;
            userErrors: Array<{ field: string[] | null; message: string }>;
          };
        };

        if (bulkData.productVariantsBulkUpdate.userErrors.length > 0) {
          throw new Error(
            `Failed to update product variants: ${bulkData.productVariantsBulkUpdate.userErrors
              .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
              .join(", ")}`
          );
        }
      }

      if (createdVariants || variantsToUpdate.length > 0) {
        // Read back once after all variant writes, including any after productSet.
        product = await readProduct("Product update succeeded but read-back returned no product");
      }

      if (!product) {
        if (input.renameOption) {
          // A rename on its own has nothing left to write; return the
          // post-rename state.
          product = await readProduct("Option rename succeeded but read-back returned no product");
        } else {
          throw new Error("No changes provided - pass at least one product or variant field to update");
        }
      }

      return formatProduct(product);
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
