import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getBulkOperationResults
const GetBulkOperationResultsInputSchema = z.object({
  operationId: z.string().optional().describe("Specific operation ID. If omitted, uses the most recent completed operation."),
  format: z.enum(["summary", "sample", "full"]).default("summary").describe("Output format: 'summary' (metadata only), 'sample' (first N objects), 'full' (up to 1000 objects)"),
  sampleSize: z.number().default(10).describe("Number of objects to return for 'sample' format (default 10)")
});

type GetBulkOperationResultsInput = z.infer<typeof GetBulkOperationResultsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const MAX_FULL_OBJECTS = 1000;

const getBulkOperationResults = {
  name: "get-bulk-operation-results",
  description: "Download and parse results from a completed bulk operation. Returns summary, sample, or full data (capped at 1000 objects).",
  schema: GetBulkOperationResultsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetBulkOperationResultsInput) => {
    try {
      // First, get the operation status
      let operationData: {
        id: string;
        status: string;
        objectCount: string;
        fileSize: string | null;
        url: string | null;
        completedAt: string | null;
        errorCode: string | null;
      } | null;

      if (input.operationId) {
        // Query specific operation by ID
        const query = gql`
          query GetBulkOperation($id: ID!) {
            node(id: $id) {
              ... on BulkOperation {
                id
                status
                objectCount
                fileSize
                url
                completedAt
                errorCode
              }
            }
          }
        `;

        const result = (await shopifyClient.request(query, { id: input.operationId })) as {
          node: typeof operationData;
        };
        operationData = result.node;
      } else {
        // Query current/most recent operation
        const query = gql`
          query CurrentBulkOperation {
            currentBulkOperation {
              id
              status
              objectCount
              fileSize
              url
              completedAt
              errorCode
            }
          }
        `;

        const result = (await shopifyClient.request(query)) as {
          currentBulkOperation: typeof operationData;
        };
        operationData = result.currentBulkOperation;
      }

      if (!operationData) {
        return {
          success: false,
          error: input.operationId
            ? `No bulk operation found with ID: ${input.operationId}`
            : "No bulk operation found."
        };
      }

      // Check if operation is completed
      if (operationData.status !== "COMPLETED") {
        return {
          success: false,
          error: `Operation is not completed. Current status: ${operationData.status}`,
          operationId: operationData.id,
          status: operationData.status,
          errorCode: operationData.errorCode
        };
      }

      // Check if URL exists
      if (!operationData.url) {
        return {
          success: false,
          error: "Operation completed but no download URL available. The results may have expired (7 day limit).",
          operationId: operationData.id,
          status: operationData.status
        };
      }

      const totalObjects = parseInt(operationData.objectCount, 10);
      const fileSize = operationData.fileSize ? parseInt(operationData.fileSize, 10) : null;

      // Format file size for display
      let fileSizeFormatted: string | null = null;
      if (fileSize) {
        if (fileSize > 1024 * 1024) {
          fileSizeFormatted = `${(fileSize / (1024 * 1024)).toFixed(2)} MB`;
        } else if (fileSize > 1024) {
          fileSizeFormatted = `${(fileSize / 1024).toFixed(2)} KB`;
        } else {
          fileSizeFormatted = `${fileSize} bytes`;
        }
      }

      // Calculate expiration (7 days from completion)
      let expiresAt: string | null = null;
      if (operationData.completedAt) {
        const completedDate = new Date(operationData.completedAt);
        completedDate.setDate(completedDate.getDate() + 7);
        expiresAt = completedDate.toISOString();
      }

      // For summary format, don't download the file
      if (input.format === "summary") {
        return {
          success: true,
          format: "summary",
          operationId: operationData.id,
          summary: {
            totalObjects,
            fileSize: fileSizeFormatted,
            fileSizeBytes: fileSize,
            downloadUrl: operationData.url,
            completedAt: operationData.completedAt,
            expiresAt
          }
        };
      }

      // For sample and full formats, download and parse the JSONL
      const response = await fetch(operationData.url);
      if (!response.ok) {
        throw new Error(`Failed to download results: ${response.status} ${response.statusText}`);
      }

      const jsonlContent = await response.text();
      const lines = jsonlContent.trim().split("\n");
      const objects: unknown[] = [];

      // Determine how many objects to parse
      const limit = input.format === "sample"
        ? Math.min(input.sampleSize, lines.length)
        : Math.min(MAX_FULL_OBJECTS, lines.length);

      for (let i = 0; i < limit; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          objects.push(parsed);
        } catch {
          // Skip malformed lines
          console.warn(`Skipping malformed JSONL line ${i + 1}`);
        }
      }

      if (input.format === "sample") {
        return {
          success: true,
          format: "sample",
          operationId: operationData.id,
          sampleSize: objects.length,
          totalObjects,
          sample: objects,
          downloadUrl: operationData.url,
          expiresAt
        };
      }

      // Full format
      return {
        success: true,
        format: "full",
        operationId: operationData.id,
        objectCount: objects.length,
        totalObjects,
        truncated: totalObjects > MAX_FULL_OBJECTS,
        data: objects,
        downloadUrl: operationData.url,
        expiresAt,
        note: totalObjects > MAX_FULL_OBJECTS
          ? `Results truncated to ${MAX_FULL_OBJECTS} objects. Download the full JSONL file for complete data.`
          : undefined
      };
    } catch (error) {
      console.error("Error getting bulk operation results:", error);
      throw new Error(
        `Failed to get bulk operation results: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getBulkOperationResults };
