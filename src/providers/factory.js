/**
 * src/providers/factory.js
 *
 * Provider factory — maps provider name strings to provider implementations.
 *
 * Adding a new provider:
 *  1. Create src/providers/{name}.js with { name, generate, getResult } exports
 *  2. Import it here and add to PROVIDERS map
 */

import * as SharedoOob from './sharedo-oob.js';
import { assertProvider } from './interface.js';

const PROVIDERS = new Map([
  ['sharedo-oob', SharedoOob],
  // ['hotdocs', HotDocs],         // future
  // ['docxtemplater', Docxtemplater], // future
]);

// Validate all registered providers at startup
for (const [name, provider] of PROVIDERS) {
  assertProvider(provider, name);
}

/**
 * Get a provider instance by name.
 * @param {string} providerName
 * @returns {{ generate: Function, getResult: Function, name: string }}
 */
export function getProvider(providerName) {
  const provider = PROVIDERS.get(providerName);
  if (!provider) {
    throw Object.assign(
      new Error(`Unknown provider: "${providerName}". Valid options: ${Array.from(PROVIDERS.keys()).join(', ')}`),
      { code: 'UNKNOWN_PROVIDER' }
    );
  }
  return provider;
}

/**
 * List all registered provider names.
 * @returns {string[]}
 */
export function listProviders() {
  return Array.from(PROVIDERS.keys());
}
