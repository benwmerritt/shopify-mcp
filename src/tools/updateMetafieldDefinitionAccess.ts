import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";
import { createMetafieldDefinition } from "./createMetafieldDefinition.js";

const schema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/MetafieldDefinition\/\d+$/),
  storefront: createMetafieldDefinition.schema.shape.access.unwrap().shape.storefront.unwrap(),
});
type Input = z.infer<typeof schema>;
type Definition = { id: string; access: { admin: string; storefront: string } };
let shopifyClient: GraphQLClient;

const updateMetafieldDefinitionAccess = {
  name: "update-metafield-definition-access",
  description: "Update only a metafield definition's Storefront API access and verify with a fresh read.",
  schema,
  initialize(client: GraphQLClient) { shopifyClient = client; },
  async execute(input: Input) {
    const before = await shopifyClient.request<{ node: {
      id: string; namespace: string; key: string; ownerType: string;
    } | null }>(gql`
      query ResolveMetafieldDefinitionAccessTarget($id: ID!) {
        node(id: $id) {
          ... on MetafieldDefinition { id namespace key ownerType }
        }
      }
    `, { id: input.id });
    if (before.node?.id !== input.id) throw new Error("Metafield definition not found");
    const data = await shopifyClient.request<{
      metafieldDefinitionUpdate: {
        updatedDefinition: Definition | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(gql`
      mutation UpdateMetafieldDefinitionAccess($definition: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(definition: $definition) {
          updatedDefinition { id access { admin storefront } }
          userErrors { field message }
        }
      }
    `, { definition: {
      namespace: before.node.namespace, key: before.node.key,
      ownerType: before.node.ownerType, access: { storefront: input.storefront },
    } });
    const result = data.metafieldDefinitionUpdate;
    if (result.userErrors.length) {
      throw new Error(result.userErrors.map(error => error.message).join(", "));
    }
    if (!result.updatedDefinition) throw new Error("Metafield definition not returned after access update");
    const verification = await shopifyClient.request<{ node: Definition | null }>(gql`
      query VerifyMetafieldDefinitionAccess($id: ID!) {
        node(id: $id) {
          ... on MetafieldDefinition { id access { admin storefront } }
        }
      }
    `, { id: input.id });
    if (verification.node?.id !== input.id || verification.node.access.storefront !== input.storefront) {
      throw new Error("Verification failed: metafield definition access does not match submitted values");
    }
    return { success: true, mutation: result, verified: verification.node };
  },
};
export { updateMetafieldDefinitionAccess };
