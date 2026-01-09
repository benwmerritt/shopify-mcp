import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Variant update schema
const VariantUpdateSchema = z.object({
  id: z.string().optional(),
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  weight: z.number().optional(),
  weightUnit: z.enum(["KILOGRAMS", "GRAMS", "POUNDS", "OUNCES"]).optional(),
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
  tags: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),

  // Simple variant fields (auto-updates first variant)
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  weight: z.number().optional(),
  weightUnit: z.enum(["KILOGRAMS", "GRAMS", "POUNDS", "OUNCES"]).optional(),

  // For updating specific variants
  variants: z.array(VariantUpdateSchema).optional(),

  // Images
  images: z.array(ImageSchema).optional(),
});

type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

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

      // First, fetch the product to get current variant IDs if needed
      let firstVariantId: string | null = null;
      const hasSimpleVariantFields = input.price || input.sku || input.compareAtPrice ||
                                      input.barcode || input.weight !== undefined;

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
      if (input.descriptionHtml !== undefined) productInput.descriptionHtml = input.descriptionHtml;
      if (input.vendor !== undefined) productInput.vendor = input.vendor;
      if (input.productType !== undefined) productInput.productType = input.productType;
      if (input.tags !== undefined) productInput.tags = input.tags;
      if (input.status !== undefined) productInput.status = input.status;

      // Handle variants
      const variantsToUpdate: Array<Record<string, unknown>> = [];

      // If simple variant fields provided, update first variant
      if (hasSimpleVariantFields && firstVariantId) {
        const simpleVariant: Record<string, unknown> = { id: firstVariantId };
        if (input.price !== undefined) simpleVariant.price = input.price;
        if (input.compareAtPrice !== undefined) simpleVariant.compareAtPrice = input.compareAtPrice;
        if (input.sku !== undefined) simpleVariant.sku = input.sku;
        if (input.barcode !== undefined) simpleVariant.barcode = input.barcode;
        if (input.weight !== undefined) simpleVariant.weight = input.weight;
        if (input.weightUnit !== undefined) simpleVariant.weightUnit = input.weightUnit;
        variantsToUpdate.push(simpleVariant);
      }

      // Add explicitly provided variants
      if (input.variants) {
        for (const variant of input.variants) {
          const v: Record<string, unknown> = {};
          if (variant.id) v.id = normalizeVariantId(variant.id);
          if (variant.price !== undefined) v.price = variant.price;
          if (variant.compareAtPrice !== undefined) v.compareAtPrice = variant.compareAtPrice;
          if (variant.sku !== undefined) v.sku = variant.sku;
          if (variant.barcode !== undefined) v.barcode = variant.barcode;
          if (variant.weight !== undefined) v.weight = variant.weight;
          if (variant.weightUnit !== undefined) v.weightUnit = variant.weightUnit;
          variantsToUpdate.push(v);
        }
      }

      if (variantsToUpdate.length > 0) {
        productInput.variants = variantsToUpdate;
      }

      // Handle images (media)
      // Note: For productSet, we would need to use productCreateMedia separately
      // For now, skip images in updates - can be added later

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
      return {
        product: {
          id: product.id,
          title: product.title,
          handle: product.handle,
          descriptionHtml: product.descriptionHtml,
          vendor: product.vendor,
          productType: product.productType,
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
