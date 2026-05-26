import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const GetMetafieldOptionsInputSchema = z.object({
  definitionId: z
    .string()
    .optional()
    .describe("Metafield definition GID. Provide this OR ownerType+namespace+key."),
  ownerType: z
    .enum(["PRODUCT", "PRODUCTVARIANT", "CUSTOMER", "ORDER", "COLLECTION", "SHOP"])
    .default("PRODUCT")
    .describe("Owner type of the metafield (used with namespace+key)"),
  namespace: z.string().optional().describe("Metafield namespace (used with key)"),
  key: z.string().optional().describe("Metafield key (used with namespace)"),
  limit: z
    .number()
    .default(50)
    .describe("Maximum number of metaobject options to return (max 250)"),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor for paging through metaobject options")
});

type GetMetafieldOptionsInput = z.infer<typeof GetMetafieldOptionsInputSchema>;

let shopifyClient: GraphQLClient;

type Validation = { name: string; type?: string | null; value: string | null };
type DefinitionNode = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  type: { name: string; category?: string | null };
  validations: Validation[];
};

const DEFINITION_FIELDS = `
  id
  name
  namespace
  key
  type {
    name
    category
  }
  validations {
    name
    type
    value
  }
`;

async function resolveDefinition(
  input: GetMetafieldOptionsInput
): Promise<DefinitionNode> {
  if (input.definitionId) {
    const query = gql`
      query MetafieldDefinitionById($id: ID!) {
        metafieldDefinition(id: $id) {
          ${DEFINITION_FIELDS}
        }
      }
    `;
    const data = (await shopifyClient.request(query, {
      id: input.definitionId
    })) as { metafieldDefinition: DefinitionNode | null };
    if (!data.metafieldDefinition) {
      throw new Error(`Metafield definition not found: ${input.definitionId}`);
    }
    return data.metafieldDefinition;
  }

  if (!input.namespace || !input.key) {
    throw new Error(
      "Provide either definitionId, or both namespace and key (with ownerType)."
    );
  }

  const query = gql`
    query MetafieldDefinitionByKey(
      $ownerType: MetafieldOwnerType!
      $namespace: String!
      $key: String!
    ) {
      metafieldDefinitions(
        ownerType: $ownerType
        namespace: $namespace
        key: $key
        first: 1
      ) {
        edges {
          node {
            ${DEFINITION_FIELDS}
          }
        }
      }
    }
  `;
  const data = (await shopifyClient.request(query, {
    ownerType: input.ownerType,
    namespace: input.namespace,
    key: input.key
  })) as { metafieldDefinitions: { edges: Array<{ node: DefinitionNode }> } };

  const node = data.metafieldDefinitions.edges[0]?.node;
  if (!node) {
    throw new Error(
      `No metafield definition found for ${input.ownerType} ${input.namespace}.${input.key}`
    );
  }
  return node;
}

async function resolveMetaobjectType(definitionGid: string): Promise<string> {
  const query = gql`
    query MetaobjectDefinitionType($id: ID!) {
      metaobjectDefinition(id: $id) {
        id
        type
      }
    }
  `;
  const data = (await shopifyClient.request(query, { id: definitionGid })) as {
    metaobjectDefinition: { id: string; type: string } | null;
  };
  if (!data.metaobjectDefinition) {
    throw new Error(
      `Referenced metaobject definition not found: ${definitionGid}`
    );
  }
  return data.metaobjectDefinition.type;
}

async function listMetaobjectOptions(
  type: string,
  limit: number,
  cursor?: string
) {
  const query = gql`
    query MetaobjectOptions($type: String!, $first: Int!, $after: String) {
      metaobjects(type: $type, first: $first, after: $after) {
        edges {
          node {
            id
            handle
            displayName
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
    type,
    first: Math.min(limit, 250),
    after: cursor
  })) as {
    metaobjects: {
      edges: Array<{
        node: { id: string; handle: string; displayName: string | null };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  return {
    options: data.metaobjects.edges.map((edge) => edge.node),
    pageInfo: {
      hasNextPage: data.metaobjects.pageInfo.hasNextPage,
      nextCursor: data.metaobjects.pageInfo.endCursor
    }
  };
}

const getMetafieldOptions = {
  name: "get-metafield-options",
  description:
    "Resolve the selectable options for a metafield in one call. For metaobject-reference metafields it returns the available metaobject entries (id, handle, displayName). For choice-list metafields it returns the allowed choices. Saves chaining list-metafield-definitions -> list-metaobject-definitions -> list-metaobjects.",
  schema: GetMetafieldOptionsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetMetafieldOptionsInput) => {
    try {
      const definition = await resolveDefinition(input);
      const typeName = definition.type.name;
      const base = {
        definition: {
          id: definition.id,
          name: definition.name,
          fullKey: `${definition.namespace}.${definition.key}`,
          type: typeName
        }
      };

      // Metaobject-reference metafields: resolve the referenced metaobject
      // definition and list its entries as the available options.
      if (typeName.includes("metaobject_reference")) {
        const refValidation = definition.validations.find(
          (v) => v.name === "metaobject_definition_id"
        );
        if (!refValidation?.value) {
          return {
            ...base,
            optionKind: "metaobject_reference",
            options: [],
            note: "Metaobject reference has no metaobject_definition_id validation; cannot resolve options."
          };
        }

        const metaobjectType = await resolveMetaobjectType(refValidation.value);
        const { options, pageInfo } = await listMetaobjectOptions(
          metaobjectType,
          input.limit,
          input.cursor
        );

        return {
          ...base,
          optionKind: "metaobject",
          metaobjectType,
          options,
          pageInfo
        };
      }

      // Choice-list metafields: return the allowed choices from validations.
      const choicesValidation = definition.validations.find(
        (v) => v.name === "choices"
      );
      if (choicesValidation?.value) {
        let choices: unknown = choicesValidation.value;
        try {
          choices = JSON.parse(choicesValidation.value);
        } catch {
          // leave as raw string if not JSON
        }
        return {
          ...base,
          optionKind: "choices",
          options: choices
        };
      }

      // No enumerable options (free-form value type).
      return {
        ...base,
        optionKind: "none",
        validations: definition.validations,
        note: "This metafield type has no enumerable options; it accepts a free-form value of the given type."
      };
    } catch (error) {
      console.error("Error resolving metafield options:", error);
      throw new Error(
        `Failed to resolve metafield options: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getMetafieldOptions };
