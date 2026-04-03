import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";

export interface ShopifyFileRecord {
  id: string;
  type: string;
  alt: string | null;
  fileStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  url: string | null;
  imageUrl: string | null;
  previewUrl: string | null;
}

function getPreviewUrl(preview: unknown): string | null {
  if (
    preview &&
    typeof preview === "object" &&
    "image" in preview &&
    preview.image &&
    typeof preview.image === "object" &&
    "url" in preview.image &&
    typeof preview.image.url === "string"
  ) {
    return preview.image.url;
  }

  return null;
}

export function normalizeProductId(id: string): string {
  if (id.startsWith("gid://")) {
    return id;
  }

  return `gid://shopify/Product/${id}`;
}

export function isFileAttachableToProduct(file: ShopifyFileRecord): boolean {
  return file.type === "MediaImage";
}

export function getFileAttachmentError(file: ShopifyFileRecord): string {
  if (file.type === "GenericFile") {
    return "This file is a Shopify GenericFile. In v1, generic documents stay in Shopify Files for URL reuse, but product attachment is image-only.";
  }

  return `This file is a Shopify ${file.type}. In v1, product attachment is limited to MediaImage files.`;
}

export function mapShopifyFileNode(node: unknown): ShopifyFileRecord | null {
  if (!node || typeof node !== "object" || !("__typename" in node)) {
    return null;
  }

  const typedNode = node as { __typename: unknown };
  const typename = typedNode.__typename;
  if (typeof typename !== "string") {
    return null;
  }

  const base = node as unknown as {
    id: string;
    alt?: string | null;
    fileStatus?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    preview?: unknown;
  };

  if (typename === "MediaImage") {
    const mediaNode = node as unknown as {
      id: string;
      alt?: string | null;
      fileStatus?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      mimeType?: string | null;
      image?: { url?: string | null } | null;
      preview?: unknown;
    };

    return {
      id: mediaNode.id,
      type: typename,
      alt: mediaNode.alt ?? null,
      fileStatus: mediaNode.fileStatus ?? null,
      createdAt: mediaNode.createdAt ?? null,
      updatedAt: mediaNode.updatedAt ?? null,
      mimeType: mediaNode.mimeType ?? null,
      sizeBytes: null,
      url: null,
      imageUrl: mediaNode.image?.url ?? null,
      previewUrl: getPreviewUrl(mediaNode.preview),
    };
  }

  if (typename === "GenericFile") {
    const genericNode = node as unknown as {
      id: string;
      alt?: string | null;
      fileStatus?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
      mimeType?: string | null;
      originalFileSize?: number | null;
      url?: string | null;
      preview?: unknown;
    };

    return {
      id: genericNode.id,
      type: typename,
      alt: genericNode.alt ?? null,
      fileStatus: genericNode.fileStatus ?? null,
      createdAt: genericNode.createdAt ?? null,
      updatedAt: genericNode.updatedAt ?? null,
      mimeType: genericNode.mimeType ?? null,
      sizeBytes: genericNode.originalFileSize ?? null,
      url: genericNode.url ?? null,
      imageUrl: null,
      previewUrl: getPreviewUrl(genericNode.preview),
    };
  }

  const otherNode = node as unknown as {
    id: string;
    alt?: string | null;
    fileStatus?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    preview?: unknown;
  };

  return {
    id: otherNode.id,
    type: typename,
    alt: otherNode.alt ?? null,
    fileStatus: otherNode.fileStatus ?? null,
    createdAt: otherNode.createdAt ?? null,
    updatedAt: otherNode.updatedAt ?? null,
    mimeType: null,
    sizeBytes: null,
    url: null,
    imageUrl: null,
    previewUrl: getPreviewUrl(base.preview),
  };
}

export async function fetchShopifyFileById(
  shopifyClient: GraphQLClient,
  fileId: string,
): Promise<ShopifyFileRecord | null> {
  const query = gql`
    query GetShopifyFile($id: ID!) {
      node(id: $id) {
        __typename
        ... on MediaImage {
          id
          alt
          fileStatus
          createdAt
          updatedAt
          mimeType
          image {
            url
          }
          preview {
            image {
              url
            }
          }
        }
        ... on GenericFile {
          id
          alt
          fileStatus
          createdAt
          updatedAt
          mimeType
          originalFileSize
          url
          preview {
            image {
              url
            }
          }
        }
        ... on Video {
          id
          alt
          fileStatus
          createdAt
          updatedAt
          preview {
            image {
              url
            }
          }
        }
        ... on Model3d {
          id
          alt
          fileStatus
          createdAt
          updatedAt
          preview {
            image {
              url
            }
          }
        }
        ... on ExternalVideo {
          id
          alt
          fileStatus
          createdAt
          updatedAt
          preview {
            image {
              url
            }
          }
        }
      }
    }
  `;

  const data = (await shopifyClient.request(query, { id: fileId })) as {
    node: unknown;
  };

  return mapShopifyFileNode(data.node);
}

export async function fetchProductMediaSample(
  shopifyClient: GraphQLClient,
  productId: string,
  limit = 5,
): Promise<
  Array<{
    id: string;
    type: string;
    alt: string | null;
    url: string | null;
  }>
> {
  const query = gql`
    query GetProductMediaSample($id: ID!, $first: Int!) {
      product(id: $id) {
        media(first: $first) {
          nodes {
            __typename
            alt
            ... on MediaImage {
              id
              image {
                url
              }
            }
            ... on Video {
              id
              preview {
                image {
                  url
                }
              }
            }
            ... on Model3d {
              id
              preview {
                image {
                  url
                }
              }
            }
            ... on ExternalVideo {
              id
              preview {
                image {
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = (await shopifyClient.request(query, {
    id: productId,
    first: limit,
  })) as {
    product: {
      media: {
        nodes: Array<{
          __typename: string;
          id: string;
          alt?: string | null;
          image?: { url?: string | null } | null;
          preview?: { image?: { url?: string | null } | null } | null;
        }>;
      };
    } | null;
  };

  return (
    data.product?.media.nodes.map((node) => ({
      id: node.id,
      type: node.__typename,
      alt: node.alt ?? null,
      url: node.image?.url ?? node.preview?.image?.url ?? null,
    })) ?? []
  );
}

export async function waitForFileReady(
  shopifyClient: GraphQLClient,
  fileId: string,
  timeoutSeconds: number,
): Promise<ShopifyFileRecord> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastSeen: ShopifyFileRecord | null = null;

  while (Date.now() <= deadline) {
    const file = await fetchShopifyFileById(shopifyClient, fileId);
    if (!file) {
      throw new Error("Shopify file not found.");
    }

    lastSeen = file;

    if (file.fileStatus === "READY") {
      return file;
    }

    if (file.fileStatus === "FAILED") {
      throw new Error("Shopify file processing failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!lastSeen) {
    throw new Error("Timed out waiting for Shopify file status.");
  }

  throw new Error(
    `Timed out waiting for Shopify file to become READY. Current status: ${lastSeen.fileStatus ?? "unknown"}.`,
  );
}
