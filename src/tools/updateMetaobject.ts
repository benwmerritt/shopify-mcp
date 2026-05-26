import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const MetaobjectFieldInputSchema = z.object({
  key: z.string().min(1).describe("Metaobject field key from the definition"),
  value: z.string().describe("Field value as a string")
});

const UpdateMetaobjectInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Metaobject entry ID to update (numeric or full GID)"),
  fields: z
    .array(MetaobjectFieldInputSchema)
    .min(1)
    .describe(
      "Field values to set. Only the keys you provide are changed; other fields keep their current values."
    ),
  handle: z
    .string()
    .min(1)
    .optional()
    .describe("Optional new handle for the entry")
});

type UpdateMetaobjectInput = z.infer<typeof UpdateMetaobjectInputSchema>;

let shopifyClient: GraphQLClient;

type MetaobjectField = {
  key: string;
  value: string | null;
  type?: string | null;
};

function normalizeMetaobjectId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }

  return `gid://shopify/Metaobject/${id}`;
}

function formatFields(fields: MetaobjectField[]) {
  return fields.map((field) => ({
    key: field.key,
    value: field.value,
    type: field.type ?? undefined
  }));
}

const updateMetaobject = {
  name: "update-metaobject",
  description:
    "Update fields on an existing Shopify metaobject entry. Only the fields you pass are changed; omitted fields keep their current values.",
  schema: UpdateMetaobjectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateMetaobjectInput) => {
    try {
      const mutation = gql`
        mutation UpdateMetaobject(
          $id: ID!
          $metaobject: MetaobjectUpdateInput!
        ) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            metaobject {
              id
              type
              handle
              displayName
              updatedAt
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
        fields: Array<{ key: string; value: string }>;
        handle?: string;
      } = {
        fields: input.fields
      };

      if (input.handle) {
        metaobjectInput.handle = input.handle;
      }

      const data = (await shopifyClient.request(mutation, {
        id: normalizeMetaobjectId(input.id),
        metaobject: metaobjectInput
      })) as {
        metaobjectUpdate: {
          metaobject: {
            id: string;
            type: string;
            handle: string;
            displayName: string | null;
            updatedAt: string;
            fields: MetaobjectField[];
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
            code?: string;
          }>;
        };
      };

      if (data.metaobjectUpdate.userErrors.length > 0) {
        throw new Error(
          data.metaobjectUpdate.userErrors
            .map((error) =>
              error.code ? `${error.code}: ${error.message}` : error.message
            )
            .join(", ")
        );
      }

      if (!data.metaobjectUpdate.metaobject) {
        throw new Error("Metaobject was not returned after update");
      }

      const metaobject = data.metaobjectUpdate.metaobject;

      return {
        success: true,
        metaobject: {
          id: metaobject.id,
          type: metaobject.type,
          handle: metaobject.handle,
          displayName: metaobject.displayName,
          updatedAt: metaobject.updatedAt,
          fields: formatFields(metaobject.fields)
        }
      };
    } catch (error) {
      console.error("Error updating metaobject:", error);
      throw new Error(
        `Failed to update metaobject: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { updateMetaobject };
