import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const MetaobjectFieldInputSchema = z.object({
  key: z.string().min(1).describe("Metaobject field key from the definition"),
  value: z.string().describe("Field value as a string")
});

const CreateMetaobjectInputSchema = z.object({
  type: z.string().min(1).describe("Metaobject definition type (for example 'size_chart')"),
  fields: z
    .array(MetaobjectFieldInputSchema)
    .min(1)
    .describe("Field values to set on the new entry"),
  handle: z
    .string()
    .min(1)
    .optional()
    .describe("Optional custom handle. Shopify auto-generates one if omitted"),
  status: z
    .enum(["ACTIVE", "DRAFT"])
    .optional()
    .describe(
      "Publish status for publishable definitions. Omit to use Shopify's default (DRAFT). Pass ACTIVE to create a published/usable entry."
    )
});

type CreateMetaobjectInput = z.infer<typeof CreateMetaobjectInputSchema>;

let shopifyClient: GraphQLClient;

type MetaobjectField = {
  key: string;
  value: string | null;
  type?: string | null;
};

function formatFields(fields: MetaobjectField[]) {
  return fields.map((field) => ({
    key: field.key,
    value: field.value,
    type: field.type ?? undefined
  }));
}

const createMetaobject = {
  name: "create-metaobject",
  description: "Create a new entry in an existing Shopify metaobject definition",
  schema: CreateMetaobjectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateMetaobjectInput) => {
    try {
      const mutation = gql`
        mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
          metaobjectCreate(metaobject: $metaobject) {
            metaobject {
              id
              type
              handle
              displayName
              updatedAt
              capabilities {
                publishable {
                  status
                }
              }
              fields {
                key
                value
                type
              }
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const metaobjectInput: {
        type: string;
        fields: Array<{ key: string; value: string }>;
        handle?: string;
        capabilities?: { publishable: { status: "ACTIVE" | "DRAFT" } };
      } = {
        type: input.type,
        fields: input.fields
      };

      if (input.handle) {
        metaobjectInput.handle = input.handle;
      }

      if (input.status) {
        metaobjectInput.capabilities = {
          publishable: { status: input.status }
        };
      }

      const data = (await shopifyClient.request(mutation, {
        metaobject: metaobjectInput
      })) as {
        metaobjectCreate: {
          metaobject: {
            id: string;
            type: string;
            handle: string;
            displayName: string | null;
            updatedAt: string;
            capabilities?: { publishable?: { status: string } | null } | null;
            fields: MetaobjectField[];
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
            code?: string;
          }>;
        };
      };

      if (data.metaobjectCreate.userErrors.length > 0) {
        throw new Error(
          data.metaobjectCreate.userErrors
            .map((error) =>
              error.code
                ? `${error.code}: ${error.message}`
                : error.message
            )
            .join(", ")
        );
      }

      if (!data.metaobjectCreate.metaobject) {
        throw new Error("Metaobject was not returned after creation");
      }

      const metaobject = data.metaobjectCreate.metaobject;

      return {
        success: true,
        metaobject: {
          id: metaobject.id,
          type: metaobject.type,
          handle: metaobject.handle,
          displayName: metaobject.displayName,
          status: metaobject.capabilities?.publishable?.status ?? null,
          updatedAt: metaobject.updatedAt,
          fields: formatFields(metaobject.fields)
        }
      };
    } catch (error) {
      console.error("Error creating metaobject:", error);
      throw new Error(
        `Failed to create metaobject: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { createMetaobject };
