import { z } from "zod";

import { createUploadSession } from "../files/uploadSessions.js";
import type {
  DuplicateResolutionMode,
  RequestedUploadKind,
} from "../files/uploadUtils.js";

const CreateFileUploadSessionInputSchema = z.object({
  kind: z.enum(["AUTO", "IMAGE", "FILE"]).default("AUTO"),
  altText: z.string().optional(),
  duplicateResolutionMode: z
    .enum(["APPEND_UUID", "RAISE_ERROR", "REPLACE"])
    .default("APPEND_UUID"),
  expiresInMinutes: z.number().min(1).max(60).default(15),
});

type CreateFileUploadSessionInput = z.infer<
  typeof CreateFileUploadSessionInputSchema
>;

let remoteMode = false;
let publicAppUrl = "";

const createFileUploadSession = {
  name: "create-file-upload-session",
  description:
    "Create a short-lived browser upload session for Shopify Files uploads in remote mode",
  schema: CreateFileUploadSessionInputSchema,

  initialize(options: { remoteMode: boolean; publicAppUrl: string }) {
    remoteMode = options.remoteMode;
    publicAppUrl = options.publicAppUrl;
  },

  execute: async (input: CreateFileUploadSessionInput) => {
    if (!remoteMode) {
      throw new Error(
        "create-file-upload-session is only available when the MCP server is running in remote mode.",
      );
    }

    const session = createUploadSession({
      baseUrl: publicAppUrl,
      kind: input.kind as RequestedUploadKind,
      altText: input.altText,
      duplicateResolutionMode:
        input.duplicateResolutionMode as DuplicateResolutionMode,
      expiresInMinutes: input.expiresInMinutes,
    });

    return {
      sessionId: session.id,
      uploadUrl: session.uploadUrl,
      expiresAt: new Date(session.expiresAt).toISOString(),
      kind: input.kind,
      instructions:
        "Open the uploadUrl in a browser, choose a file, and submit it. Then use get-file-upload-session to check the result.",
    };
  },
};

export { createFileUploadSession };
