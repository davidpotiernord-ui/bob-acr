function getWidgetSessionOverride() {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash || "";
  const m = hash.match(/bob_token=([^&]+)/);
  if (m) {
    const tok = decodeURIComponent(m[1]);
    window.localStorage?.setItem("bob_widget_session_token", tok);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return tok;
  }
  return window.localStorage?.getItem("bob_widget_session_token") || "";
}

const DEFAULT_API_URL = import.meta.env.VITE_BOB_API_URL || 'https://bob-acr-api.osc-fr1.scalingo.io';
const DEFAULT_API_KEY = import.meta.env.VITE_BOB_API_KEY || '';
const DEFAULT_USER_EMAIL = import.meta.env.VITE_BOB_DEMO_USER_EMAIL || 'salarie.demo@atelier-sud.fr';
const TRACKED_STORAGE_KEY = 'bob_tracked_escalations_v1';

function getManagedConfig() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.managed) {
        chrome.storage.managed.get(['api_key', 'api_url', 'user_email'], (items) => {
          if (chrome.runtime && chrome.runtime.lastError) return resolve({});
          resolve(items || {});
        });
        return;
      }
    } catch {}
    resolve({});
  });
}

async function resolveAuthHeaders() {
  const managed = await getManagedConfig();
  const baseUrl = (managed.api_url || DEFAULT_API_URL).replace(/\/+$/, '');
  const sessionToken = (typeof window !== "undefined" && window.localStorage?.getItem("bob_widget_session_token")) || "";
  const sessionUser = (() => { try { return JSON.parse(window.localStorage?.getItem("bob_widget_session_user") || "null"); } catch { return null; } })();
  const apiKey = sessionToken || managed.api_key || DEFAULT_API_KEY;
  const userEmail = sessionUser?.email || managed.user_email || DEFAULT_USER_EMAIL;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return { baseUrl, headers, userEmail };
}

export function loadTrackedEscalations() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([TRACKED_STORAGE_KEY], (items) => {
          if (chrome.runtime && chrome.runtime.lastError) return resolve([]);
          resolve(Array.isArray(items?.[TRACKED_STORAGE_KEY]) ? items[TRACKED_STORAGE_KEY] : []);
        });
        return;
      }
      const raw = window.localStorage.getItem(TRACKED_STORAGE_KEY);
      resolve(raw ? JSON.parse(raw) : []);
    } catch {
      resolve([]);
    }
  });
}

export async function saveTrackedEscalation(entry) {
  const current = await loadTrackedEscalations();
  const next = [entry, ...current.filter((item) => item.query_id !== entry.query_id)].slice(0, 30);
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [TRACKED_STORAGE_KEY]: next }, () => resolve(next));
        return;
      }
      window.localStorage.setItem(TRACKED_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    resolve(next);
  });
}

async function postJson(path, body) {
  const { baseUrl, headers } = await resolveAuthHeaders();
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || errBody.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const askBob = ({ question, channel = 'chrome_extension' }) =>
  postJson('/api/query', { question, channel });

export const escalateQuery = ({ queryId }) =>
  postJson('/api/escalate', { query_id: queryId });

export const fetchEscalationsStatus = (queryIds = []) =>
  postJson('/api/escalations/status', { query_ids: Array.isArray(queryIds) ? queryIds : [] });

export const acknowledgeEscalationAnswer = ({ queryId }) =>
  postJson(`/api/escalations/${queryId}/acknowledge`, {});

export async function acknowledgeDocument({ documentId, userEmail }) {
  const { userEmail: defaultEmail } = await resolveAuthHeaders();
  return postJson('/api/acknowledgments', {
    document_id: documentId,
    user_email: userEmail || defaultEmail,
  });
}

export async function fetchPendingPushes() {
  const { baseUrl, headers, userEmail } = await resolveAuthHeaders();
  const res = await fetch(`${baseUrl}/api/widget/pushes/pending?user=${encodeURIComponent(userEmail)}`, { headers });
  if (!res.ok) return { unreadCount: 0, pushes: [] };
  return res.json();
}

export async function respondToPush(pushId, { selectedOption = null, freeText = null } = {}) {
  const { baseUrl, headers, userEmail } = await resolveAuthHeaders();
  const res = await fetch(`${baseUrl}/api/widget/pushes/${pushId}/respond`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ userIdentifier: userEmail, selectedOption, freeText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erreur envoi réponse');
  return data;
}
