export type RequestedUploadKind = "AUTO" | "IMAGE" | "FILE";
export type EffectiveUploadKind = "IMAGE" | "FILE";
export type DuplicateResolutionMode =
  | "APPEND_UUID"
  | "RAISE_ERROR"
  | "REPLACE";

export function detectUploadKind(
  requestedKind: RequestedUploadKind,
  mimeType: string,
): EffectiveUploadKind {
  if (requestedKind === "IMAGE" || requestedKind === "FILE") {
    return requestedKind;
  }

  return mimeType.toLowerCase().startsWith("image/") ? "IMAGE" : "FILE";
}

export function getStagedUploadHttpMethod(
  kind: EffectiveUploadKind,
): "PUT" | "POST" {
  return kind === "IMAGE" ? "PUT" : "POST";
}

export function isMultipartStagedUpload(kind: EffectiveUploadKind): boolean {
  return getStagedUploadHttpMethod(kind) === "POST";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
