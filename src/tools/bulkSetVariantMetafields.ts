import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const MetafieldEntrySchema = z.object({
  namespace: z.string().min(1).describe("Metafield namespace (e.g. 'custom')"),
  key: z.string().min(1).describe("Metafield key (e.g. 'sale_type', 'jet_size')"),
  value: z
    .string()
    .describe(
      "Value as a string. For reference types pass the target GID; for list types pass a JSON array string."
    ),
  type: z
    .string()
    .optional()
    .describe(
      "Metafield type. Omit to inherit the field's definition type (recommended when a definition exists). Common: single_line_text_field, number_decimal, metaobject_reference, list.metaobject_reference."
    )
});

const BulkSetVariantMetafieldsInputSchema = z
  .object({
    productId: z
      .string()
      .min(1)
      .describe("Product whose variants to update (numeric or full GID)"),
    metafields: z
      .array(MetafieldEntrySchema)
      .min(1)
      .optional()
      .describe(
        "UNIFORM mode: these metafields are applied to every targeted variant. Combine with optional variantIds to restrict the set; omit variantIds to hit all variants of the product."
      ),
    variantIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "UNIFORM mode only: restrict to these variant IDs (numeric or GID). Omit to target all variants of the product."
      ),
    variants: z
      .array(
        z.object({
          variantId: z
            .string()
            .min(1)
            .describe("Variant ID (numeric or full GID)"),
          metafields: z
            .array(MetafieldEntrySchema)
            .min(1)
            .describe("Metafields to set on this specific variant")
        })
      )
      .min(1)
      .optional()
      .describe(
        "PER-VARIANT mode: explicit per-variant metafields (different values per variant). Mutually exclusive with metafields/variantIds."
      ),
    allowPartialUpdates: z
      .boolean()
      .default(true)
      .describe(
        "When true (default), valid variants are saved even if others in the same batch fail; failures are reported in userErrors. When false, a single bad variant fails its whole batch."
      )
  })
  .refine(
    (d) => (d.metafields ? 1 : 0) + (d.variants ? 1 : 0) === 1,
    {
      message:
        "Provide exactly one of `metafields` (uniform mode) or `variants` (per-variant mode)."
    }
  );

type BulkSetVariantMetafieldsInput = z.infer<
  typeof BulkSetVariantMetafieldsInputSchema
>;

type MetafieldEntry = z.infer<typeof MetafieldEntrySchema>;

type VariantUpdate = {
  id: string;
  metafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type?: string;
  }>;
};

let shopifyClient: GraphQLClient;

const PRODUCT_GID_PREFIX = "gid://shopify/Product/";
const VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";

// Shopify caps productVariantsBulkUpdate at 250 variants per call.
const MAX_VARIANTS_PER_CALL = 250;

function normalizeId(id: string, prefix: string): string {
  return id.startsWith("gid://") ? id : `${prefix}${id}`;
}

// Pure helpers (exported for unit tests).

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function cleanMetafields(metafields: MetafieldEntry[]) {
  return metafields.map((m) => ({
    namespace: m.namespace,
    key: m.key,
    value: m.value,
    ...(m.type ? { type: m.type } : {})
  }));
}

// Fan one set of metafields out across many variants (uniform mode).
export function buildUniformUpdates(
  variantIds: string[],
  metafields: MetafieldEntry[]
): VariantUpdate[] {
  const cleaned = cleanMetafields(metafields);
  return variantIds.map((id) => ({
    id: normalizeId(id, VARIANT_GID_PREFIX),
    metafields: cleaned
  }));
}

// Map explicit per-variant metafields (per-variant mode).
export function buildPerVariantUpdates(
  variants: Array<{ variantId: string; metafields: MetafieldEntry[] }>
): VariantUpdate[] {
  return variants.map((v) => ({
    id: normalizeId(v.variantId, VARIANT_GID_PREFIX),
    metafields: cleanMetafields(v.metafields)
  }));
}

const VARIANTS_QUERY = gql`
  query GetVariantIds($id: ID!, $after: String) {
    product(id: $id) {
      id
      variants(first: 250, after: $after) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const BULK_MUTATION = gql`
  mutation BulkSetVariantMetafields(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
    $allowPartialUpdates: Boolean
  ) {
    productVariantsBulkUpdate(
      productId: $productId
      variants: $variants
      allowPartialUpdates: $allowPartialUpdates
    ) {
      productVariants {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

async function fetchAllVariantIds(productId: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;

  do {
    const data = (await shopifyClient.request(VARIANTS_QUERY, {
      id: productId,
      after
    })) as {
      product: {
        variants: {
          nodes: Array<{ id: string }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    };

    if (!data.product) {
      throw new Error(`Product not found: ${productId}`);
    }

    for (const node of data.product.variants.nodes) {
      ids.push(node.id);
    }

    after = data.product.variants.pageInfo.hasNextPage
      ? data.product.variants.pageInfo.endCursor
      : null;
  } while (after);

  return ids;
}

const bulkSetVariantMetafields = {
  name: "bulk-set-variant-metafields",
  description:
    "Set metafields across many variants of a single product in one API call (productVariantsBulkUpdate, up to 250 variants per call). UNIFORM mode (pass `metafields`) applies the same values to every variant — the tool auto-discovers the variant IDs, so you only pass the product. PER-VARIANT mode (pass `variants`) applies different values per variant. Far more efficient than calling set-metafield once per variant.",
  schema: BulkSetVariantMetafieldsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: BulkSetVariantMetafieldsInput) => {
    try {
      const hasUniform = !!input.metafields;
      const hasPerVariant = !!input.variants;

      // The inline server.tool registration carries a raw shape (no zod
      // .refine), so enforce mode-exclusivity here at runtime too.
      if (hasUniform === hasPerVariant) {
        throw new Error(
          "Provide exactly one of `metafields` (uniform mode) or `variants` (per-variant mode)."
        );
      }

      const productId = normalizeId(input.productId, PRODUCT_GID_PREFIX);
      const mode: "uniform" | "per-variant" = hasUniform
        ? "uniform"
        : "per-variant";

      let updates: VariantUpdate[];

      if (hasUniform) {
        const variantIds =
          input.variantIds && input.variantIds.length > 0
            ? input.variantIds
            : await fetchAllVariantIds(productId);

        if (variantIds.length === 0) {
          throw new Error(
            `No variants found for product ${productId}; nothing to update.`
          );
        }

        updates = buildUniformUpdates(variantIds, input.metafields!);
      } else {
        updates = buildPerVariantUpdates(input.variants!);
      }

      const batches = chunk(updates, MAX_VARIANTS_PER_CALL);
      const updatedVariantIds: string[] = [];
      const userErrors: Array<{
        field: string[] | null;
        message: string;
        code?: string | null;
      }> = [];

      for (const batch of batches) {
        const data = (await shopifyClient.request(BULK_MUTATION, {
          productId,
          variants: batch,
          allowPartialUpdates: input.allowPartialUpdates
        })) as {
          productVariantsBulkUpdate: {
            productVariants: Array<{ id: string }> | null;
            userErrors: Array<{
              field: string[] | null;
              message: string;
              code?: string | null;
            }>;
          };
        };

        const result = data.productVariantsBulkUpdate;
        for (const variant of result.productVariants ?? []) {
          updatedVariantIds.push(variant.id);
        }
        if (result.userErrors?.length) {
          userErrors.push(...result.userErrors);
        }
      }

      const succeeded = updatedVariantIds.length;

      return {
        success: userErrors.length === 0,
        productId,
        mode,
        apiCalls: batches.length,
        variantsTargeted: updates.length,
        succeeded,
        failed: updates.length - succeeded,
        userErrors,
        // Echo IDs only for modest sets so the response stays lean.
        ...(updatedVariantIds.length <= 60 ? { updatedVariantIds } : {})
      };
    } catch (error) {
      console.error("Error bulk-setting variant metafields:", error);
      throw new Error(
        `Failed to bulk-set variant metafields: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { bulkSetVariantMetafields };
