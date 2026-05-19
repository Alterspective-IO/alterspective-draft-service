/**
 * Innovation/docgen/session-jwt.js
 *
 * Port of sharedo-mcp's session-jwt.ts to plain JavaScript ES Modules.
 * Performs the 6-step OIDC browser login simulation to get a session JWT + cookie jar.
 *
 * This is required because Sharedo's phase transition endpoint needs BOTH:
 *  - Authorization: Bearer {_api cookie value}
 *  - Cookie: {full cookie header from OIDC flow}
 *
 * SCIM tokens (without cookies) return 500 on phase transitions.
 */

const MAX_REDIRECTS = 30;

/**
 * @param {{ baseUrl: string, identityUrl: string, username: string, password: string }} options
 * @returns {Promise<{ token: string, cookieHeader: string, expiresAt: number }>}
 */
export async function loginSessionJwt({ baseUrl, identityUrl, username, password }) {
  const cookieJar = new Map();

  // Step 1: Load app root — follow OIDC redirects to identity login page
  const step1 = await fetchWithCookies(`${baseUrl}/`, cookieJar, { redirect: 'follow' });
  const loginPageHtml = await step1.text();
  const loginPageUrl = step1.url;

  // Step 2: Extract signin ID + antiForgery token
  const signinMatch = loginPageUrl.match(/signin=([a-f0-9]+)/i);
  if (!signinMatch) throw new Error(`No signin ID in URL: ${loginPageUrl}`);
  const signinId = signinMatch[1];

  const antiForgeryToken = extractAntiForgeryToken(loginPageHtml);
  if (!antiForgeryToken) throw new Error('No antiForgery token in login page HTML');

  // Step 3: POST credentials
  const loginBody = new URLSearchParams({
    username,
    password,
    rememberMe: 'false',
    signin: signinId,
    'idsrv.xsrf': antiForgeryToken,
  });

  const step3 = await fetchWithCookies(`${identityUrl}/login?signin=${signinId}`, cookieJar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString(),
    redirect: 'follow',
  });
  const callbackHtml = await step3.text();

  // Step 4: Parse OIDC callback form
  const formActionMatch = callbackHtml.match(/<form[^>]+action="([^"]+)"/);
  if (!formActionMatch) {
    if (callbackHtml.includes('Invalid username or password')) {
      throw new Error('Login failed: Invalid username or password');
    }
    throw new Error('Failed to find OIDC callback form in response');
  }
  const formAction = decodeHtmlEntities(formActionMatch[1]);

  const hiddenFields = new URLSearchParams();
  for (const rx of [
    /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g,
    /<input[^>]+name="([^"]+)"[^>]+type="hidden"[^>]+value="([^"]*)"/g,
  ]) {
    let m;
    while ((m = rx.exec(callbackHtml)) !== null) {
      if (!hiddenFields.has(m[1])) hiddenFields.set(m[1], decodeHtmlEntities(m[2]));
    }
  }

  // Step 5: Submit callback form
  const step5 = await fetchWithCookies(formAction, cookieJar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: hiddenFields.toString(),
    redirect: 'follow',
  });
  await step5.text();

  // Step 6: Extract JWT from _api cookie
  const apiCookie = cookieJar.get('_api');
  if (!apiCookie) {
    throw new Error(`_api cookie not found. Available: ${Array.from(cookieJar.keys()).join(', ')}`);
  }

  const payload = parseJwtPayload(apiCookie);
  const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 15 * 60 * 1000;

  const cookieHeader = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  return { token: apiCookie, cookieHeader, expiresAt };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function fetchWithCookies(url, cookieJar, init = {}) {
  let currentUrl = url;
  let currentInit = { ...init };
  let redirectCount = 0;

  while (true) {
    const cookieHeader = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    const headers = new Headers(currentInit.headers);
    if (cookieHeader) headers.set('Cookie', cookieHeader);

    const response = await fetch(currentUrl, {
      ...currentInit,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    // Capture cookies
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const nameValue = sc.split(';')[0];
      const idx = nameValue.indexOf('=');
      if (idx > 0) cookieJar.set(nameValue.substring(0, idx).trim(), nameValue.substring(idx + 1).trim());
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect || init.redirect === 'manual') return response;

    redirectCount++;
    if (redirectCount > MAX_REDIRECTS) throw new Error(`Too many redirects: ${currentUrl}`);

    const location = response.headers.get('Location');
    if (!location) return response;

    currentUrl = new URL(location, currentUrl).href;
    if (currentInit.method === 'POST' && [301, 302, 303].includes(response.status)) {
      currentInit = {};
    }
    await response.text().catch(() => {});
  }
}

function extractAntiForgeryToken(html) {
  const modelJsonMatch = html.match(/<script[^>]+id="modelJson"[^>]*>([\s\S]*?)<\/script>/);
  if (modelJsonMatch) {
    try {
      const model = JSON.parse(modelJsonMatch[1]);
      if (model?.antiForgery?.value) return model.antiForgery.value;
    } catch {}
  }
  const m1 = html.match(/"antiForgery"\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"value"\s*:\s*"([^"]+)"/);
  if (m1) return m1[1];
  const m2 = html.match(/"antiForgery"\s*:\s*\{\s*"value"\s*:\s*"([^"]+)"/);
  if (m2) return m2[1];
  return null;
}

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')); } catch { return {}; }
}
