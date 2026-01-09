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

// Input schema for creating a collection
const CreateCollectionInputSchema = z.object({
  title: z.string().min(1).describe("Collection title"),
  descriptionHtml: z.string().optional().describe("HTML description"),
  handle: z.string().optional().describe("URL handle (auto-generated if not provided)"),
  image: ImageSchema.optional().describe("Collection image"),

  // For custom collections - manually add products
  productIds: z.array(z.string()).optional().describe("Product IDs to add (for custom collections)"),

  // For smart collections - auto-add by rules
  rules: z.array(RuleSchema).optional().describe("Rules for smart collection auto-population"),
  rulesApplyDisjunctively: z.boolean().default(false).describe("true = OR logic, false = AND logic (default)"),

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

type CreateCollectionInput = z.infer<typeof CreateCollectionInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const createCollection = {
  name: "create-collection",
  description: "Create a custom or smart collection. Smart collections auto-populate based on rules (tag, vendor, price, etc.)",
  schema: CreateCollectionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateCollectionInput) => {
    try {
      const query = gql`
        mutation collectionCreate($input: CollectionInput!) {
          collectionCreate(input: $input) {
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
        title: input.title
      };

      if (input.descriptionHtml) collectionInput.descriptionHtml = input.descriptionHtml;
      if (input.handle) collectionInput.handle = input.handle;
      if (input.sortOrder) collectionInput.sortOrder = input.sortOrder;

      // Add image if provided
      if (input.image) {
        collectionInput.image = {
          src: input.image.src,
          altText: input.image.altText
        };
      }

      // Add rules for smart collection
      if (input.rules && input.rules.length > 0) {
        collectionInput.ruleSet = {
          appliedDisjunctively: input.rulesApplyDisjunctively,
          rules: input.rules.map(rule => ({
            column: rule.column,
            relation: rule.relation,
            condition: rule.condition
          }))
        };
      }

      // Add products for custom collection
      if (input.productIds && input.productIds.length > 0) {
        collectionInput.products = input.productIds;
      }

      const variables = { input: collectionInput };

      const data = (await shopifyClient.request(query, variables)) as {
        collectionCreate: {
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
      if (data.collectionCreate.userErrors.length > 0) {
        throw new Error(
          `Failed to create collection: ${data.collectionCreate.userErrors
            .map((e) => `${e.field.join(".")}: ${e.message}`)
            .join(", ")}`
        );
      }

      if (!data.collectionCreate.collection) {
        throw new Error("Collection creation returned no collection");
      }

      const collection = data.collectionCreate.collection;
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
      console.error("Error creating collection:", error);
      throw new Error(
        `Failed to create collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { createCollection };
