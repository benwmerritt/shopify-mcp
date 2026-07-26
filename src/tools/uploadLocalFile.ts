import { basename } from "node:path";

import type { GraphQLClient } from "graphql-request";
import { z } from "zod";

import { uploadFileToShopify } from "../files/uploadPipeline.js";
import type {
  DuplicateResolutionMode,
  RequestedUploadKind,
} from "../files/uploadUtils.js";

const UploadLocalFileInputSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe("Absolute or process-relative path to a file on the MCP server host"),
  filename: z
    .string()
    .min(1)
    .optional()
    .describe("Optional Shopify filename; defaults to the local basename"),
  mimeType: z
    .string()
    .min(1)
    .describe("MIME type for the upload, for example image/png or application/pdf"),
  kind: z.enum(["AUTO", "IMAGE", "FILE"]).default("AUTO"),
  altText: z.string().optional(),
  duplicateResolutionMode: z
    .enum(["APPEND_UUID", "RAISE_ERROR", "REPLACE"])
    .default("APPEND_UUID"),
});

type UploadLocalFileInput = z.infer<typeof UploadLocalFileInputSchema>;

let shopifyClient: GraphQLClient;
let localMode = false;

const uploadLocalFile = {
  name: "upload-local-file",
  description:
    "Upload a file from the MCP server host into Shopify Files (local mode only)",
  schema: UploadLocalFileInputSchema,

  initialize(options: { client: GraphQLClient; localMode: boolean }) {
    shopifyClient = options.client;
    localMode = options.localMode;
  },

  execute: async (input: UploadLocalFileInput) => {
    if (!localMode) {
      throw new Error(
        "upload-local-file is only available when the MCP server is running in local mode.",
      );
    }

    return uploadFileToShopify({
      shopifyClient,
      filePath: input.filePath,
      filename: input.filename ?? basename(input.filePath),
      mimeType: input.mimeType,
      requestedKind: input.kind as RequestedUploadKind,
      altText: input.altText,
      duplicateResolutionMode:
        input.duplicateResolutionMode as DuplicateResolutionMode,
    });
  },
};

export { uploadLocalFile };
