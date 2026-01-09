import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Rule schema for smart collections
const RuleSchema = z.object({
  column: z.enum([
    "TAG",
    "VENDOR",
    "TYPE",
    "TITLE",
    "VARIANT_PRICE",
    "VARIANT_INVENTORY",
    "IS_PRICE_REDUCED"
  ]).describe("Field to filter products by"),
  relation: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "CONTAINS",
    "NOT_CONTAINS",
    "STARTS_WITH",
    "ENDS_WITH",
    "GREATER_THAN",
    "LESS_THAN"
  ]).describe("Comparison relation"),
  condition: z.string().describe("Value to compare against")
});

// Image schema
const ImageSchema = z.object({
  src: z.string().describe("URL of the image"),
  altText: z.string().optional().describe("Alt text for accessibility")
});

// Input schema for updating a collection
const UpdateCollectionInputSchema = z.object({
  id: z.string().min(1).describe("Collection ID to update"),
  title: z.string().optional().describe("New collection title"),
  descriptionHtml: z.string().optional().describe("New HTML description"),
  handle: z.string().optional().describe("New URL handle"),
  image: ImageSchema.optional().describe("New collection image"),

  // For smart collections - update rules
  rules: z.array(RuleSchema).optional().describe("New rules for smart collection (replaces existing)"),
  rulesApplyDisjunctively: z.boolean().optional().describe("true = OR logic, false = AND logic"),

  // Sort order
  sortOrder: z.enum([
    "MANUAL",
    "BEST_SELLING",
    "ALPHA_ASC",
    "ALPHA_DESC",
    "CREATED_DESC",
    "CREATED",
    "PRICE_DESC",
    "PRICE_ASC"
  ]).optional().describe("How products are sorted in the collection")
});

type UpdateCollectionInput = z.infer<typeof UpdateCollectionInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const updateCollection = {
  name: "update-collection",
  description: "Update an existing collection's title, description, image, rules, or sort order",
  schema: UpdateCollectionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateCollectionInput) => {
    try {
      const query = gql`
        mutation collectionUpdate($input: CollectionInput!) {
          collectionUpdate(input: $input) {
            collection {
              id
              title
              handle
              descriptionHtml
              sortOrder
              ruleSet {
                appliedDisjunctively
                rules {
                  column
                  relation
                  condition
                }
              }
              productsCount {
                count
              }
              image {
                id
                url
                altText
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      // Build the collection input
      const collectionInput: Record<string, unknown> = {
        id: input.id
      };

      if (input.title !== undefined) collectionInput.title = input.title;
      if (input.descriptionHtml !== undefined) collectionInput.descriptionHtml = input.descriptionHtml;
      if (input.handle !== undefined) collectionInput.handle = input.handle;
      if (input.sortOrder !== undefined) collectionInput.sortOrder = input.sortOrder;

      // Add image if provided
      if (input.image) {
        collectionInput.image = {
          src: input.image.src,
          altText: input.image.altText
        };
      }

      // Update rules for smart collection
      if (input.rules !== undefined) {
        collectionInput.ruleSet = {
          appliedDisjunctively: input.rulesApplyDisjunctively ?? false,
          rules: input.rules.map(rule => ({
            column: rule.column,
            relation: rule.relation,
            condition: rule.condition
          }))
        };
      }

      const variables = { input: collectionInput };

      const data = (await shopifyClient.request(query, variables)) as {
        collectionUpdate: {
          collection: {
            id: string;
            title: string;
            handle: string;
            descriptionHtml: string;
            sortOrder: string;
            ruleSet: {
              appliedDisjunctively: boolean;
              rules: Array<{
                column: string;
                relation: string;
                condition: string;
              }>;
            } | null;
            productsCount: {
              count: number;
            };
            image: {
              id: string;
              url: string;
              altText: string | null;
            } | null;
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      // Check for errors
      if (data.collectionUpdate.userErrors.length > 0) {
        throw new Error(
          `Failed to update collection: ${data.collectionUpdate.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      if (!data.collectionUpdate.collection) {
        throw new Error("Collection update returned no collection");
      }

      const collection = data.collectionUpdate.collection;
      return {
        collection: {
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
          descriptionHtml: collection.descriptionHtml,
          sortOrder: collection.sortOrder,
          isSmartCollection: collection.ruleSet !== null,
          ruleSet: collection.ruleSet,
          productsCount: collection.productsCount.count,
          image: collection.image
        }
      };
    } catch (error) {
      console.error("Error updating collection:", error);
      throw new Error(
        `Failed to update collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateCollection };
