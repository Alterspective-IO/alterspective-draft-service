/**
 * src/providers/session-jwt.js
 *
 * 6-step OIDC browser login simulation — ported from sharedo-mcp's session-jwt.ts.
 *
 * Required because Sharedo's phase transition endpoint validates browser session
 * cookies in addition to the Bearer token. SCIM Impersonate.Fixed (token-only)
 * returns 500 on phase transition endpoints.
 *
 * @param {{ baseUrl: string, identityUrl: string, username: string, password: string }} options
 * @returns {Promise<{ token: string, cookieHeader: string, expiresAt: number }>}
 */

const MAX_REDIRECTS = 30;

export async function loginSessionJwt({ baseUrl, identityUrl, username, password }) {
  const cookieJar = new Map();

  const step1 = await fetchWithCookies(`${baseUrl}/`, cookieJar, { redirect: 'follow' });
  const loginPageHtml = await step1.text();
  const loginPageUrl = step1.url;

  const signinMatch = loginPageUrl.match(/signin=([a-f0-9]+)/i);
  if (!signinMatch) throw new Error(`No signin ID in login URL: ${loginPageUrl}`);
  const signinId = signinMatch[1];

  const antiForgeryToken = extractAntiForgeryToken(loginPageHtml);
  if (!antiForgeryToken) throw new Error('No antiForgery token in login page');

  const loginBody = new URLSearchParams({
    username, password, rememberMe: 'false', signin: signinId, 'idsrv.xsrf': antiForgeryToken,
  });
  const step3 = await fetchWithCookies(`${identityUrl}/login?signin=${signinId}`, cookieJar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString(),
    redirect: 'follow',
  });
  const callbackHtml = await step3.text();

  const formActionMatch = callbackHtml.match(/<form[^>]+action="([^"]+)"/);
  if (!formActionMatch) {
    if (callbackHtml.includes('Invalid username or password')) throw new Error('Login failed: invalid credentials');
    throw new Error('OIDC callback form not found in response');
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

  const step5 = await fetchWithCookies(formAction, cookieJar, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: hiddenFields.toString(),
    redirect: 'follow',
  });
  await step5.text();

  const apiCookie = cookieJar.get('_api');
  if (!apiCookie) {
    throw new Error(`_api cookie not found after login. Available: ${Array.from(cookieJar.keys()).join(', ')}`);
  }

  const payload = parseJwtPayload(apiCookie);
  const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 15 * 60 * 1000;
  const cookieHeader = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

  return { token: apiCookie, cookieHeader, expiresAt };
}

async function fetchWithCookies(url, cookieJar, init = {}) {
  let currentUrl = url;
  let currentInit = { ...init };
  let redirectCount = 0;

  while (true) {
    const cookieHeader = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    const headers = new Headers(currentInit.headers);
    if (cookieHeader) headers.set('Cookie', cookieHeader);

    const response = await fetch(currentUrl, {
      ...currentInit, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });

    for (const sc of (response.headers.getSetCookie?.() ?? [])) {
      const nv = sc.split(';')[0];
      const idx = nv.indexOf('=');
      if (idx > 0) cookieJar.set(nv.substring(0, idx).trim(), nv.substring(idx + 1).trim());
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect || init.redirect === 'manual') return response;
    if (++redirectCount > MAX_REDIRECTS) throw new Error(`Too many redirects: ${currentUrl}`);

    const location = response.headers.get('Location');
    if (!location) return response;

    currentUrl = new URL(location, currentUrl).href;
    if (currentInit.method === 'POST' && [301, 302, 303].includes(response.status)) currentInit = {};
    await response.text().catch(() => {});
  }
}

function extractAntiForgeryToken(html) {
  const m = html.match(/<script[^>]+id="modelJson"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const model = JSON.parse(m[1]);
      if (model?.antiForgery?.value) return model.antiForgery.value;
    } catch {}
  }
  return (html.match(/"antiForgery"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/) || [])[1] ?? null;
}

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

function parseJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')); } catch { return {}; }
}
