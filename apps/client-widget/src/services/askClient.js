const DEFAULT_API_URL = import.meta.env.VITE_BOB_API_URL || 'https://bob-acr-api.osc-fr1.scalingo.io';
const DEFAULT_API_KEY = import.meta.env.VITE_BOB_API_KEY || '';
const DEFAULT_USER_EMAIL = import.meta.env.VITE_BOB_DEMO_USER_EMAIL || 'salarie.demo@atelier-sud.fr';

function getManagedConfig() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.managed) {
        chrome.storage.managed.get(['api_key', 'api_url', 'user_email'], (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(items || {});
        });
        return;
      }
    } catch {
      // Hors contexte extension Chrome
    }
    resolve({});
  });
}

async function resolveAuthHeaders() {
  const managed = await getManagedConfig();
  const baseUrl = (managed.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
  const apiKey = managed.api_key || DEFAULT_API_KEY;
  const userEmail = managed.user_email || DEFAULT_USER_EMAIL;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return { baseUrl, headers, userEmail };
}

export async function askBob({ question, channel = 'chrome_extension' }) {
  const { baseUrl, headers } = await resolveAuthHeaders();
  const res = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ question, channel }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || errBody.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function acknowledgeDocument({ documentId, userEmail }) {
  const { baseUrl, headers, userEmail: defaultEmail } = await resolveAuthHeaders();
  const res = await fetch(`${baseUrl}/api/acknowledgments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      document_id: documentId,
      user_email: userEmail || defaultEmail,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || errBody.message || `HTTP ${res.status}`);
  }
  return res.json();
}
