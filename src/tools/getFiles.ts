import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import { mapShopifyFileNode } from "../files/shopifyFiles.js";

const GetFilesInputSchema = z.object({
  query: z.string().optional().describe("Shopify file search query"),
  limit: z.number().min(1).max(250).default(50),
  cursor: z.string().optional().describe("Pagination cursor"),
  sortKey: z
    .enum([
      "CREATED_AT",
      "FILENAME",
      "ID",
      "ORIGINAL_UPLOAD_SIZE",
      "RELEVANCE",
      "UPDATED_AT",
    ])
    .default("UPDATED_AT"),
  reverse: z.boolean().default(true),
});

type GetFilesInput = z.infer<typeof GetFilesInputSchema>;

let shopifyClient: GraphQLClient;

const getFiles = {
  name: "get-files",
  description:
    "List Shopify Files library entries, including uploaded images and generic documents",
  schema: GetFilesInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetFilesInput) => {
    const query = gql`
      query GetFiles(
        $first: Int!
        $after: String
        $query: String
        $sortKey: FileSortKeys
        $reverse: Boolean
      ) {
        files(
          first: $first
          after: $after
          query: $query
          sortKey: $sortKey
          reverse: $reverse
        ) {
          edges {
            cursor
            node {
              __typename
              ... on MediaImage {
                id
                alt
                fileStatus
                createdAt
                updatedAt
                mimeType
                image {
                  url
                }
                preview {
                  image {
                    url
                  }
                }
              }
              ... on GenericFile {
                id
                alt
                fileStatus
                createdAt
                updatedAt
                mimeType
                originalFileSize
                url
                preview {
                  image {
                    url
                  }
                }
              }
              ... on Video {
                id
                alt
                fileStatus
                createdAt
                updatedAt
                preview {
                  image {
                    url
                  }
                }
              }
              ... on Model3d {
                id
                alt
                fileStatus
                createdAt
                updatedAt
                preview {
                  image {
                    url
                  }
                }
              }
              ... on ExternalVideo {
                id
                alt
                fileStatus
                createdAt
                updatedAt
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const data = (await shopifyClient.request(query, {
      first: input.limit,
      after: input.cursor,
      query: input.query,
      sortKey: input.sortKey,
      reverse: input.reverse,
    })) as {
      files: {
        edges: Array<{ cursor: string; node: unknown }>;
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    };

    const files = data.files.edges
      .map((edge) => {
        const mapped = mapShopifyFileNode(edge.node);
        if (!mapped) {
          return null;
        }

        return {
          cursor: edge.cursor,
          ...mapped,
        };
      })
      .filter((file): file is NonNullable<typeof file> => file !== null);

    return {
      files,
      totalCount: files.length,
      pageInfo: {
        hasNextPage: data.files.pageInfo.hasNextPage,
        nextCursor: data.files.pageInfo.endCursor,
      },
    };
  },
};

export { getFiles };
