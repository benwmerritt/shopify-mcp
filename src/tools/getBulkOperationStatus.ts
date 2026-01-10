import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getBulkOperationStatus
const GetBulkOperationStatusInputSchema = z.object({
  operationId: z.string().optional().describe("Specific operation ID to check. If omitted, checks the current/most recent operation.")
});

type GetBulkOperationStatusInput = z.infer<typeof GetBulkOperationStatusInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getBulkOperationStatus = {
  name: "get-bulk-operation-status",
  description: "Check the status of a bulk operation. Returns progress info and download URL when complete.",
  schema: GetBulkOperationStatusInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetBulkOperationStatusInput) => {
    try {
      let data: {
        id: string;
        status: string;
        type: string;
        createdAt: string;
        completedAt: string | null;
        objectCount: string;
        fileSize: string | null;
        url: string | null;
        partialDataUrl: string | null;
        errorCode: string | null;
        query: string | null;
      } | null;

      if (input.operationId) {
        // Query specific operation by ID
        const query = gql`
          query GetBulkOperation($id: ID!) {
            node(id: $id) {
              ... on BulkOperation {
                id
                status
                type
                createdAt
                completedAt
                objectCount
                fileSize
                url
                partialDataUrl
                errorCode
                query
              }
            }
          }
        `;

        const result = (await shopifyClient.request(query, { id: input.operationId })) as {
          node: typeof data;
        };
        data = result.node;
      } else {
        // Query current/most recent operation
        const query = gql`
          query CurrentBulkOperation {
            currentBulkOperation {
              id
              status
              type
              createdAt
              completedAt
              objectCount
              fileSize
              url
              partialDataUrl
              errorCode
              query
            }
          }
        `;

        const result = (await shopifyClient.request(query)) as {
          currentBulkOperation: typeof data;
        };
        data = result.currentBulkOperation;
      }

      if (!data) {
        return {
          found: false,
          message: input.operationId
            ? `No bulk operation found with ID: ${input.operationId}`
            : "No bulk operation currently running or recently completed."
        };
      }

      // Format fileSize for readability
      let fileSizeFormatted: string | null = null;
      if (data.fileSize) {
        const bytes = parseInt(data.fileSize, 10);
        if (bytes > 1024 * 1024) {
          fileSizeFormatted = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } else if (bytes > 1024) {
          fileSizeFormatted = `${(bytes / 1024).toFixed(2)} KB`;
        } else {
          fileSizeFormatted = `${bytes} bytes`;
        }
      }

      // Build progress message
      let progressMessage: string;
      switch (data.status) {
        case "CREATED":
          progressMessage = "Operation created, waiting to start...";
          break;
        case "RUNNING":
          progressMessage = `Processing ${data.objectCount} objects...`;
          break;
        case "COMPLETED":
          progressMessage = `Completed! ${data.objectCount} objects exported.`;
          break;
        case "FAILED":
          progressMessage = `Failed with error: ${data.errorCode || "Unknown error"}`;
          break;
        case "CANCELED":
          progressMessage = "Operation was canceled.";
          break;
        default:
          progressMessage = `Status: ${data.status}`;
      }

      return {
        found: true,
        id: data.id,
        status: data.status,
        type: data.type,
        createdAt: data.createdAt,
        completedAt: data.completedAt,
        objectCount: parseInt(data.objectCount, 10),
        fileSize: fileSizeFormatted,
        fileSizeBytes: data.fileSize ? parseInt(data.fileSize, 10) : null,
        url: data.url,
        partialDataUrl: data.partialDataUrl,
        errorCode: data.errorCode,
        progress: progressMessage,
        isComplete: data.status === "COMPLETED",
        isFailed: data.status === "FAILED",
        isRunning: data.status === "RUNNING" || data.status === "CREATED"
      };
    } catch (error) {
      console.error("Error checking bulk operation status:", error);
      throw new Error(
        `Failed to check bulk operation status: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getBulkOperationStatus };
