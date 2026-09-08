import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

export const ReorderDraftProductMediaInputSchema = z.object({
  productId: z.string().min(1).describe("Product ID (numeric or full GID)"),
  mediaIds: z.array(z.string().min(1)).describe(
    "The complete attached MediaImage ID order, from first to last",
  ),
  pollIntervalMs: z.number().int().min(0).max(60_000).default(1_000),
  timeoutSeconds: z.number().positive().max(300).default(60),
});

type ReorderDraftProductMediaInput = z.input<typeof ReorderDraftProductMediaInputSchema>;
type ParsedReorderDraftProductMediaInput = z.infer<typeof ReorderDraftProductMediaInputSchema>;

type MediaNode = {
  __typename: string;
  id: string;
  alt: string | null;
  image: { url: string } | null;
};

type ProductMediaSnapshot = {
  id: string;
  status: string;
  media: MediaNode[];
};

let shopifyClient: GraphQLClient;

function normalizeProductId(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameIdSet(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    new Set(right).size === right.length && left.every((id) => new Set(right).has(id));
}

function sameMediaRecords(left: MediaNode[], right: MediaNode[]): boolean {
  return left.length === right.length && left.every((node, index) => {
    const other = right[index];
    return node.id === other.id && node.__typename === other.__typename &&
      node.alt === other.alt && node.image?.url === other.image?.url;
  });
}

async function readProductMedia(productId: string): Promise<ProductMediaSnapshot> {
  const query = gql`
    query GetOrderedProductMedia($id: ID!, $first: Int!, $after: String) {
      product(id: $id) {
        id
        status
        media(first: $first, after: $after) {
          nodes {
            __typename
            id
            alt
            ... on MediaImage { image { url } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  const media: MediaNode[] = [];
  let after: string | null = null;
  type ProductPage = {
    id: string;
    status: string;
    media: {
      nodes: MediaNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  let product: ProductPage | null = null;
  let hasNextPage = false;
  do {
    const data = await shopifyClient.request(query, { id: productId, first: 250, after }) as {
      product: ProductPage | null;
    };
    if (!data.product) {
      throw new Error(`Product ${productId} not found`);
    }
    product = data.product;
    media.push(...product.media.nodes);
    after = product.media.pageInfo.endCursor;
    hasNextPage = product.media.pageInfo.hasNextPage;
  } while (hasNextPage);

  return { id: product.id, status: product.status, media };
}

async function waitForJob(jobId: string, timeoutSeconds: number, pollIntervalMs: number): Promise<void> {
  const query = gql`
    query GetReorderJob($id: ID!) {
      node(id: $id) {
        __typename
        ... on Job { id done }
      }
    }
  `;
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (true) {
    const data = await shopifyClient.request(query, { id: jobId }) as {
      node: { __typename: string; id: string; done?: boolean } | null;
    };
    if (data.node?.__typename === "Job" && data.node.done === true) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Shopify media reorder job ${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export const reorderDraftProductMedia = {
  name: "reorder-draft-product-media",
  description: "Safely reorder the complete MediaImage order of a DRAFT product; preserves media IDs, alt text, files, and associations",
  schema: ReorderDraftProductMediaInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (rawInput: ReorderDraftProductMediaInput) => {
    const input: ParsedReorderDraftProductMediaInput = ReorderDraftProductMediaInputSchema.parse(rawInput);
    const productId = normalizeProductId(input.productId);
    const requestedIds = input.mediaIds.map((id) => id);
    const before = await readProductMedia(productId);

    if (before.status !== "DRAFT") {
      throw new Error(`Product ${productId} is ${before.status}; reorder-draft-product-media only permits DRAFT products`);
    }

    const attachedIds = before.media.map((node) => node.id);
    const attachedMediaImageIds = before.media
      .filter((node) => node.__typename === "MediaImage")
      .map((node) => node.id);
    if (before.media.some((node) => node.__typename !== "MediaImage") || !sameIdSet(requestedIds, attachedMediaImageIds)) {
      throw new Error("mediaIds must exactly match the attached MediaImage IDs in count and membership; no media may be omitted or added");
    }
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new Error("mediaIds must not contain duplicates");
    }

    const moves = requestedIds
      .map((id, newPosition) => ({ id, newPosition }))
      .filter(({ id, newPosition }) => attachedIds[newPosition] !== id);

    let jobId: string | null = null;
    if (moves.length > 0) {
      const mutation = gql`
        mutation ProductReorderMedia($productId: ID!, $moves: [MoveInput!]!) {
          productReorderMedia(id: $productId, moves: $moves) {
            job { id done }
            mediaUserErrors { field message }
          }
        }
      `;
      const data = await shopifyClient.request(mutation, { productId, moves }) as {
        productReorderMedia: {
          job: { id: string; done: boolean } | null;
          mediaUserErrors: Array<{ field: string[]; message: string }>;
        };
      };
      if (data.productReorderMedia.mediaUserErrors.length > 0) {
        throw new Error(data.productReorderMedia.mediaUserErrors.map((error) => `${error.field.join(".")}: ${error.message}`).join(", "));
      }
      jobId = data.productReorderMedia.job?.id ?? null;
      if (jobId && !data.productReorderMedia.job?.done) {
        await waitForJob(jobId, input.timeoutSeconds, input.pollIntervalMs);
      }
    }

    const after = await readProductMedia(productId);
    const finalIds = after.media.map((node) => node.id);
    if (after.status !== "DRAFT" || !sameIds(finalIds, requestedIds)) {
      throw new Error(`Media reorder verification failed: expected full order ${requestedIds.join(",")}, got ${finalIds.join(",")}`);
    }
    const beforeById = new Map(before.media.map((node) => [node.id, node]));
    const expectedAfter = requestedIds.map((id) => beforeById.get(id)!);
    if (!sameMediaRecords(after.media, expectedAfter)) {
      throw new Error("Media reorder verification failed: media metadata changed; IDs, alt text, and file URLs must be preserved");
    }

    return {
      productId,
      status: after.status,
      mediaIds: finalIds,
      changed: moves.length > 0,
      jobId,
      verified: true,
    };
  },
};
