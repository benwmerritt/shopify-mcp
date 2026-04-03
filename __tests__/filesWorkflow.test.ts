import {
  createUploadSession,
  cleanupExpiredUploadSessions,
  getUploadSession,
  resetUploadSessionsForTests,
  updateUploadSession,
} from "../src/files/uploadSessions.js";
import {
  detectUploadKind,
  getStagedUploadHttpMethod,
} from "../src/files/uploadUtils.js";
import {
  getFileAttachmentError,
  isFileAttachableToProduct,
  normalizeProductId,
  type ShopifyFileRecord,
} from "../src/files/shopifyFiles.js";

describe("upload helpers", () => {
  afterEach(() => {
    resetUploadSessionsForTests();
  });

  it("detects IMAGE uploads from AUTO using the mime type", () => {
    expect(detectUploadKind("AUTO", "image/png")).toBe("IMAGE");
    expect(detectUploadKind("AUTO", "application/pdf")).toBe("FILE");
  });

  it("maps staged upload methods by file kind", () => {
    expect(getStagedUploadHttpMethod("IMAGE")).toBe("PUT");
    expect(getStagedUploadHttpMethod("FILE")).toBe("POST");
  });

  it("creates and expires upload sessions", () => {
    const session = createUploadSession({
      baseUrl: "https://example.com",
      kind: "AUTO",
      duplicateResolutionMode: "APPEND_UUID",
      expiresInMinutes: 1,
    });

    expect(getUploadSession(session.id)?.state).toBe("PENDING");

    updateUploadSession(session.id, {
      expiresAt: Date.now() - 1000,
    });

    cleanupExpiredUploadSessions();

    expect(getUploadSession(session.id)?.state).toBe("EXPIRED");
  });

  it("normalizes product IDs", () => {
    expect(normalizeProductId("123")).toBe("gid://shopify/Product/123");
    expect(normalizeProductId("gid://shopify/Product/123")).toBe(
      "gid://shopify/Product/123",
    );
  });

  it("only allows MediaImage files to be attached to products in v1", () => {
    const imageFile: ShopifyFileRecord = {
      id: "gid://shopify/MediaImage/1",
      type: "MediaImage",
      alt: null,
      fileStatus: "READY",
      createdAt: null,
      updatedAt: null,
      mimeType: "image/png",
      sizeBytes: null,
      url: null,
      imageUrl: "https://cdn.example.com/image.png",
      previewUrl: null,
    };
    const genericFile: ShopifyFileRecord = {
      ...imageFile,
      id: "gid://shopify/GenericFile/1",
      type: "GenericFile",
      mimeType: "application/pdf",
      url: "https://cdn.example.com/file.pdf",
      imageUrl: null,
    };

    expect(isFileAttachableToProduct(imageFile)).toBe(true);
    expect(isFileAttachableToProduct(genericFile)).toBe(false);
    expect(getFileAttachmentError(genericFile)).toContain("image-only");
  });
});
