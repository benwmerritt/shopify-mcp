import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for deleteProductImages
const DeleteProductImagesInputSchema = z.object({
  productId: z.string().min(1).describe("Product ID (can be numeric or full GID)"),
  imageIds: z.array(z.string().min(1)).min(1).describe("Array of image/media IDs to delete")
});

type DeleteProductImagesInput = z.infer<typeof DeleteProductImagesInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Helper to normalize product ID to GID format
function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  return `gid://shopify/Product/${id}`;
}

// Helper to normalize media ID to GID format
function normalizeMediaId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }
  // Media can be different types, try MediaImage first
  return `gid://shopify/MediaImage/${id}`;
}

const deleteProductImages = {
  name: "delete-product-images",
  description: "Delete one or more images/media from a product",
  schema: DeleteProductImagesInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DeleteProductImagesInput) => {
    try {
      const productId = normalizeProductId(input.productId);
      const mediaIds = input.imageIds.map(normalizeMediaId);

      const query = gql`
        mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
          productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
            deletedMediaIds
            product {
              id
              title
              media(first: 10) {
                edges {
                  node {
                    ... on MediaImage {
                      id
                      image {
                        url
                        altText
                      }
                    }
                  }
                }
              }
            }
            mediaUserErrors {
              field
              message
              code
            }
          }
        }
      `;

      const variables = {
        productId,
        mediaIds
      };

      const data = (await shopifyClient.request(query, variables)) as {
        productDeleteMedia: {
          deletedMediaIds: string[];
          product: {
            id: string;
            title: string;
            media: {
              edges: Array<{
                node: {
                  id: string;
                  image?: {
                    url: string;
                    altText: string | null;
                  };
                };
              }>;
            };
          } | null;
          mediaUserErrors: Array<{
            field: string[];
            message: string;
            code: string;
          }>;
        };
      };

      // Check for errors
      if (data.productDeleteMedia.mediaUserErrors.length > 0) {
        throw new Error(
          `Failed to delete images: ${data.productDeleteMedia.mediaUserErrors
            .map((e) => `${e.code}: ${e.message}`)
            .join(", ")}`
        );
      }

      // Format remaining images
      const remainingImages = data.productDeleteMedia.product?.media.edges.map(
        (edge) => ({
          id: edge.node.id,
          url: edge.node.image?.url,
          altText: edge.node.image?.altText
        })
      ) || [];

      return {
        success: true,
        deletedImageIds: data.productDeleteMedia.deletedMediaIds,
        deletedCount: data.productDeleteMedia.deletedMediaIds.length,
        remainingImages,
        message: `Deleted ${data.productDeleteMedia.deletedMediaIds.length} image(s) from product`
      };
    } catch (error) {
      console.error("Error deleting product images:", error);
      throw new Error(
        `Failed to delete product images: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { deleteProductImages };
