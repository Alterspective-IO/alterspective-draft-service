/**
 * Innovation/docgen/SharedoOobProvider.js
 *
 * Isolated implementation of the Sharedo OOB document generation provider.
 * Tests each step independently against live ausiab before integration.
 *
 * Steps:
 *  1. getScimToken()           — SCIM Impersonate.Fixed auth
 *  2. triggerPhase(taskId)     — POST phase → in-progress
 *  3. pollForDocument(taskId)  — poll relatedDocuments until doc appears
 *  4. getPrizmSession(docId)   — POST /api/documents/preview/ (go/no-go)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginSessionJwt } from './session-jwt.js';

// Load .env from Innovation/docgen/
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .filter(([k, v]) => k && v)
);

const BASE_URL        = env.SHAREDO_BASE_URL;
const IDENTITY_URL    = env.SHAREDO_IDENTITY_URL;
const SCIM_CLIENT_ID  = env.SHAREDO_SCIM_CLIENT_ID;
const SCIM_SECRET     = env.SHAREDO_SCIM_CLIENT_SECRET;
const IMPERSONATE     = env.SHAREDO_IMPERSONATE_USER;
const POLL_TIMEOUT    = Number(env.POLL_TIMEOUT_MS) || 30000;
const POLL_INTERVAL   = Number(env.POLL_INTERVAL_MS) || 2000;

const PHASE_IN_PROGRESS = 'task-activity-prepare-document-in-progress';

// ─── Step 1: Session JWT (OIDC) ────────────────────────────────────────────
// Phase transitions require BOTH the Bearer token AND session cookies.
// SCIM Impersonate.Fixed (token-only, no cookies) returns 500 on phase endpoints.
// Session JWT login provides both via the 6-step OIDC browser simulation.

export async function getSessionAuth() {
  return loginSessionJwt({
    baseUrl:     BASE_URL,
    identityUrl: IDENTITY_URL,
    username:    IMPERSONATE,
    password:    env.SHAREDO_PASSWORD || 'Pass@word1!',
  });
}

/** Build request headers with both Bearer token and session cookies */
function authHeaders(auth, extra = {}) {
  return {
    Authorization:      `Bearer ${auth.token}`,
    Cookie:             auth.cookieHeader,
    'Content-Type':     'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...extra,
  };
}

// ─── Step 2: Phase trigger ─────────────────────────────────────────────────

export async function triggerPhase(taskId, auth) {
  const url = `${BASE_URL}/api/sharedo/${encodeURIComponent(taskId)}/phase`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(auth),
    body: JSON.stringify({ toPhaseSystemName: PHASE_IN_PROGRESS }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw Object.assign(
      new Error(`Phase trigger failed ${res.status}`),
      { status: res.status, body: body.substring(0, 300) }
    );
  }
  return { status: res.status };
}

// ─── Step 3: Poll for document ─────────────────────────────────────────────

export async function pollForDocument(taskId, auth) {
  const deadline = Date.now() + POLL_TIMEOUT;
  const url = `${BASE_URL}/api/sharedo/${encodeURIComponent(taskId)}/relatedDocuments`;

  while (Date.now() < deadline) {
    const res = await fetch(url, { headers: authHeaders(auth) });
    if (!res.ok) throw new Error(`relatedDocuments ${res.status}`);
    const docs = await res.json();
    if (Array.isArray(docs) && docs.length > 0) {
      return docs[0]; // { id, title, repositoryId, ... }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  throw Object.assign(new Error('Generation timed out'), { code: 'TIMEOUT' });
}

// ─── Step 4: Prizm session (go/no-go gate) ─────────────────────────────────
// Tests whether POST /api/documents/preview/ works server-side with session JWT + cookies.
// Returns viewingSessionId string or null if unavailable.

export async function getPrizmSession(relatedDocumentId, auth) {
  const url = `${BASE_URL}/api/documents/preview/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(auth),
    body: JSON.stringify({ relatedDocumentId }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Prizm session ${res.status}: ${body.substring(0, 200)}`);
  const data = JSON.parse(body);
  return data.viewingSessionId ?? null;
}

// ─── Get result for already-generated document ────────────────────────────
// Used when the task is already In Progress (document already generated).
// Skips the phase trigger, polls once, returns the result.

export async function getResult(taskId) {
  const auth = await getSessionAuth();

  // Check if document already exists
  const url = `${BASE_URL}/api/sharedo/${encodeURIComponent(taskId)}/relatedDocuments`;
  const res = await fetch(url, { headers: authHeaders(auth) });
  if (!res.ok) throw new Error(`relatedDocuments ${res.status}`);
  const docs = await res.json();
  if (!Array.isArray(docs) || docs.length === 0) {
    throw Object.assign(new Error('No document found on this task'), { code: 'NO_DOCUMENT' });
  }
  const doc = docs[0];

  return {
    relatedDocumentId: doc.id,
    viewingSessionId: null, // Prizm server-side not supported — widget uses blade
    filename: doc.title ? `${doc.title}.docx` : 'document.docx',
    title: doc.title ?? '',
  };
}

// ─── Full pipeline ─────────────────────────────────────────────────────────
// NOTE: triggerPhase requires the service account to be a formal Sharedo
// participant on the task. For task-activity-prepare-document tasks created
// by Sharedo's workflow engine, participant records must be added via the
// Sharedo UI "Take Ownership" action before the service can trigger generation.
// This restriction does not apply to HotDocs or future provider integrations.

export async function generate(taskId) {
  const auth = await getSessionAuth();

  // Attempt phase trigger — succeeds if service account is a participant
  await triggerPhase(taskId, auth);

  // Poll for document (generation is synchronous in Sharedo OOB)
  const doc = await pollForDocument(taskId, auth);

  // Prizm: not supported server-side — viewingSessionId is always null
  // Widget uses existing blade preview fallback (previewDoc() → DocumentPreview panel)

  return {
    relatedDocumentId: doc.id,
    viewingSessionId: null,
    filename: doc.title ? `${doc.title}.docx` : 'document.docx',
    title: doc.title ?? '',
  };
}
