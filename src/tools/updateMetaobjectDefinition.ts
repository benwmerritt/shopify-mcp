import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

import { formatDefinition } from "./metaobjectDefinitionUtils.js";

const MetaobjectDefinitionFieldCreateSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe("New field key (2-64 alphanumeric, hyphen, or underscore characters)"),
  name: z.string().min(1).optional().describe("Human-readable field name"),
  description: z.string().optional().describe("Administrative field description"),
  type: z.string().min(1).describe("Shopify metafield type, for example 'json'"),
  required: z.boolean().optional().describe("Whether a value is required"),
  validations: z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .optional()
    .describe("Shopify validation name/value pairs"),
});

const UpdateMetaobjectDefinitionInputSchema = z.object({
  id: z.string().min(1).describe("Metaobject definition global ID"),
  fields: z
    .array(MetaobjectDefinitionFieldCreateSchema)
    .min(1)
    .describe("Fields to add; this tool only performs additive field creation"),
});

type UpdateMetaobjectDefinitionInput = z.infer<
  typeof UpdateMetaobjectDefinitionInputSchema
>;

type Definition = Parameters<typeof formatDefinition>[0];

type UserError = { field: string[]; message: string; code?: string | null };

let shopifyClient: GraphQLClient;

const definitionSelection = gql`
  fragment MetaobjectDefinitionFields on MetaobjectDefinition {
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
      publishable { enabled }
      translatable { enabled }
      renderable { enabled }
    }
    fieldDefinitions {
      key
      name
      description
      required
      type { name }
      validations { name value }
    }
  }
`;

function assertSubmittedFieldsVerified(
  definition: Definition,
  submitted: UpdateMetaobjectDefinitionInput["fields"],
): void {
  for (const field of submitted) {
    const actual = definition.fieldDefinitions.find(({ key }) => key === field.key);
    if (!actual) {
      throw new Error(`Verification failed: field '${field.key}' was not returned`);
    }
    const expectedValidations = (field.validations ?? []).map(({ name, value }) => ({
      name,
      value,
    }));
    const actualValidations = (actual.validations ?? []).map(({ name, value }) => ({
      name,
      value: value ?? null,
    }));
    if (
      actual.name !== (field.name ?? actual.name) ||
      actual.description !== (field.description ?? null) ||
      actual.type?.name !== field.type ||
      (field.required !== undefined && actual.required !== field.required) ||
      JSON.stringify(actualValidations) !== JSON.stringify(expectedValidations)
    ) {
      throw new Error(`Verification failed: field '${field.key}' does not match submitted values`);
    }
  }
}

const updateMetaobjectDefinition = {
  name: "update-metaobject-definition",
  description:
    "Add fields to an existing Shopify metaobject definition. This typed tool is additive-only and independently verifies every created field.",
  schema: UpdateMetaobjectDefinitionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpdateMetaobjectDefinitionInput) => {
    try {
      const mutation = gql`
        mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
          metaobjectDefinitionUpdate(id: $id, definition: $definition) {
            metaobjectDefinition {
              ...MetaobjectDefinitionFields
            }
            userErrors { field message code }
          }
        }
        ${definitionSelection}
      `;
      const data = (await shopifyClient.request(mutation, {
        id: input.id,
        definition: {
          fieldDefinitions: input.fields.map((field) => ({
            create: {
              key: field.key,
              ...(field.name !== undefined ? { name: field.name } : {}),
              ...(field.description !== undefined ? { description: field.description } : {}),
              type: field.type,
              ...(field.required !== undefined ? { required: field.required } : {}),
              ...(field.validations !== undefined ? { validations: field.validations } : {}),
            },
          })),
        },
      })) as {
        metaobjectDefinitionUpdate: {
          metaobjectDefinition: Definition | null;
          userErrors: UserError[];
        };
      };
      const mutationResult = data.metaobjectDefinitionUpdate;
      if (mutationResult.userErrors.length > 0) {
        throw new Error(
          mutationResult.userErrors
            .map((error) => (error.code ? `${error.code}: ${error.message}` : error.message))
            .join(", "),
        );
      }

      const verificationQuery = gql`
        query GetMetaobjectDefinitionById($id: ID!) {
          metaobjectDefinition(id: $id) {
            ...MetaobjectDefinitionFields
          }
        }
        ${definitionSelection}
      `;
      const verification = (await shopifyClient.request(verificationQuery, { id: input.id })) as {
        metaobjectDefinition: Definition | null;
      };
      if (!verification.metaobjectDefinition) {
        throw new Error("Metaobject definition was not returned during verification");
      }
      const verified = formatDefinition(verification.metaobjectDefinition);
      assertSubmittedFieldsVerified(verification.metaobjectDefinition, input.fields);

      return {
        success: true,
        mutation: {
          metaobjectDefinition: mutationResult.metaobjectDefinition
            ? formatDefinition(mutationResult.metaobjectDefinition)
            : null,
          userErrors: mutationResult.userErrors,
        },
        verified,
      };
    } catch (error) {
      console.error("Error updating metaobject definition:", error);
      throw new Error(
        `Failed to update metaobject definition: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export { updateMetaobjectDefinition };
export type { UpdateMetaobjectDefinitionInput };
