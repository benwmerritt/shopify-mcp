import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const FindProductsByMetafieldInputSchema = z.object({
  namespace: z.string().min(1).describe("Metafield namespace (e.g., 'custom')"),
  key: z.string().min(1).describe("Metafield key"),
  present: z
    .enum(["with", "without", "both"])
    .default("with")
    .describe(
      "Return products that HAVE the metafield set ('with'), that do NOT have it ('without'), or partition into both ('both')"
    ),
  query: z
    .string()
    .optional()
    .describe(
      "Optional base Shopify product filter to narrow the scan (e.g., \"status:active\")"
    ),
  limit: z
    .number()
    .default(50)
    .describe("Products to scan per page (max 250)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from a previous call to continue scanning")
});

type FindProductsByMetafieldInput = z.infer<
  typeof FindProductsByMetafieldInputSchema
>;

let shopifyClient: GraphQLClient;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  metafield: {
    id: string;
    value: string | null;
    type: string | null;
  } | null;
};

const findProductsByMetafield = {
  name: "find-products-by-metafield",
  description:
    "List products that have, or do not have, a specific metafield set. Scans the catalog page by page (use the returned nextCursor to continue) since metafield-absence is not a server-side filter. Use 'present' to choose with/without/both.",
  schema: FindProductsByMetafieldInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: FindProductsByMetafieldInput) => {
    try {
      const query = gql`
        query FindProductsByMetafield(
          $first: Int!
          $query: String
          $after: String
          $namespace: String!
          $key: String!
        ) {
          products(first: $first, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                handle
                status
                metafield(namespace: $namespace, key: $key) {
                  id
                  value
                  type
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
        query: input.query,
        after: input.cursor,
        namespace: input.namespace,
        key: input.key
      })) as {
        products: {
          edges: Array<{ cursor: string; node: ProductNode }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };

      const scanned = data.products.edges.map((edge) => edge.node);

      const withMetafield = scanned
        .filter((node) => node.metafield !== null)
        .map((node) => ({
          id: node.id,
          title: node.title,
          handle: node.handle,
          status: node.status,
          metafield: node.metafield
        }));

      const withoutMetafield = scanned
        .filter((node) => node.metafield === null)
        .map((node) => ({
          id: node.id,
          title: node.title,
          handle: node.handle,
          status: node.status
        }));

      const pageInfo = {
        hasNextPage: data.products.pageInfo.hasNextPage,
        nextCursor: data.products.pageInfo.endCursor,
        scannedThisPage: scanned.length
      };

      if (input.present === "both") {
        return {
          metafield: `${input.namespace}.${input.key}`,
          withMetafield,
          withoutMetafield,
          pageInfo
        };
      }

      return {
        metafield: `${input.namespace}.${input.key}`,
        present: input.present,
        products: input.present === "with" ? withMetafield : withoutMetafield,
        pageInfo
      };
    } catch (error) {
      console.error("Error finding products by metafield:", error);
      throw new Error(
        `Failed to find products by metafield: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { findProductsByMetafield };
