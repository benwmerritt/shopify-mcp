import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const MetafieldOwnerTypeSchema = z.enum([
  "PRODUCT",
  "PRODUCTVARIANT",
  "CUSTOMER",
  "ORDER",
  "COLLECTION",
  "SHOP",
]);

const CreateMetafieldDefinitionInputSchema = z.object({
  name: z.string().min(1).describe("Human-readable metafield definition name"),
  namespace: z.string().min(1).describe("Metafield namespace, for example 'custom'"),
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe("Metafield key (2-64 alphanumeric, hyphen, or underscore characters)"),
  ownerType: MetafieldOwnerTypeSchema.describe("Resource type that owns the metafield"),
  type: z.string().min(1).describe("Shopify metafield type, for example 'number_decimal'"),
  description: z.string().optional().describe("Administrative description"),
  validations: z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .optional()
    .describe("Optional Shopify validation name/value pairs"),
});

type CreateMetafieldDefinitionInput = z.infer<
  typeof CreateMetafieldDefinitionInputSchema
>;

type Definition = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  description: string | null;
  type: { name: string; category: string };
  ownerType: string;
  pinnedPosition: number | null;
  validations: Array<{ name: string; type: string; value: string | null }>;
  access: { admin: string; storefront: string };
};

type UserError = { field: string[]; message: string; code?: string | null };

let shopifyClient: GraphQLClient;

const definitionSelection = gql`
  fragment MetafieldDefinitionFields on MetafieldDefinition {
    id
    name
    namespace
    key
    description
    type { name category }
    ownerType
    pinnedPosition
    validations { name type value }
    access { admin storefront }
  }
`;

function formatDefinition(definition: Definition) {
  return {
    id: definition.id,
    name: definition.name,
    namespace: definition.namespace,
    key: definition.key,
    fullKey: `${definition.namespace}.${definition.key}`,
    description: definition.description,
    type: definition.type,
    ownerType: definition.ownerType,
    pinnedPosition: definition.pinnedPosition,
    validations: definition.validations,
    access: definition.access,
  };
}

function assertDefinitionVerified(
  definition: Definition,
  input: CreateMetafieldDefinitionInput,
): void {
  const expectedValidations = input.validations ?? [];
  const actualValidations = definition.validations.map(({ name, value }) => ({
    name,
    value: value ?? "",
  }));
  if (
    definition.name !== input.name ||
    definition.namespace !== input.namespace ||
    definition.key !== input.key ||
    definition.ownerType !== input.ownerType ||
    definition.type.name !== input.type ||
    definition.description !== (input.description ?? null) ||
    JSON.stringify(actualValidations) !== JSON.stringify(expectedValidations)
  ) {
    throw new Error(
      `Verification failed: metafield definition '${input.namespace}.${input.key}' does not match submitted values`,
    );
  }
}

const createMetafieldDefinition = {
  name: "create-metafield-definition",
  description:
    "Create a Shopify metafield definition and independently verify the exact created schema through a fresh read.",
  schema: CreateMetafieldDefinitionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateMetafieldDefinitionInput) => {
    try {
      const mutation = gql`
        mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { ...MetafieldDefinitionFields }
            userErrors { field message code }
          }
        }
        ${definitionSelection}
      `;
      const data = (await shopifyClient.request(mutation, {
        definition: {
          name: input.name,
          namespace: input.namespace,
          key: input.key,
          ownerType: input.ownerType,
          type: input.type,
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.validations !== undefined
            ? { validations: input.validations }
            : {}),
        },
      })) as {
        metafieldDefinitionCreate: {
          createdDefinition: Definition | null;
          userErrors: UserError[];
        };
      };
      const mutationResult = data.metafieldDefinitionCreate;
      if (mutationResult.userErrors.length > 0) {
        throw new Error(
          mutationResult.userErrors
            .map((error) =>
              error.code ? `${error.code}: ${error.message}` : error.message,
            )
            .join(", "),
        );
      }
      if (!mutationResult.createdDefinition) {
        throw new Error("Metafield definition was not returned after creation");
      }

      const verificationQuery = gql`
        query GetMetafieldDefinitionByKey($identifier: MetafieldDefinitionIdentifierInput!) {
          metafieldDefinition(identifier: $identifier) {
            ...MetafieldDefinitionFields
          }
        }
        ${definitionSelection}
      `;
      const verification = (await shopifyClient.request(verificationQuery, {
        identifier: {
          namespace: input.namespace,
          key: input.key,
          ownerType: input.ownerType,
        },
      })) as { metafieldDefinition: Definition | null };
      if (!verification.metafieldDefinition) {
        throw new Error("Metafield definition was not returned during verification");
      }
      assertDefinitionVerified(verification.metafieldDefinition, input);

      return {
        success: true,
        mutation: {
          createdDefinition: formatDefinition(mutationResult.createdDefinition),
          userErrors: mutationResult.userErrors,
        },
        verified: formatDefinition(verification.metafieldDefinition),
      };
    } catch (error) {
      console.error("Error creating metafield definition:", error);
      throw new Error(
        `Failed to create metafield definition: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export { createMetafieldDefinition };
export type { CreateMetafieldDefinitionInput };
