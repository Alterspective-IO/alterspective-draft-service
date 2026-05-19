/**
 * src/providers/interface.js
 *
 * IDocumentProvider — the contract every provider must implement.
 *
 * Adding a new provider (e.g., HotDocs):
 *  1. Create src/providers/hotdocs.js implementing the functions below
 *  2. Register in src/providers/factory.js
 *  3. Add TENANT_{ID}_HOTDOCS_* env vars
 *
 * @typedef {Object} DocGenParams
 * @property {string} taskId          — work item ID to generate for
 * @property {Object} tenantConfig    — resolved tenant config object
 *
 * @typedef {Object} DocGenResult
 * @property {string}      relatedDocumentId  — Sharedo relatedDocument ID (DMS-agnostic)
 * @property {string|null} viewingSessionId   — Prizm session (null if unavailable)
 * @property {string}      filename           — suggested filename with extension
 * @property {string}      title              — document title
 *
 * @callback DocGenerateFn
 * @param {DocGenParams} params
 * @returns {Promise<DocGenResult>}
 *
 * @callback DocGetResultFn
 * @param {DocGenParams} params
 * @returns {Promise<DocGenResult>}
 */

/**
 * Validate that an object implements IDocumentProvider.
 * @param {object} provider
 * @param {string} name
 */
export function assertProvider(provider, name) {
  const required = ['generate', 'getResult', 'name'];
  for (const fn of required) {
    if (typeof provider[fn] !== 'function' && typeof provider[fn] !== 'string') {
      throw new Error(`Provider "${name}" is missing required member: ${fn}`);
    }
  }
}
