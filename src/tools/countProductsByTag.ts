import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const CountProductsByTagInputSchema = z.object({
  tag: z.string().describe("Tag name to count (e.g. 'wiki-researched')"),
});

type CountProductsByTagInput = z.infer<typeof CountProductsByTagInputSchema>;

let shopifyClient: GraphQLClient;

const countProductsByTag = {
  name: "count-products-by-tag",
  description:
    "Get a count of products with and without a specific tag. Useful for tracking progress on bulk tagging operations.",
  schema: CountProductsByTagInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CountProductsByTagInput) => {
    try {
      const escapedTag = input.tag.replace(/"/g, '\\"');

      const query = gql`
        query CountProductsByTag {
          productsTotal: productsCount(limit: null) {
            count
            precision
          }
          productsTagged: productsCount(limit: null, query: "tag:${escapedTag}") {
            count
            precision
          }
        }
      `;

      const data = (await shopifyClient.request(query)) as {
        productsTotal: { count: number; precision: string };
        productsTagged: { count: number; precision: string };
      };

      return {
        tag: input.tag,
        tagged: data.productsTagged.count,
        total: data.productsTotal.count,
        untagged: data.productsTotal.count - data.productsTagged.count,
        precision: {
          total: data.productsTotal.precision,
          tagged: data.productsTagged.precision,
        },
      };
    } catch (error) {
      console.error("Error counting products by tag:", error);
      throw new Error(
        `Failed to count products by tag: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },
};

export { countProductsByTag };
