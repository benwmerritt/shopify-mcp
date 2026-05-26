import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getProductById
const GetProductByIdInputSchema = z.object({
  productId: z.string().min(1)
});

type GetProductByIdInput = z.infer<typeof GetProductByIdInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getProductById = {
  name: "get-product-by-id",
  description: "Get a specific product by ID",
  schema: GetProductByIdInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductByIdInput) => {
    try {
      const { productId } = input;

      const query = gql`
        query GetProductById($id: ID!) {
          product(id: $id) {
            id
            title
            description
            handle
            status
            createdAt
            updatedAt
            totalInventory
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            images(first: 5) {
              edges {
                node {
                  id
                  url
                  altText
                  width
                  height
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryQuantity
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            collections(first: 5) {
              edges {
                node {
                  id
                  title
                }
              }
            }
            tags
            vendor
            productType
            category {
              id
              name
              fullName
            }
          }
        }
      `;

      const variables = {
        id: productId
      };

      const data = (await shopifyClient.request(query, variables)) as {
        product: any;
      };

      if (!data.product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      // Format product data
      const product = data.product;

      // Format variants
      const variants = product.variants.edges.map((variantEdge: any) => ({
        id: variantEdge.node.id,
        title: variantEdge.node.title,
        price: variantEdge.node.price,
        inventoryQuantity: variantEdge.node.inventoryQuantity,
        sku: variantEdge.node.sku,
        options: variantEdge.node.selectedOptions
      }));

      // Format images
      const images = product.images.edges.map((imageEdge: any) => ({
        id: imageEdge.node.id,
        url: imageEdge.node.url,
        altText: imageEdge.node.altText,
        width: imageEdge.node.width,
        height: imageEdge.node.height
      }));

      // Format collections
      const collections = product.collections.edges.map(
        (collectionEdge: any) => ({
          id: collectionEdge.node.id,
          title: collectionEdge.node.title
        })
      );

      const formattedProduct = {
        id: product.id,
        title: product.title,
        description: product.description,
        handle: product.handle,
        status: product.status,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        totalInventory: product.totalInventory,
        priceRange: {
          minPrice: {
            amount: product.priceRangeV2.minVariantPrice.amount,
            currencyCode: product.priceRangeV2.minVariantPrice.currencyCode
          },
          maxPrice: {
            amount: product.priceRangeV2.maxVariantPrice.amount,
            currencyCode: product.priceRangeV2.maxVariantPrice.currencyCode
          }
        },
        images,
        variants,
        collections,
        tags: product.tags,
        vendor: product.vendor,
        productType: product.productType,
        category: product.category
      };

      return { product: formattedProduct };
    } catch (error) {
      console.error("Error fetching product by ID:", error);
      throw new Error(
        `Failed to fetch product: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getProductById };
