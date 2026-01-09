import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for createRedirect
const CreateRedirectInputSchema = z.object({
  path: z.string().min(1).describe("Source path to redirect from (e.g., /products/old-product)"),
  target: z.string().min(1).describe("Target URL to redirect to (e.g., /products/new-product or full URL)")
});

type CreateRedirectInput = z.infer<typeof CreateRedirectInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const createRedirect = {
  name: "create-redirect",
  description: "Create a URL redirect (useful when deleting products to preserve SEO)",
  schema: CreateRedirectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateRedirectInput) => {
    try {
      // Ensure path starts with /
      const path = input.path.startsWith("/") ? input.path : `/${input.path}`;

      const query = gql`
        mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
          urlRedirectCreate(urlRedirect: $urlRedirect) {
            urlRedirect {
              id
              path
              target
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        urlRedirect: {
          path,
          target: input.target
        }
      })) as {
        urlRedirectCreate: {
          urlRedirect: {
            id: string;
            path: string;
            target: string;
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.urlRedirectCreate.userErrors.length > 0) {
        throw new Error(
          `Failed to create redirect: ${data.urlRedirectCreate.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      if (!data.urlRedirectCreate.urlRedirect) {
        throw new Error("Redirect creation returned no redirect");
      }

      return {
        success: true,
        redirect: data.urlRedirectCreate.urlRedirect,
        message: `Created redirect: ${path} → ${input.target}`
      };
    } catch (error) {
      console.error("Error creating redirect:", error);
      throw new Error(
        `Failed to create redirect: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { createRedirect };
