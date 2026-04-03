import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import { formatDefinition } from "./metaobjectDefinitionUtils.js";

const GetMetaobjectDefinitionInputSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe("Metaobject definition type to inspect (for example 'size_chart')")
});

type GetMetaobjectDefinitionInput = z.infer<
  typeof GetMetaobjectDefinitionInputSchema
>;

let shopifyClient: GraphQLClient;

const getMetaobjectDefinition = {
  name: "get-metaobject-definition",
  description:
    "Inspect a single Shopify metaobject definition by type, including description, access, capabilities, and field definitions",
  schema: GetMetaobjectDefinitionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetMetaobjectDefinitionInput) => {
    try {
      const query = gql`
        query GetMetaobjectDefinition($type: String!) {
          metaobjectDefinitionByType(type: $type) {
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
      `;

      const data = (await shopifyClient.request(query, {
        type: input.type
      })) as {
        metaobjectDefinitionByType: Parameters<typeof formatDefinition>[0] | null;
      };

      if (!data.metaobjectDefinitionByType) {
        throw new Error(`Metaobject definition not found for type: ${input.type}`);
      }

      return {
        definition: formatDefinition(data.metaobjectDefinitionByType)
      };
    } catch (error) {
      console.error("Error fetching metaobject definition:", error);
      throw new Error(
        `Failed to fetch metaobject definition: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getMetaobjectDefinition };
