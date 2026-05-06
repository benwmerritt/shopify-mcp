import { promises as fs } from "node:fs";

import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";

import type {
  DuplicateResolutionMode,
  EffectiveUploadKind,
  RequestedUploadKind,
} from "./uploadUtils.js";
import {
  detectUploadKind,
  getStagedUploadHttpMethod,
  isMultipartStagedUpload,
} from "./uploadUtils.js";
import { mapShopifyFileNode, type ShopifyFileRecord } from "./shopifyFiles.js";

interface UploadFileToShopifyInput {
  shopifyClient: GraphQLClient;
  filePath: string;
  filename: string;
  mimeType: string;
  requestedKind: RequestedUploadKind;
  altText?: string;
  duplicateResolutionMode: DuplicateResolutionMode;
}

interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: Array<{
    name: string;
    value: string;
  }>;
}

async function createStagedUploadTarget(
  shopifyClient: GraphQLClient,
  filename: string,
  mimeType: string,
  fileSize: number,
  kind: EffectiveUploadKind,
): Promise<StagedUploadTarget> {
  const query = gql`
    mutation CreateStagedUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = (await shopifyClient.request(query, {
    input: [
      {
        filename,
        mimeType,
        fileSize: String(fileSize),
        resource: kind,
        httpMethod: getStagedUploadHttpMethod(kind),
      },
    ],
  })) as {
    stagedUploadsCreate: {
      stagedTargets: StagedUploadTarget[];
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };

  if (data.stagedUploadsCreate.userErrors.length > 0) {
    throw new Error(
      data.stagedUploadsCreate.userErrors
        .map((error) => `${error.field.join(".")}: ${error.message}`)
        .join(", "),
    );
  }

  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) {
    throw new Error("Shopify did not return a staged upload target.");
  }

  return target;
}

async function uploadBufferToStagedTarget(
  target: StagedUploadTarget,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  kind: EffectiveUploadKind,
): Promise<void> {
  let response: Response;

  if (isMultipartStagedUpload(kind)) {
    const form = new FormData();
    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }

    form.append("file", new Blob([fileBuffer], { type: mimeType }), filename);

    response = await fetch(target.url, {
      method: "POST",
      body: form,
    });
  } else {
    const headers = new Headers();
    for (const parameter of target.parameters) {
      headers.set(parameter.name, parameter.value);
    }

    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", mimeType);
    }

    response = await fetch(target.url, {
      method: "PUT",
      headers,
      body: fileBuffer,
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Staged upload failed with ${response.status} ${response.statusText}: ${body}`,
    );
  }
}

async function createShopifyFile(
  shopifyClient: GraphQLClient,
  target: StagedUploadTarget,
  filename: string,
  altText: string | undefined,
  duplicateResolutionMode: DuplicateResolutionMode,
  kind: EffectiveUploadKind,
): Promise<ShopifyFileRecord> {
  const query = gql`
    mutation CreateFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
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
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const data = (await shopifyClient.request(query, {
    files: [
      {
        originalSource: target.resourceUrl,
        filename,
        alt: altText,
        contentType: kind,
        duplicateResolutionMode,
      },
    ],
  })) as {
    fileCreate: {
      files: unknown[];
      userErrors: Array<{
        field: string[];
        message: string;
        code?: string | null;
      }>;
    };
  };

  if (data.fileCreate.userErrors.length > 0) {
    throw new Error(
      data.fileCreate.userErrors
        .map((error) =>
          error.code
            ? `${error.code}: ${error.message}`
            : `${error.field.join(".")}: ${error.message}`,
        )
        .join(", "),
    );
  }

  const file = mapShopifyFileNode(data.fileCreate.files[0]);
  if (!file) {
    throw new Error("Shopify did not return a supported file result.");
  }

  return file;
}

export async function uploadFileToShopify(
  input: UploadFileToShopifyInput,
): Promise<ShopifyFileRecord> {
  const fileBuffer = await fs.readFile(input.filePath);
  const fileStats = await fs.stat(input.filePath);
  const kind = detectUploadKind(input.requestedKind, input.mimeType);

  const target = await createStagedUploadTarget(
    input.shopifyClient,
    input.filename,
    input.mimeType,
    fileStats.size,
    kind,
  );

  await uploadBufferToStagedTarget(
    target,
    fileBuffer,
    input.filename,
    input.mimeType,
    kind,
  );

  return createShopifyFile(
    input.shopifyClient,
    target,
    input.filename,
    input.altText,
    input.duplicateResolutionMode,
    kind,
  );
}
