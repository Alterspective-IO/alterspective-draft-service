/**
 * src/providers/sharedo-oob.js
 *
 * Sharedo OOB document generation provider.
 * Implements IDocumentProvider for task-activity-prepare-document tasks.
 *
 * CONSTRAINTS (discovered in Innovation/docgen isolation testing):
 *  - Phase trigger (generate) requires the service account to be a FORMAL participant
 *    on the specific task. This cannot be configured via API for task-activity-prepare-document —
 *    it must be done via the Sharedo UI "Take Ownership" action before first use.
 *  - Prizm viewing sessions are not accessible server-side (returns 500).
 *    Widget uses the existing blade preview fallback (previewDoc()).
 *
 * When BOTH constraints are not an issue (properly seeded tasks + future Prizm support),
 * this provider works end-to-end synchronously.
 *
 * For future providers (HotDocs, docxtemplater):
 *  - No Sharedo participant constraint — provider manages its own auth
 *  - Add src/providers/hotdocs.js implementing the same export shape
 *  - Register in src/providers/factory.js
 */

import { loginSessionJwt } from './session-jwt.js';

const PHASE_IN_PROGRESS = 'task-activity-prepare-document-in-progress';
const DEFAULT_POLL_TIMEOUT_MS = 25_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export const name = 'sharedo-oob';

/**
 * Trigger phase transition + poll until document appears.
 * Returns immediately if the document already exists (task already In Progress).
 *
 * @param {{ taskId: string, tenantConfig: import('../config/tenants.js').TenantConfig }} params
 * @returns {Promise<import('./interface.js').DocGenResult>}
 */
export async function generate({ taskId, tenantConfig }) {
  const auth = await loginSessionJwt({
    baseUrl:     tenantConfig.baseUrl,
    identityUrl: tenantConfig.identityUrl,
    username:    tenantConfig.username,
    password:    tenantConfig.password,
  });

  // Check if document already exists (idempotent — skip trigger if so)
  const existing = await fetchRelatedDocuments(taskId, auth, tenantConfig.baseUrl);
  if (existing.length > 0) return buildResult(existing[0]);

  // Trigger phase transition
  await triggerPhase(taskId, auth, tenantConfig.baseUrl);

  // Poll for document (Sharedo OOB generation is synchronous — doc appears immediately)
  const doc = await pollForDocument(taskId, auth, tenantConfig.baseUrl);

  return buildResult(doc);
}

/**
 * Return result for a task that has already been generated (already In Progress).
 * Does NOT trigger phase transition — use when you know the document exists.
 *
 * @param {{ taskId: string, tenantConfig: import('../config/tenants.js').TenantConfig }} params
 * @returns {Promise<import('./interface.js').DocGenResult>}
 */
export async function getResult({ taskId, tenantConfig }) {
  const auth = await loginSessionJwt({
    baseUrl:     tenantConfig.baseUrl,
    identityUrl: tenantConfig.identityUrl,
    username:    tenantConfig.username,
    password:    tenantConfig.password,
  });

  const docs = await fetchRelatedDocuments(taskId, auth, tenantConfig.baseUrl);
  if (docs.length === 0) {
    throw Object.assign(
      new Error('No document found on this task — generate first'),
      { code: 'NO_DOCUMENT' }
    );
  }
  return buildResult(docs[0]);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function authHeaders(auth) {
  return {
    Authorization:      `Bearer ${auth.token}`,
    Cookie:             auth.cookieHeader,
    'Content-Type':     'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

async function triggerPhase(taskId, auth, baseUrl) {
  const url = `${baseUrl}/api/sharedo/${encodeURIComponent(taskId)}/phase`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(auth),
    body: JSON.stringify({ toPhaseSystemName: PHASE_IN_PROGRESS }),
  });

  if (res.ok) return;

  const body = await res.text();

  if (res.status === 403) {
    throw Object.assign(
      new Error(
        `Permission denied on task ${taskId}. ` +
        'The service account must be a formal participant on this task. ' +
        'Open the task in Sharedo and use "Take Ownership" to enable server-side generation.'
      ),
      { code: 'PERMISSION_DENIED', status: 403 }
    );
  }

  if (res.status === 500) {
    throw Object.assign(
      new Error(
        `Sharedo internal error on phase trigger (500). ` +
        'This usually means the service account is not a participant on this task. ' +
        'Open the task in Sharedo and use "Take Ownership" to enable server-side generation.'
      ),
      { code: 'PERMISSION_DENIED', status: 500, upstream: body.substring(0, 200) }
    );
  }

  throw Object.assign(
    new Error(`Phase trigger failed ${res.status}`),
    { code: 'UPSTREAM_ERROR', status: res.status, upstream: body.substring(0, 200) }
  );
}

async function fetchRelatedDocuments(taskId, auth, baseUrl) {
  const url = `${baseUrl}/api/sharedo/${encodeURIComponent(taskId)}/relatedDocuments`;
  const res = await fetch(url, { headers: authHeaders(auth) });
  if (!res.ok) throw new Error(`relatedDocuments ${res.status}`);
  const docs = await res.json();
  return Array.isArray(docs) ? docs : [];
}

async function pollForDocument(taskId, auth, baseUrl) {
  const timeout = Number(process.env.POLL_TIMEOUT_MS) || DEFAULT_POLL_TIMEOUT_MS;
  const interval = Number(process.env.POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const docs = await fetchRelatedDocuments(taskId, auth, baseUrl);
    if (docs.length > 0) return docs[0];
    await new Promise(r => setTimeout(r, interval));
  }

  throw Object.assign(
    new Error(`Generation timed out after ${timeout}ms — no document found`),
    { code: 'TIMEOUT' }
  );
}

function buildResult(doc) {
  return {
    relatedDocumentId: doc.id,
    viewingSessionId:  null, // Prizm not accessible server-side — widget uses blade preview
    filename: doc.title ? `${doc.title}.docx` : 'document.docx',
    title: doc.title ?? '',
  };
}
