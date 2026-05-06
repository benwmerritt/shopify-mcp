import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import {
  fetchProductMediaSample,
  fetchShopifyFileById,
  getFileAttachmentError,
  isFileAttachableToProduct,
  normalizeProductId,
  waitForFileReady,
} from "../files/shopifyFiles.js";

const AttachFileToProductInputSchema = z.object({
  fileId: z.string().min(1).describe("Shopify file GID"),
  productId: z.string().min(1).describe("Product ID (numeric or full GID)"),
  waitUntilReady: z.boolean().default(true),
  waitTimeoutSeconds: z.number().min(1).max(300).default(30),
});

type AttachFileToProductInput = z.infer<typeof AttachFileToProductInputSchema>;

let shopifyClient: GraphQLClient;

const attachFileToProduct = {
  name: "attach-file-to-product",
  description:
    "Attach an existing Shopify MediaImage file to a product without re-uploading it",
  schema: AttachFileToProductInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: AttachFileToProductInput) => {
    const productId = normalizeProductId(input.productId);

    let file = await fetchShopifyFileById(shopifyClient, input.fileId);
    if (!file) {
      throw new Error("Shopify file not found.");
    }

    if (!isFileAttachableToProduct(file)) {
      throw new Error(getFileAttachmentError(file));
    }

    if (input.waitUntilReady) {
      file = await waitForFileReady(
        shopifyClient,
        input.fileId,
        input.waitTimeoutSeconds,
      );
    } else if (file.fileStatus !== "READY") {
      throw new Error(
        `Shopify file is not READY. Current status: ${file.fileStatus ?? "unknown"}.`,
      );
    }

    const mutation = gql`
      mutation AttachFileToProduct($files: [FileUpdateInput!]!) {
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
          referencesToAdd: [productId],
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
      fileStatus: data.fileUpdate.files[0]?.fileStatus ?? file.fileStatus,
      attached: true,
      productMediaSample: await fetchProductMediaSample(
        shopifyClient,
        productId,
      ),
    };
  },
};

export { attachFileToProduct };
