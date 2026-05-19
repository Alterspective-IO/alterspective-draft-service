/**
 * Innovation/docgen/test.js
 * Run: node Innovation/docgen/test.js [step]
 * Steps: auth | trigger | poll | prizm | full
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessionAuth, triggerPhase, pollForDocument, getPrizmSession, generate } from './SharedoOobProvider.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .filter(([k, v]) => k && v)
);
const TASK_ID = env.TEST_TASK_ID;
const step = process.argv[2] || 'auth';

console.log(`\n=== SharedoOobProvider isolation test: ${step} ===`);
console.log(`Task: ${TASK_ID}\n`);

async function run() {
  if (step === 'auth') {
    const auth = await getSessionAuth();
    console.log('PASS — session JWT acquired');
    console.log('  token (first 20):', auth.token.substring(0, 20) + '...');
    console.log('  cookies:', auth.cookieHeader.substring(0, 80) + '...');
    console.log('  expires:', new Date(auth.expiresAt).toISOString());
  }

  else if (step === 'trigger') {
    const auth = await getSessionAuth();
    const result = await triggerPhase(TASK_ID, auth);
    console.log('PASS — phase triggered:', result);
  }

  else if (step === 'poll') {
    const auth = await getSessionAuth();
    console.log('Polling for document (max 30s)...');
    const doc = await pollForDocument(TASK_ID, auth);
    console.log('PASS — document found:', JSON.stringify(doc, null, 2));
  }

  else if (step === 'prizm') {
    if (!process.argv[3]) {
      console.error('Usage: node test.js prizm <relatedDocumentId>');
      process.exit(1);
    }
    const relatedDocId = process.argv[3];
    const auth = await getSessionAuth();
    const sessionId = await getPrizmSession(relatedDocId, auth);
    if (sessionId) {
      console.log('PASS — Prizm viewingSessionId:', sessionId.substring(0, 40) + '...');
      console.log('\nTo verify: open Sharedo in a browser and navigate to:');
      console.log(`  GET /api/prizm-proxy/Document/q/Attributes?DocumentID=u${sessionId}`);
      console.log('If it returns {pageCount: N}, Prizm is working server-side.');
    } else {
      console.log('FAIL — viewingSessionId was null (Prizm not accessible server-side)');
    }
  }

  else if (step === 'full') {
    console.log('Running full pipeline...');
    const result = await generate(TASK_ID);
    console.log('PASS — result:', JSON.stringify(result, null, 2));
    if (!result.viewingSessionId) {
      console.log('\nNOTE: viewingSessionId is null — widget will use blade fallback (acceptable)');
    } else {
      console.log('\nNOTE: viewingSessionId present — widget can render inline Prizm viewer');
    }
  }

  else {
    console.error('Unknown step:', step);
    console.error('Valid steps: auth | trigger | poll | prizm <docId> | full');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('\nFAIL —', err.message);
  if (err.status) console.error('HTTP status:', err.status);
  if (err.body) console.error('Response body:', err.body);
  if (err.code) console.error('Error code:', err.code);
  process.exit(1);
});
