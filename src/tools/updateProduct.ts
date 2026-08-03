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
  handle: z.string().min(1).optional(),
  redirectNewHandle: z.boolean().optional().describe(
    "When changing handle, create Shopify's native redirect from the previous handle",
  ),
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

// ProductSetInput requires optionValues on every variant payload, including
// updates to an existing variant. Preserve the variant's current selections
// instead of forcing callers to repeat them for simple price/SKU edits.
export function selectedOptionsToOptionValues(
  selectedOptions: Array<{ name: string; value: string }>,
): Array<{ optionName: string; name: string }> {
  return selectedOptions.map(({ name, value }) => ({
    optionName: name,
    name: value,
  }));
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

  execute: async (input: UpdateProductInput) => {
    try {
      const productId = normalizeProductId(input.id);

      // productSet accepts handles but has no redirectNewHandle argument. Route
      // the narrow handle+redirect operation through productUpdate so the URL
      // redirect is atomic with the rename and does not require a separate
      // write_online_store_navigation mutation.
      if (input.handle !== undefined && input.redirectNewHandle === true) {
        const otherChanges =
          input.title !== undefined || input.descriptionHtml !== undefined ||
          input.vendor !== undefined || input.productType !== undefined ||
          input.category !== undefined || input.tags !== undefined ||
          input.status !== undefined || input.price !== undefined ||
          input.compareAtPrice !== undefined || input.sku !== undefined ||
          input.barcode !== undefined || input.variants !== undefined ||
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

      // First, fetch the product to get current variant IDs/options if needed
      let firstVariantId: string | null = null;
      const variantOptionValues = new Map<
        string,
        Array<{ optionName: string; name: string }>
      >();
      const hasSimpleVariantFields = input.price || input.sku || input.compareAtPrice || input.barcode;

      if (hasSimpleVariantFields || input.variants?.some((variant) => variant.id)) {
        // ProductSet requires optionValues even when updating an existing
        // variant, so fetch and preserve each variant's current selections.
        const fetchQuery = gql`
          query getProduct($id: ID!) {
            product(id: $id) {
              variants(first: 100) {
                edges {
                  node {
                    id
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
            }
          }
        `;

        const fetchData = await shopifyClient.request(fetchQuery, { id: productId }) as {
          product: {
            variants: {
              edges: Array<{
                node: {
                  id: string;
                  selectedOptions: Array<{ name: string; value: string }>;
                };
              }>;
            };
          } | null;
        };

        const variantEdges = fetchData.product?.variants?.edges ?? [];
        if (variantEdges[0]) {
          firstVariantId = variantEdges[0].node.id;
        }
        for (const { node } of variantEdges) {
          variantOptionValues.set(
            node.id,
            selectedOptionsToOptionValues(node.selectedOptions),
          );
        }
      }

      // Build the productSet mutation
      const query = gql`
        mutation productSet($input: ProductSetInput!, $synchronous: Boolean) {
          productSet(input: $input, synchronous: $synchronous) {
            product {
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
      if (input.handle !== undefined) productInput.handle = input.handle;
      if (input.descriptionHtml !== undefined) productInput.descriptionHtml = input.descriptionHtml;
      if (input.vendor !== undefined) productInput.vendor = input.vendor;
      if (input.productType !== undefined) productInput.productType = input.productType;
      if (input.category !== undefined) productInput.category = input.category;
      if (input.tags !== undefined) productInput.tags = input.tags;
      if (input.status !== undefined) productInput.status = input.status;

      // Handle variants
      const variantsToUpdate: Array<Record<string, unknown>> = [];

      // If simple variant fields provided, update first variant
      if (hasSimpleVariantFields && firstVariantId) {
        const simpleVariant: Record<string, unknown> = {
          id: firstVariantId,
          optionValues: variantOptionValues.get(firstVariantId),
        };
        if (input.price !== undefined) simpleVariant.price = input.price;
        if (input.compareAtPrice !== undefined) simpleVariant.compareAtPrice = input.compareAtPrice;
        if (input.sku !== undefined) simpleVariant.sku = input.sku;
        if (input.barcode !== undefined) simpleVariant.barcode = input.barcode;
        variantsToUpdate.push(simpleVariant);
      }

      // Add explicitly provided variants
      if (input.variants) {
        for (const variant of input.variants) {
          const v: Record<string, unknown> = {};
          if (variant.id) {
            const variantId = normalizeVariantId(variant.id);
            v.id = variantId;
            v.optionValues = variantOptionValues.get(variantId);
          }
          if (variant.price !== undefined) v.price = variant.price;
          if (variant.compareAtPrice !== undefined) v.compareAtPrice = variant.compareAtPrice;
          if (variant.sku !== undefined) v.sku = variant.sku;
          if (variant.barcode !== undefined) v.barcode = variant.barcode;
          variantsToUpdate.push(v);
        }
      }

      if (variantsToUpdate.length > 0) {
        productInput.variants = variantsToUpdate;
      }

      const hasProductLevelChanges =
        input.title !== undefined ||
        input.handle !== undefined ||
        input.descriptionHtml !== undefined ||
        input.vendor !== undefined ||
        input.productType !== undefined ||
        input.category !== undefined ||
        input.tags !== undefined ||
        input.status !== undefined ||
        (input.images !== undefined && input.images.length > 0);

      // productSet requires productOptions when variants are included on API
      // 2026-01, even for a narrow SKU/price edit. Route existing-variant-only
      // updates through the purpose-built bulk mutation instead.
      if (
        !hasProductLevelChanges &&
        variantsToUpdate.length > 0 &&
        variantsToUpdate.every((variant) => variant.id)
      ) {
        const bulkQuery = gql`
          mutation productVariantsBulkUpdate(
            $productId: ID!
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(
              productId: $productId
              variants: $variants
            ) {
              productVariants {
                id
                title
                price
                compareAtPrice
                sku
                barcode
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const bulkVariants = variantsToUpdate.map((variant) => {
          const bulkVariant = { ...variant };
          delete bulkVariant.optionValues;
          return bulkVariant;
        });

        const bulkData = (await shopifyClient.request(bulkQuery, {
          productId,
          variants: bulkVariants,
        })) as {
          productVariantsBulkUpdate: {
            productVariants: Array<{
              id: string;
              title: string;
              price: string;
              compareAtPrice: string | null;
              sku: string | null;
              barcode: string | null;
            }>;
            userErrors: Array<{ field: string[]; message: string }>;
          };
        };

        if (bulkData.productVariantsBulkUpdate.userErrors.length > 0) {
          throw new Error(
            `Failed to update product variants: ${bulkData.productVariantsBulkUpdate.userErrors
              .map((e) => `${e.field.join(".")}: ${e.message}`)
              .join(", ")}`
          );
        }

        const readQuery = gql`
          query getUpdatedProduct($id: ID!) {
            product(id: $id) {
              id
              title
              handle
              descriptionHtml
              vendor
              productType
              category { id name fullName }
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
                  node { id url altText }
                }
              }
            }
          }
        `;

        const readData = (await shopifyClient.request(readQuery, {
          id: productId,
        })) as {
          product: {
            id: string;
            title: string;
            handle: string;
            descriptionHtml: string;
            vendor: string;
            productType: string;
            category: { id: string; name: string; fullName: string } | null;
            status: string;
            tags: string[];
            variants: { edges: Array<{ node: Record<string, unknown> }> };
            images: { edges: Array<{ node: Record<string, unknown> }> };
          } | null;
        };

        if (!readData.product) {
          throw new Error("Product update succeeded but read-back returned no product");
        }

        return {
          product: {
            ...readData.product,
            variants: readData.product.variants.edges.map((e) => e.node),
            images: readData.product.images.edges.map((e) => e.node),
          },
        };
      }

      // Handle images via URL
      if (input.images && input.images.length > 0) {
        productInput.files = input.images.map(img => ({
          originalSource: img.src,
          alt: img.altText || undefined,
        }));
      }

      const variables = {
        input: productInput,
        synchronous: true,
      };

      const data = (await shopifyClient.request(query, variables)) as {
        productSet: {
          product: {
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
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors
      if (data.productSet.userErrors.length > 0) {
        throw new Error(
          `Failed to update product: ${data.productSet.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      if (!data.productSet.product) {
        throw new Error("Product update returned no product - check if the ID is valid");
      }

      // Format response
      const product = data.productSet.product;

      // Loud-fail if the caller asked to set the category and Shopify silently
      // ignored it (invalid taxonomy GID, wrong namespace, etc).
      if (input.category !== undefined) {
        verifyCategorySet(product, input.category);
      }

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
