import type { GraphQLClient } from "graphql-request";
import { z } from "zod";

import { fetchShopifyFileById } from "../files/shopifyFiles.js";
import { getUploadSession } from "../files/uploadSessions.js";

const GetFileUploadSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

type GetFileUploadSessionInput = z.infer<typeof GetFileUploadSessionInputSchema>;

let shopifyClient: GraphQLClient;

const getFileUploadSession = {
  name: "get-file-upload-session",
  description:
    "Inspect the state of a remote browser upload session and the resulting Shopify file",
  schema: GetFileUploadSessionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetFileUploadSessionInput) => {
    const session = getUploadSession(input.sessionId);
    if (!session) {
      throw new Error("Upload session not found.");
    }

    const result: Record<string, unknown> = {
      sessionId: session.id,
      sessionState: session.state,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };

    if (session.error) {
      result.error = session.error;
    }

    if (session.fileId) {
      const liveFile = await fetchShopifyFileById(shopifyClient, session.fileId);
      if (liveFile) {
        result.file = {
          id: liveFile.id,
          type: liveFile.type,
          fileStatus: liveFile.fileStatus,
          alt: liveFile.alt,
          url: liveFile.url,
          mimeType: liveFile.mimeType,
          sizeBytes: liveFile.sizeBytes,
          imageUrl: liveFile.imageUrl,
        };
      }
    }

    return result;
  },
};

export { getFileUploadSession };
