import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let msalApp = null;

function getMsalApp() {
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.ENTRA_CLIENT_ID,
        clientSecret: process.env.ENTRA_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
      },
    });
  }
  return msalApp;
}

async function getAccessToken() {
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (!result?.accessToken) throw new Error('Failed to acquire Graph token');
  return result.accessToken;
}

/**
 * Create an Outlook draft in the specified user's mailbox.
 * @param {string} userEmail - UPN of the mailbox owner
 * @param {object} draft - { subject, body, toRecipients: [{emailAddress:{name,address}}] }
 * @returns {{ id: string, webLink: string }}
 */
export async function createDraft(userEmail, draft) {
  const token = await getAccessToken();

  const message = {
    subject: draft.subject,
    importance: 'normal',
    body: {
      contentType: 'HTML',
      content: draft.body,
    },
    toRecipients: (draft.toRecipients || []).map((r) =>
      typeof r === 'string'
        ? { emailAddress: { address: r } }
        : r
    ),
  };

  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }

  const created = await res.json();
  return {
    id: created.id,
    webLink: created.webLink,
  };
}
