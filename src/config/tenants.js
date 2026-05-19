/**
 * src/config/tenants.js
 *
 * Loads per-tenant Sharedo configuration from environment variables.
 * Credentials stay in Coolify env vars — never in request bodies or widget code.
 *
 * Env var pattern:  TENANT_{ID_UPPER}_{KEY}
 *
 * Required vars per tenant:
 *   TENANT_AUSIAB_BASE_URL       e.g. https://ausiab.alterspective.com.au
 *   TENANT_AUSIAB_IDENTITY_URL   e.g. https://id-ausiab.alterspective.com.au
 *   TENANT_AUSIAB_USERNAME       e.g. ai@alterspective.com.au
 *   TENANT_AUSIAB_PASSWORD       (store in Coolify secret env var)
 *
 * @typedef {Object} TenantConfig
 * @property {string} baseUrl
 * @property {string} identityUrl
 * @property {string} username
 * @property {string} password
 */

const REQUIRED_KEYS = ['BASE_URL', 'IDENTITY_URL', 'USERNAME', 'PASSWORD'];

/**
 * Resolve tenant config from env vars.
 * @param {string} tenantId  — e.g. "ausiab"
 * @returns {TenantConfig}
 */
export function getTenantConfig(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw Object.assign(new Error('tenantId is required'), { code: 'INVALID_TENANT' });
  }

  const prefix = `TENANT_${tenantId.toUpperCase().replace(/-/g, '_')}_`;
  const config = {};

  for (const key of REQUIRED_KEYS) {
    const envKey = `${prefix}${key}`;
    const value = process.env[envKey];
    if (!value) {
      throw Object.assign(
        new Error(`Missing env var: ${envKey} (tenant "${tenantId}" is not configured)`),
        { code: 'TENANT_NOT_CONFIGURED', tenantId }
      );
    }
    config[key.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }

  // Validate URL format
  for (const urlKey of ['baseUrl', 'identityUrl']) {
    try { new URL(config[urlKey]); } catch {
      throw Object.assign(new Error(`Invalid URL for ${urlKey}: ${config[urlKey]}`), { code: 'INVALID_TENANT' });
    }
  }

  return config;
}

/**
 * List all configured tenant IDs (for /health endpoint).
 * @returns {string[]}
 */
export function listTenants() {
  const tenants = new Set();
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^TENANT_([A-Z0-9_]+)_BASE_URL$/);
    if (match) tenants.add(match[1].toLowerCase().replace(/_/g, '-'));
  }
  return Array.from(tenants);
}
