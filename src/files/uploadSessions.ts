import { randomUUID } from "node:crypto";

import type {
  DuplicateResolutionMode,
  RequestedUploadKind,
} from "./uploadUtils.js";

export type UploadSessionState =
  | "PENDING"
  | "UPLOADING"
  | "COMPLETE"
  | "FAILED"
  | "EXPIRED";

export interface UploadSessionRecord {
  id: string;
  kind: RequestedUploadKind;
  altText?: string;
  duplicateResolutionMode: DuplicateResolutionMode;
  state: UploadSessionState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  uploadUrl: string;
  error?: string;
  fileId?: string;
}

interface CreateUploadSessionInput {
  baseUrl: string;
  kind: RequestedUploadKind;
  altText?: string;
  duplicateResolutionMode: DuplicateResolutionMode;
  expiresInMinutes: number;
}

const SESSION_RETENTION_MS = 60 * 60 * 1000;
const uploadSessions = new Map<string, UploadSessionRecord>();

function isExpired(session: UploadSessionRecord, now = Date.now()): boolean {
  return session.expiresAt <= now;
}

function applyExpiry(
  session: UploadSessionRecord,
  now = Date.now(),
): UploadSessionRecord {
  if (isExpired(session, now) && session.state !== "EXPIRED") {
    session.state = "EXPIRED";
    session.updatedAt = now;
  }

  return session;
}

export function createUploadSession(
  input: CreateUploadSessionInput,
): UploadSessionRecord {
  const now = Date.now();
  const sessionId = randomUUID();
  const expiresAt = now + input.expiresInMinutes * 60 * 1000;
  const uploadUrl = `${input.baseUrl}/uploads/shopify-files/${encodeURIComponent(
    sessionId,
  )}`;

  const session: UploadSessionRecord = {
    id: sessionId,
    kind: input.kind,
    altText: input.altText,
    duplicateResolutionMode: input.duplicateResolutionMode,
    state: "PENDING",
    createdAt: now,
    updatedAt: now,
    expiresAt,
    uploadUrl,
  };

  uploadSessions.set(sessionId, session);
  return session;
}

export function getUploadSession(
  sessionId: string,
): UploadSessionRecord | null {
  const session = uploadSessions.get(sessionId);
  if (!session) {
    return null;
  }

  return applyExpiry(session);
}

export function updateUploadSession(
  sessionId: string,
  patch: Partial<UploadSessionRecord>,
): UploadSessionRecord | null {
  const session = getUploadSession(sessionId);
  if (!session) {
    return null;
  }

  Object.assign(session, patch, { updatedAt: Date.now() });
  return session;
}

export function cleanupExpiredUploadSessions(now = Date.now()): void {
  for (const [sessionId, session] of uploadSessions.entries()) {
    applyExpiry(session, now);

    if (session.state === "EXPIRED" && now - session.expiresAt > SESSION_RETENTION_MS) {
      uploadSessions.delete(sessionId);
    }
  }
}

export function resetUploadSessionsForTests(): void {
  uploadSessions.clear();
}
