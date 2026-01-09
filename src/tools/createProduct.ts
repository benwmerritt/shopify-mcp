import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Variant schema for products with multiple options
const VariantSchema = z.object({
  price: z.string(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  options: z.array(z.string()),
  weight: z.number().optional(),
  weightUnit: z.enum(["KILOGRAMS", "GRAMS", "POUNDS", "OUNCES"]).optional(),
});

// Image schema
const ImageSchema = z.object({
  src: z.string(),
  altText: z.string().optional(),
});

// Enhanced input schema for creating a product
const CreateProductInputSchema = z.object({
  // Existing fields
  title: z.string().min(1),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),

  // Simple product fields (when no variants)
  price: z.string().optional(),
  compareAtPrice: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  weight: z.number().optional(),
  weightUnit: z.enum(["KILOGRAMS", "GRAMS", "POUNDS", "OUNCES"]).optional(),

  // Product options (e.g., ["Size", "Color"])
  options: z.array(z.string()).optional(),

  // Variants for products with multiple options
  variants: z.array(VariantSchema).optional(),

  // Images via URL
  images: z.array(ImageSchema).optional(),
});

type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const createProduct = {
  name: "create-product",
  description: "Create a new product with optional variants, pricing, and images",
  schema: CreateProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateProductInput) => {
    try {
      // Use productSet mutation - it handles product + variants in one call
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
              variants(first: 50) {
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
              images(first: 10) {
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

      // Build the product input for productSet
      const productInput: Record<string, unknown> = {
        title: input.title,
        status: input.status,
      };

      // Add optional basic fields
      if (input.descriptionHtml) productInput.descriptionHtml = input.descriptionHtml;
      if (input.vendor) productInput.vendor = input.vendor;
      if (input.productType) productInput.productType = input.productType;
      if (input.tags) productInput.tags = input.tags;

      // Handle variants with options
      if (input.variants && input.variants.length > 0 && input.options && input.options.length > 0) {
        // Build productOptions with all unique values
        const optionValuesMap: Map<string, Set<string>> = new Map();

        // Initialize with option names
        for (const optionName of input.options) {
          optionValuesMap.set(optionName, new Set());
        }

        // Collect all unique values from variants
        for (const variant of input.variants) {
          for (let i = 0; i < input.options.length && i < variant.options.length; i++) {
            optionValuesMap.get(input.options[i])?.add(variant.options[i]);
          }
        }

        // Build productOptions array
        productInput.productOptions = input.options.map((optionName) => ({
          name: optionName,
          values: Array.from(optionValuesMap.get(optionName) || []).map((v) => ({ name: v })),
        }));

        // Build variants with optionValues
        productInput.variants = input.variants.map((variant) => {
          const v: Record<string, unknown> = {
            price: variant.price,
            optionValues: input.options!.map((optionName, i) => ({
              optionName: optionName,
              name: variant.options[i],
            })),
          };
          if (variant.compareAtPrice) v.compareAtPrice = variant.compareAtPrice;
          if (variant.sku) v.sku = variant.sku;
          if (variant.barcode) v.barcode = variant.barcode;
          if (variant.weight !== undefined) v.weight = variant.weight;
          if (variant.weightUnit) v.weightUnit = variant.weightUnit;
          return v;
        });
      } else if (input.price || input.sku) {
        // Simple product with single variant
        const variant: Record<string, unknown> = {};
        if (input.price) variant.price = input.price;
        if (input.compareAtPrice) variant.compareAtPrice = input.compareAtPrice;
        if (input.sku) variant.sku = input.sku;
        if (input.barcode) variant.barcode = input.barcode;
        if (input.weight !== undefined) variant.weight = input.weight;
        if (input.weightUnit) variant.weightUnit = input.weightUnit;
        productInput.variants = [variant];
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
          `Failed to create product: ${data.productSet.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      if (!data.productSet.product) {
        throw new Error("Product creation returned no product");
      }

      // Format the response
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
      console.error("Error creating product:", error);
      throw new Error(
        `Failed to create product: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
};

export { createProduct };
