import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

export const CreateProductOptionInputSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
  position: z.number().int().positive().optional(),
  variantStrategy: z.enum(["LEAVE_AS_IS", "CREATE"]).default("LEAVE_AS_IS"),
});

type CreateProductOptionInput = z.infer<typeof CreateProductOptionInputSchema>;
let shopifyClient: GraphQLClient;

function normalizeProductId(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

const createProductOption = {
  name: "create-product-option",
  description: "Create an option and values on an existing product using productOptionsCreate",
  schema: CreateProductOptionInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: CreateProductOptionInput) => {
    const productId = normalizeProductId(input.productId);
    const option: Record<string, unknown> = {
      name: input.name,
      values: input.values.map((name) => ({ name })),
    };
    if (input.position !== undefined) option.position = input.position;

    const mutation = gql`
      mutation productOptionsCreate(
        $productId: ID!
        $options: [OptionCreateInput!]!
        $variantStrategy: ProductOptionCreateVariantStrategy
      ) {
        productOptionsCreate(
          productId: $productId
          options: $options
          variantStrategy: $variantStrategy
        ) {
          product {
            id title status
            options { id name position optionValues { id name } }
            variants(first: 100) {
              edges { node { id title sku selectedOptions { name value } } }
            }
          }
          userErrors { field message }
        }
      }
    `;

    const data = (await shopifyClient.request(mutation, {
      productId,
      options: [option],
      variantStrategy: input.variantStrategy,
    })) as {
      productOptionsCreate: {
        product: Record<string, unknown> | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };

    const payload = data.productOptionsCreate;
    if (payload.userErrors.length > 0) {
      throw new Error(payload.userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join(", "));
    }
    if (!payload.product) throw new Error("Option creation returned no product");

    const query = gql`
      query verifyProductOptions($id: ID!) {
        product(id: $id) {
          id title status
          options { id name position optionValues { id name } }
          variants(first: 100) {
            edges { node { id title sku selectedOptions { name value } } }
          }
        }
      }
    `;
    const verified = (await shopifyClient.request(query, { id: productId })) as {
      product: Record<string, unknown> | null;
    };
    if (!verified.product) throw new Error("Option creation verification returned no product");

    return { product: payload.product, userErrors: [], verified: verified.product };
  },
};

export { createProductOption };
