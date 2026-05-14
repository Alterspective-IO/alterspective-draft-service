import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../templates');

const templateCache = new Map();

function loadTemplate(name) {
  if (templateCache.has(name)) return templateCache.get(name);

  const path = join(TEMPLATES_DIR, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Template not found: ${name}`);

  const tpl = JSON.parse(readFileSync(path, 'utf8'));
  templateCache.set(name, tpl);
  return tpl;
}

function merge(text, data) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);
}

/**
 * Render a named template with the provided merge fields.
 * @param {string} templateName
 * @param {object} data - merge field values
 * @returns {{ subject: string, body: string, toRecipients: Array }}
 */
export function renderTemplate(templateName, data) {
  const tpl = loadTemplate(templateName);
  return {
    subject: merge(tpl.subject, data),
    body: merge(tpl.body, data),
    toRecipients: tpl.toRecipients || [],
  };
}

