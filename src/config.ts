function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "");
  }

  return `https://${trimmed.replace(/\/+$/, "")}`;
}

export const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-01";

export const SHOPIFY_FILE_UPLOAD_MAX_BYTES = parsePositiveInt(
  process.env.SHOPIFY_FILE_UPLOAD_MAX_BYTES,
  26_214_400,
);

export const SHOPIFY_FILE_UPLOAD_SESSION_TTL_MINUTES = Math.min(
  parsePositiveInt(process.env.SHOPIFY_FILE_UPLOAD_SESSION_TTL_MINUTES, 15),
  60,
);

export function getPublicAppUrl(port: number): string {
  const explicitUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const appUrl = normalizeBaseUrl(process.env.APP_URL);
  if (appUrl) {
    return appUrl;
  }

  const railwayUrl = normalizeBaseUrl(process.env.RAILWAY_PUBLIC_URL);
  if (railwayUrl) {
    return railwayUrl;
  }

  const railwayDomain = normalizeBaseUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayDomain) {
    return railwayDomain;
  }

  const railwayStaticUrl = normalizeBaseUrl(process.env.RAILWAY_STATIC_URL);
  if (railwayStaticUrl) {
    return railwayStaticUrl;
  }

  return `http://localhost:${port}`;
}
