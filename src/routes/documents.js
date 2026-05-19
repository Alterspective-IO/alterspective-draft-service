/**
 * src/routes/documents.js
 *
 * POST /v1/documents — synchronous document generation endpoint.
 *
 * Request body:
 *  { provider: string, taskId: string, tenantId: string }
 *
 * Response 200:
 *  { relatedDocumentId, viewingSessionId, filename, title }
 *
 * Response 400: validation error (missing fields, unknown tenant/provider)
 * Response 401: missing/invalid API key
 * Response 422: generation failed (permission denied, timeout, no document)
 * Response 500: unexpected server error
 */

import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { getProvider } from '../providers/factory.js';
import { getTenantConfig } from '../config/tenants.js';

const router = Router();

const API_KEY = process.env.API_KEY;

function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // Key not configured — allow all (dev mode)
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const validateBody = [
  body('provider').isString().notEmpty().withMessage('provider is required'),
  body('taskId').isString().notEmpty().withMessage('taskId is required'),
  body('tenantId').isString().notEmpty().withMessage('tenantId is required'),
];

/**
 * Map internal error codes to HTTP status + user-facing message.
 */
function mapError(err) {
  const code = err.code;

  if (code === 'INVALID_TENANT' || code === 'TENANT_NOT_CONFIGURED' || code === 'UNKNOWN_PROVIDER') {
    return { status: 400, body: { error: err.message, code } };
  }

  if (code === 'PERMISSION_DENIED') {
    return {
      status: 422,
      body: {
        error: err.message,
        code,
        hint: 'Open the task in Sharedo and click "Take Ownership" to grant server-side generation access.',
      },
    };
  }

  if (code === 'TIMEOUT') {
    return { status: 422, body: { error: err.message, code } };
  }

  if (code === 'NO_DOCUMENT') {
    return { status: 422, body: { error: err.message, code } };
  }

  if (code === 'UPSTREAM_ERROR') {
    return { status: 502, body: { error: 'Upstream Sharedo error', code, detail: err.upstream } };
  }

  // Auth failure (login)
  if (err.message?.includes('Login failed') || err.message?.includes('_api cookie')) {
    return { status: 502, body: { error: 'Sharedo authentication failed', code: 'AUTH_FAILED' } };
  }

  return { status: 500, body: { error: 'Internal server error' } };
}

router.post('/', requireApiKey, validateBody, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg, fields: errors.array() });
  }

  const { provider: providerName, taskId, tenantId } = req.body;

  let provider, tenantConfig;

  // Resolve provider + tenant config (400-class errors)
  try {
    provider = getProvider(providerName);
  } catch (err) {
    const { status, body } = mapError(err);
    return res.status(status).json(body);
  }

  try {
    tenantConfig = getTenantConfig(tenantId);
  } catch (err) {
    const { status, body } = mapError(err);
    return res.status(status).json(body);
  }

  // Run generation
  try {
    const result = await provider.generate({ taskId, tenantConfig });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[/v1/documents]', err.message, err.code ? `(${err.code})` : '');
    const { status, body } = mapError(err);
    return res.status(status).json(body);
  }
});

export default router;
