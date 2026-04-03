import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import {
  fetchProductMediaSample,
  fetchShopifyFileById,
  getFileAttachmentError,
  isFileAttachableToProduct,
  normalizeProductId,
} from "../files/shopifyFiles.js";

const DetachFileFromProductInputSchema = z.object({
  fileId: z.string().min(1).describe("Shopify file GID"),
  productId: z.string().min(1).describe("Product ID (numeric or full GID)"),
});

type DetachFileFromProductInput = z.infer<typeof DetachFileFromProductInputSchema>;

let shopifyClient: GraphQLClient;

const detachFileFromProduct = {
  name: "detach-file-from-product",
  description:
    "Remove an existing Shopify MediaImage file from a product without deleting the library file",
  schema: DetachFileFromProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: DetachFileFromProductInput) => {
    const productId = normalizeProductId(input.productId);
    const file = await fetchShopifyFileById(shopifyClient, input.fileId);
    if (!file) {
      throw new Error("Shopify file not found.");
    }

    if (!isFileAttachableToProduct(file)) {
      throw new Error(getFileAttachmentError(file));
    }

    const mutation = gql`
      mutation DetachFileFromProduct($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) {
          files {
            id
            fileStatus
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const data = (await shopifyClient.request(mutation, {
      files: [
        {
          id: input.fileId,
          referencesToRemove: [productId],
        },
      ],
    })) as {
      fileUpdate: {
        files: Array<{
          id: string;
          fileStatus: string;
        }>;
        userErrors: Array<{
          field: string[];
          message: string;
          code?: string | null;
        }>;
      };
    };

    if (data.fileUpdate.userErrors.length > 0) {
      throw new Error(
        data.fileUpdate.userErrors
          .map((error) =>
            error.code
              ? `${error.code}: ${error.message}`
              : `${error.field.join(".")}: ${error.message}`,
          )
          .join(", "),
      );
    }

    return {
      success: true,
      fileId: input.fileId,
      productId,
      detached: true,
      fileStatus: data.fileUpdate.files[0]?.fileStatus ?? file.fileStatus,
      productMediaSample: await fetchProductMediaSample(
        shopifyClient,
        productId,
      ),
    };
  },
};

export { detachFileFromProduct };
