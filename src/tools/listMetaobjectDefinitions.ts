import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import { formatDefinition } from "./metaobjectDefinitionUtils.js";

const ListMetaobjectDefinitionsInputSchema = z.object({
  limit: z
    .number()
    .default(25)
    .describe("Maximum number of metaobject definitions to return (max 250)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor for fetching the next page")
});

type ListMetaobjectDefinitionsInput = z.infer<
  typeof ListMetaobjectDefinitionsInputSchema
>;

let shopifyClient: GraphQLClient;

const listMetaobjectDefinitions = {
  name: "list-metaobject-definitions",
  description:
    "List available Shopify metaobject definitions so you can discover which types and fields exist before creating entries",
  schema: ListMetaobjectDefinitionsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: ListMetaobjectDefinitionsInput) => {
    try {
      const query = gql`
        query ListMetaobjectDefinitions($first: Int!, $after: String) {
          metaobjectDefinitions(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                type
                name
                description
                displayNameKey
                metaobjectsCount
                access {
                  admin
                  storefront
                }
                capabilities {
                  publishable {
                    enabled
                  }
                  translatable {
                    enabled
                  }
                  renderable {
                    enabled
                  }
                }
                fieldDefinitions {
                  key
                  name
                  description
                  required
                  type {
                    name
                  }
                  validations {
                    name
                    value
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
        first: Math.min(input.limit, 250),
        after: input.cursor
      })) as {
        metaobjectDefinitions: {
          edges: Array<{
            cursor: string;
            node: Parameters<typeof formatDefinition>[0];
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };

      return {
        definitions: data.metaobjectDefinitions.edges.map((edge) =>
          formatDefinition(edge.node)
        ),
        pageInfo: {
          hasNextPage: data.metaobjectDefinitions.pageInfo.hasNextPage,
          nextCursor: data.metaobjectDefinitions.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error listing metaobject definitions:", error);
      throw new Error(
        `Failed to list metaobject definitions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { listMetaobjectDefinitions };
