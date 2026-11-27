import React, { useEffect, useState } from 'react';
import DedicatedReferentPortal from "./DedicatedReferentPortal";
import {
  ShieldCheck,
  FileText,
  AlertTriangle,
  Settings,
  Download,
  Lock,
  CheckCircle2,
  PlusCircle,
  RefreshCw,
  FileCheck2,
  BarChart3,
  Users,
} from 'lucide-react';
import {
  useReferentGovernance,
  ScopeToolbar,
  PerimeterKpiGrid,
  ReferentTabContent,
} from './ReferentWorkspace';

const API_BASE = import.meta.env.VITE_API_URL || 'https://bob-acr-api.osc-fr1.scalingo.io/api';
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

const API_ORIGIN = API_BASE.replace(/\/api\/?$/, "");
const SESSION_TOKEN_KEY = "bob_session_token";
const SESSION_USER_KEY = "bob_session_user";

function getSessionToken() {
  if (typeof window === "undefined") return "";
  return window.sessionStorage?.getItem(SESSION_TOKEN_KEY) || "";
}

function setSessionToken(token) {
  if (typeof window === "undefined") return;
  if (token) window.sessionStorage?.setItem(SESSION_TOKEN_KEY, token);
  else window.sessionStorage?.removeItem(SESSION_TOKEN_KEY);
}

function getStoredSessionUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.sessionStorage?.getItem(SESSION_USER_KEY) || "null");
  } catch {
    return null;
  }
}

function setStoredSessionUser(user) {
  if (typeof window === "undefined") return;
  if (user) window.sessionStorage?.setItem(SESSION_USER_KEY, JSON.stringify(user));
  else window.sessionStorage?.removeItem(SESSION_USER_KEY);
}

function getAuthHeaders(extra = {}) {
  const token =
    getSessionToken() ||
    (typeof window !== "undefined" && window.sessionStorage?.getItem("bob_admin_key")) ||
    import.meta.env.VITE_BOB_ADMIN_KEY ||
    "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export default function App() {
  const referentToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("referent_token") : null;
  if (referentToken) return <DedicatedReferentPortal token={referentToken} apiBase={API_BASE} />;
  const [tab, setTab] = useState('referent');
  const [useSharedBase, setUseSharedBase] = useState(true);
  const [authMode, setAuthMode] = useState('sso');
  const [exported, setExported] = useState(false);
  const [sessionUser, setSessionUser] = useState(() => getStoredSessionUser());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDiscovery, setAuthDiscovery] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authFeedback, setAuthFeedback] = useState("");

  const [overview, setOverview] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [acknowledgments, setAcknowledgments] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [pushResponses, setPushResponses] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replySaving, setReplySaving] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [adminKeyInput, setAdminKeyInput] = useState(() =>
    (typeof window !== 'undefined' && window.sessionStorage?.getItem('bob_admin_key')) ||
    import.meta.env.VITE_BOB_ADMIN_KEY ||
    ''
  );

  const [title, setTitle] = useState('');
  const [moduleCode, setModuleCode] = useState('socle_ri');
  const [version, setVersion] = useState('1.0');
  const [requiresAck, setRequiresAck] = useState(true);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const gov = useReferentGovernance({ documents, acknowledgments, escalations, apiBase: API_BASE, getAuthHeaders });

  const fetchAll = async () => {
    setLoading(true);
    setErrorMsg('');
    const headers = getAuthHeaders();
    try {
      const [ovRes, docRes, ackRes, escRes, pushRespRes] = await Promise.all([
        fetch(`${API_BASE}/admin/overview`, { headers }),
        fetch(`${API_BASE}/documents`, { headers }),
        fetch(`${API_BASE}/acknowledgments`, { headers }),
        fetch(`${API_BASE}/admin/escalations`, { headers }),
        fetch(`${API_BASE}/admin/pushes/responses`, { headers }),
      ]);

      if (!ovRes.ok || !docRes.ok || !ackRes.ok || !escRes.ok) {
        throw new Error(`HTTP ${ovRes.status}/${docRes.status}/${ackRes.status}/${escRes.status}`);
      }

      const [ovData, docData, ackData, escData] = await Promise.all([
        ovRes.json(),
        docRes.json(),
        ackRes.json(),
        escRes.json(),
      ]);

      setOverview(ovData.overview || null);
      setDocuments(docData.documents || []);
      setAcknowledgments(ackData.acknowledgments || []);
      setEscalations(escData.escalations || []);
      if (pushRespRes && pushRespRes.ok) {
        const prData = await pushRespRes.json();
        setPushResponses(Array.isArray(prData.responses) ? prData.responses : []);
      }
    } catch (err) {
      setErrorMsg(`Synchronisation API : ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const hydrateFromToken = async (token) => {
    if (!token) return null;
    try {
      const res = await fetch(`${API_ORIGIN}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.tenant?.authMode) setAuthMode(data.tenant.authMode);
      if (data.user) {
        setSessionUser(data.user);
        setStoredSessionUser(data.user);
      }
      return data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const match = hash.match(/bob_token=([^&]+)/);
      if (match) {
        const tok = decodeURIComponent(match[1]);
        setSessionToken(tok);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        hydrateFromToken(tok).then(() => fetchAll());
        return;
      }
    }
    if (getSessionToken()) {
      hydrateFromToken(getSessionToken());
    }
    fetchAll();
  }, []);

  const handleDiscoverAuth = async (e) => {
    e.preventDefault();
    setAuthFeedback("");
    setAuthBusy(true);
    try {
      const redirectUri = typeof window !== "undefined" ? window.location.origin + window.location.pathname : undefined;
      const res = await fetch(`${API_ORIGIN}/auth/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim().toLowerCase(), redirectUri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Organisation introuvable");
      setAuthDiscovery(data);
    } catch (err) {
      setAuthFeedback(err.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLocalPasswordLogin = async (e) => {
    e.preventDefault();
    setAuthFeedback("");
    setAuthBusy(true);
    try {
      const res = await fetch(`${API_ORIGIN}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim().toLowerCase(), password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Identifiants invalides");
      setSessionToken(data.token);
      setSessionUser(data.user);
      setStoredSessionUser(data.user);
      setAuthPassword("");
      setAuthModalOpen(false);
      await fetchAll();
    } catch (err) {
      setAuthFeedback(err.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSessionLogout = async () => {
    const tok = getSessionToken();
    if (tok) {
      await fetch(`${API_ORIGIN}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}` },
      }).catch(() => {});
    }
    setSessionToken("");
    setSessionUser(null);
    setStoredSessionUser(null);
    setAuthDiscovery(null);
    await fetchAll();
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting || !gov.roleMeta.canWrite) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          title,
          module_code: moduleCode,
          version,
          requires_acknowledgment: requiresAck,
          content,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTitle('');
      setContent('');
      await fetchAll();
    } catch (err) {
      setErrorMsg(`Erreur lors de l'ingestion : ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplyEscalation = async (queryId) => {
    const answerText = (replyDrafts[queryId] || '').trim();
    if (!answerText || replySaving[queryId] || !gov.roleMeta.canWrite) return;
    setReplySaving((prev) => ({ ...prev, [queryId]: true }));
    try {
      const res = await fetch(`${API_BASE}/admin/escalations/${queryId}/reply`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ answer: answerText, answeredBy: gov.activeReferent?.name }),
      });
      const data = await res.json();
      if (res.ok && data.escalation) {
        const targetEsc = escalations.find((item) => item.id === queryId);
        setEscalations((prev) =>
          prev.map((item) => (item.id === queryId ? { ...item, ...data.escalation } : item))
        );
        setReplyDrafts((prev) => ({ ...prev, [queryId]: '' }));
        if (gov.publishToKnowledgeBase[queryId] && targetEsc) {
          await fetch(`${API_BASE}/documents`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              title: `Réponse référent — ${(targetEsc.question_topic || 'Conformité').slice(0, 80)}`,
              module_code: targetEsc.module_code || 'socle_ri',
              version: '1.0',
              requires_acknowledgment: false,
              content: `Question : ${targetEsc.question_topic || ''}\n\nRéponse officielle (${gov.activeReferent.name}) : ${answerText}`,
            }),
          }).catch(() => {});
          await fetchAll();
        }
      }
    } finally {
      setReplySaving((prev) => ({ ...prev, [queryId]: false }));
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'proof_type',
      'id',
      'acknowledged_at',
      'user_email',
      'full_name',
      'department',
      'document_id',
      'document_title',
      'document_version',
      'module_code',
      'sha256_hash',
    ];
    const escapeCsv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

    const docRows = (acknowledgments || []).map((a) => ({
      proof_type: 'document_acknowledgment',
      id: a.id,
      acknowledged_at: a.acknowledged_at,
      user_email: a.user_email ?? '',
      full_name: a.full_name ?? '',
      department: a.department ?? '',
      document_id: a.document_id ?? '',
      document_title: a.document_title ?? '',
      document_version: a.document_version ?? '',
      module_code: a.module_code ?? '',
      sha256_hash: a.sha256_hash ?? '',
    }));

    const refRows = (escalations || [])
      .filter((e) => e.referent_acknowledged_at)
      .map((e) => ({
        proof_type: 'referent_answer_acknowledgment',
        id: e.id,
        acknowledged_at: e.referent_acknowledged_at,
        user_email: '',
        full_name: e.answered_by_role || 'Référent Conformité',
        department: '',
        document_id: '',
        document_title: e.question_topic ? `Question : ${e.question_topic}` : '',
        document_version: '',
        module_code: e.module_code ?? '',
        sha256_hash: e.referent_answer_sha256 ?? '',
      }));

    const allRows = [...docRows, ...refRows];
    const csvLines = allRows.map((row) => headers.map((h) => escapeCsv(row[h])).join(','));
    const csv = '\uFEFF' + [headers.join(','), ...csvLines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bob-acr-emargements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportPdf = () => {
    const win = window.open('', '_blank', 'width=1150,height=780');
    if (!win) {
      setErrorMsg('Fenêtre pop-up bloquée : autorisez les pop-ups pour générer le PDF.');
      return;
    }

    const escapeHtml = (v) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const formatDate = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
    };

    const dateStr = new Date().toLocaleString('fr-FR');

    const docRows = (documents || [])
      .map(
        (d) =>
          `<tr>
        <td class="col-mod">${escapeHtml(d.module_code || '')}</td>
        <td class="col-title">${escapeHtml(d.title || '')}</td>
        <td class="col-ver">${escapeHtml(d.version || '')}</td>
        <td class="col-hash"><code>${escapeHtml(d.sha256_hash || '')}</code></td>
      </tr>`
      )
      .join('');

    const docAckRows = (acknowledgments || []).map((a) => ({
      type: 'Document',
      subject: a.document_title || '',
      ackAt: formatDate(a.acknowledged_at),
      actor: a.user_email || a.full_name || 'Salarié',
      hash: a.sha256_hash || '',
    }));

    const refAckRows = (escalations || [])
      .filter((e) => e.referent_acknowledged_at)
      .map((e) => ({
        type: 'Question escaladée',
        subject: e.question_topic || 'Réponse référent',
        ackAt: formatDate(e.referent_acknowledged_at),
        actor: e.answered_by_role || 'Référent Conformité',
        hash: e.referent_answer_sha256 || '',
      }));

    const allAckRows = [...refAckRows, ...docAckRows];
    const ackRows = allAckRows
      .map(
        (r) =>
          `<tr>
        <td class="col-type"><span class="tag ${r.type === 'Question escaladée' ? 'tag-q' : 'tag-d'}">${escapeHtml(r.type)}</span></td>
        <td class="col-subject">${escapeHtml(r.subject)}</td>
        <td class="col-ack"><span class="badge-ok">ÉMARGÉ</span><div class="ack-time">${escapeHtml(r.ackAt)}</div></td>
        <td class="col-actor">${escapeHtml(r.actor)}</td>
        <td class="col-hash"><code>${escapeHtml(r.hash)}</code></td>
      </tr>`
      )
      .join('');

    win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Preuve Art. R. 1321-1 — BOB</title>
    <style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 6px; color: #0f172a; margin: 0; }
      h1 { font-size: 17px; margin: 0 0 4px 0; }
      p.meta { font-size: 11.5px; color: #475569; margin: 0 0 14px 0; }
      h2 { font-size: 13.5px; margin: 16px 0 7px 0; color: #1e293b; page-break-after: avoid; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 7px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; font-weight: 600; color: #0f172a; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      .col-mod { width: 10%; word-break: break-word; }
      .col-title { width: 42%; word-break: break-word; }
      .col-ver { width: 8%; }
      .col-type { width: 12%; }
      .col-subject { width: 28%; word-break: break-word; font-weight: 500; }
      .col-ack { width: 15%; }
      .col-actor { width: 17%; word-break: break-word; }
      .col-hash { width: 28%; }
      .badge-ok { display: inline-block; background: #dcfce7; color: #166534; border: 1px solid #86efac; font-weight: 700; font-size: 8.5px; padding: 1px 5px; border-radius: 4px; margin-bottom: 3px; }
      .ack-time { font-size: 9.5px; color: #334155; font-variant-numeric: tabular-nums; }
      .tag { display: inline-block; font-size: 8.5px; font-weight: 600; padding: 2px 5px; border-radius: 4px; }
      .tag-q { background: #e0e7ff; color: #3730a3; }
      .tag-d { background: #f1f5f9; color: #334155; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5px; line-height: 1.3; display: block; word-break: break-all; overflow-wrap: anywhere; color: #1e293b; }
    </style></head><body>
      <h1>Dossier de preuve réglementaire — Code du travail Art. R. 1321-1</h1>
      <p class="meta">Atelier Métal &amp; Industrie du Sud SAS • Généré le ${escapeHtml(dateStr)}</p>
      <h2>Registre des émargements &amp; questions escaladées (${allAckRows.length})</h2>
      <table>
        <thead>
          <tr>
            <th class="col-type">Type</th>
            <th class="col-subject">Question / Document</th>
            <th class="col-ack">Émargement horodaté</th>
            <th class="col-actor">Signataire / Rôle</th>
            <th class="col-hash">Preuve SHA-256</th>
          </tr>
        </thead>
        <tbody>${ackRows}</tbody>
      </table>
      <h2>Documents &amp; empreintes SHA-256 (${(documents || []).length})</h2>
      <table>
        <thead><tr><th class="col-mod">Module</th><th class="col-title">Titre</th><th class="col-ver">Version</th><th class="col-hash">SHA-256</th></tr></thead>
        <tbody>${docRows}</tbody>
      </table>
      <script>window.onload=()=>setTimeout(()=>window.print(),250);</script>
    </body></html>`);
    win.document.close();
  };

  const handleExportProof = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      legal_reference: 'Code du travail — Art. R. 1321-1 (Opposabilité & traçabilité)',
      tenant: 'Atelier Métal & Industrie du Sud SAS',
      tenant_id: DEMO_TENANT_ID,
      overview,
      documents: documents.map((d) => ({
        id: d.id,
        module_code: d.module_code,
        title: d.title,
        version: d.version,
        status: d.status,
        sha256_hash: d.sha256_hash,
        published_at: d.published_at,
      })),
      acknowledgments,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bob-acr-dossier-preuve-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExported(true);
    setTimeout(() => setExported(false), 3500);
  };

  return (
    <>
      <div className="bg-slate-900 text-slate-100 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
        <span className="font-medium text-slate-300">Clé Admin API (session) :</span>
        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <input
            type="password"
            value={adminKeyInput}
            onChange={(e) => setAdminKeyInput(e.target.value)}
            placeholder="bob_admin_..."
            className="w-full rounded bg-slate-800 border border-slate-700 px-2.5 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-400"
          />
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.sessionStorage?.setItem('bob_admin_key', adminKeyInput.trim());
              }
              fetchAll();
              gov.loadReferents();
            }}
            className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1 font-medium text-white shrink-0"
          >
            Appliquer
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminKeyInput('');
              if (typeof window !== 'undefined') {
                window.sessionStorage?.removeItem('bob_admin_key');
              }
              fetchAll();
            }}
            className="rounded bg-slate-700 hover:bg-slate-600 px-2.5 py-1 text-slate-200 shrink-0"
          >
            Effacer
          </button>
        </div>
      </div>

      {authModalOpen && (
        <div className="bg-slate-800 text-slate-100 px-6 py-4 border-b border-slate-700 text-xs">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-white">Connexion utilisateur (SSO OIDC ou Email / Mot de passe)</span>
              <button type="button" onClick={() => setAuthModalOpen(false)} className="text-slate-400 hover:text-white">Fermer</button>
            </div>
            <form onSubmit={handleDiscoverAuth} className="flex flex-wrap gap-2 items-center">
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => { setAuthEmail(e.target.value); setAuthDiscovery(null); }}
                placeholder="prenom.nom@organisation.fr"
                className="flex-1 min-w-[220px] rounded bg-slate-900 border border-slate-600 px-3 py-1.5 text-white"
              />
              <button type="submit" disabled={authBusy} className="rounded bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 font-medium text-white">
                {authBusy ? "Détection..." : "Détecter mode"}
              </button>
            </form>
            {authDiscovery?.mode === "sso" && (
              <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-950/60 border border-indigo-700/60 rounded-lg p-3">
                <span>Mode <strong>SSO ({authDiscovery.ssoProvider})</strong> détecté pour <strong>{authDiscovery.tenantName}</strong>.</span>
                <a href={authDiscovery.loginUrl} className="rounded bg-indigo-600 hover:bg-indigo-500 px-3.5 py-1.5 font-semibold text-white no-underline">
                  Continuer avec le SSO
                </a>
              </div>
            )}
            {authDiscovery?.mode === "local_email" && (
              <form onSubmit={handleLocalPasswordLogin} className="flex flex-wrap gap-2 items-center bg-slate-900/70 border border-slate-700 rounded-lg p-3">
                <span className="w-full text-slate-300">Mode <strong>Sans SSO (connexion locale)</strong> actif pour <strong>{authDiscovery.tenantName}</strong> :</span>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Mot de passe"
                  className="flex-1 min-w-[200px] rounded bg-slate-950 border border-slate-600 px-3 py-1.5 text-white"
                />
                <button type="submit" disabled={authBusy} className="rounded bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 font-medium text-white">
                  {authBusy ? "Connexion..." : "Se connecter"}
                </button>
              </form>
            )}
            {authFeedback && <p className="text-rose-300">{authFeedback}</p>}
          </div>
        </div>
      )}
      <div className="min-h-screen flex flex-col bg-slate-50">
        <header className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-indigo-400" />
            <div>
              <h1 className="font-semibold text-base">BOB — Gouvernance &amp; Conformité</h1>
              <p className="text-xs text-slate-400">Atelier Métal &amp; Industrie du Sud SAS • Scalingo osc-fr1</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchAll}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Synchroniser
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  handleExportProof();
                  handleExportCsv();
                  setExported(true);
                } catch (e) {
                  setErrorMsg(`Erreur export : ${e.message}`);
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3.5 py-2 rounded-lg flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export preuve (Art. R. 1321-1)
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  handleExportPdf();
                } catch (e) {
                  setErrorMsg(`Erreur PDF : ${e.message}`);
                }
              }}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 border border-slate-700"
            >
              Export PDF
            </button>
          </div>
        </header>

        <ScopeToolbar gov={gov} />

        {exported && (
          <div className="bg-emerald-600 text-white text-xs py-2 px-6 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Dossier de preuve téléchargé ({documents.length} documents SHA-256 et {acknowledgments.length} émargements).
          </div>
        )}

        {errorMsg && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs py-2 px-6 text-center">
            {errorMsg}
          </div>
        )}

        {overview && (
          <section className="bg-white border-b border-slate-200 px-6 py-3">
            <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" /> Documents / Chunks
                </div>
                <div className="text-base font-semibold text-slate-900 mt-1">
                  {overview.total_documents} docs • {overview.total_chunks} chunks
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-600" /> Requêtes / Confiance moy.
                </div>
                <div className="text-base font-semibold text-slate-900 mt-1">
                  {overview.total_queries} req. • {overview.avg_confidence ?? '—'}
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" /> Émargements SHA-256
                </div>
                <div className="text-base font-semibold text-emerald-700 mt-1">
                  {overview.total_acknowledgments} signatures
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-slate-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Escalades référents
                </div>
                <div className="text-base font-semibold text-amber-700 mt-1">
                  {overview.escalated_queries} alertes
                </div>
              </div>
            </div>
          </section>
        )}

        <PerimeterKpiGrid gov={gov} />

        <nav className="bg-white border-b border-slate-200 px-6 flex flex-wrap gap-6 text-sm">
          <button
            type="button"
            onClick={() => setTab('referent')}
            className={`py-3 border-b-2 flex items-center gap-2 ${
              tab === 'referent'
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-slate-600'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600" />
            Espace Référent ({gov.filteredEscalations.filter((e) => !e.referent_answer).length} en attente)
          </button>
          <button
            type="button"
            onClick={() => setTab('documents')}
            className={`py-3 border-b-2 flex items-center gap-2 ${
              tab === 'documents'
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-slate-600'
            }`}
          >
            <FileText className="w-4 h-4" /> Documents ({gov.filteredDocuments.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('acknowledgments')}
            className={`py-3 border-b-2 flex items-center gap-2 ${
              tab === 'acknowledgments'
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-slate-600'
            }`}
          >
            <FileCheck2 className="w-4 h-4 text-emerald-600" /> Émargements ({gov.filteredAcknowledgments.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('friction')}
            className={`py-3 border-b-2 flex items-center gap-2 ${
              tab === 'friction'
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-slate-600'
            }`}
          >
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Zones de friction ({gov.filteredEscalations.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`py-3 border-b-2 flex items-center gap-2 ${
              tab === 'settings'
                ? 'border-indigo-600 text-indigo-600 font-medium'
                : 'border-transparent text-slate-600'
            }`}
          >
            <Settings className="w-4 h-4" /> SSO &amp; Socle commun
          </button>
        </nav>

        <main className="max-w-5xl w-full mx-auto p-6 flex-1 space-y-6">
          {tab === 'referent' && (
            <ReferentTabContent
              gov={gov}
              replyDrafts={replyDrafts}
              setReplyDrafts={setReplyDrafts}
              replySaving={replySaving}
              handleReplyEscalation={handleReplyEscalation}
            />
          )}

          {tab === 'documents' && (
            <>
              {gov.roleMeta.canWrite && (
                <form
                  onSubmit={handlePublish}
                  className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm"
                >
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <PlusCircle className="w-4 h-4 text-indigo-600" />
                    Publier et vectoriser un nouveau document (SHA-256 + Mistral)
                  </h2>

                  <div className="grid md:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Titre (ex: Charte Sécurité Atelier)"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      required
                    />
                    <select
                      value={moduleCode}
                      onChange={(e) => setModuleCode(e.target.value)}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      <option value="socle_ri">socle_ri — Règlement Intérieur</option>
                      <option value="rgpd">rgpd — Protection des données</option>
                      <option value="sapin_ii">sapin_ii — Anti-corruption</option>
                      <option value="cyber">cyber — Sécurité SI</option>
                      <option value="lcb_ft">lcb_ft — Conformité financière</option>
                    </select>
                    <input
                      type="text"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder="Version (ex: 1.0)"
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <textarea
                    rows={4}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Collez ici les articles ou règles applicables à indexer dans BOB..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    required
                  />

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={requiresAck}
                        onChange={(e) => setRequiresAck(e.target.checked)}
                      />
                      <span>Émargement salarié obligatoire (opposabilité)</span>
                    </label>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg"
                    >
                      {submitting ? 'Vectorisation Mistral en cours...' : 'Publier et indexer'}
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {gov.filteredDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] uppercase tracking-wide font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded mr-2">
                          {doc.module_code}
                        </span>
                        <span className="font-semibold text-sm">{doc.title}</span>
                        <span className="text-xs text-slate-500 ml-2">v{doc.version}</span>
                      </div>
                      <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-medium">
                        {doc.status} • {doc.chunk_count} chunk(s)
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Empreinte SHA-256 :{' '}
                      <code className="bg-slate-100 px-2 py-0.5 rounded break-all">{doc.sha256_hash}</code>
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === 'acknowledgments' && (
            <div className="space-y-3">
              {gov.filteredAcknowledgments.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-500">
                  Aucun émargement enregistré pour ce périmètre.
                </div>
              ) : (
                gov.filteredAcknowledgments.map((ack) => (
                  <div
                    key={ack.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 space-y-1.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">
                        {ack.full_name || ack.user_email}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          ({ack.user_email}
                          {ack.department ? ` • ${ack.department}` : ''})
                        </span>
                      </div>
                      <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full font-medium">
                        Signé le {new Date(ack.acknowledged_at).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700">
                      Document : <strong>{ack.document_title}</strong> (v{ack.document_version} • {ack.module_code})
                    </p>
                    <p className="text-xs text-slate-500">
                      SHA-256 certifié : <code className="bg-slate-100 px-1.5 py-0.5 rounded">{ack.sha256_hash}</code>
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'friction' && (
            <div className="space-y-3">
              {gov.filteredEscalations.map((esc) => (
                <div
                  key={esc.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 space-y-2.5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full">
                        Réf. #{String(esc.id).slice(0, 8).toUpperCase()} •{' '}
                        {esc.was_escalated ? 'Transmise au référent' : 'Hors périmètre'}
                      </span>
                      {esc.referent_acknowledged_at && (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                          Émargé le {new Date(esc.referent_acknowledged_at).toLocaleString('fr-FR')}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      Canal : {esc.channel} • Confiance : {esc.confidence_score ?? '0.000'} •{' '}
                      {esc.created_at ? new Date(esc.created_at).toLocaleString('fr-FR') : ''}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900">« {esc.question_topic} »</p>
                  <p className="text-xs text-slate-500">Module : {esc.module_code || 'non classé'}</p>
                  {esc.referent_answer ? (
                    <div className="mt-2 rounded-lg bg-emerald-50/70 border border-emerald-200 p-3 space-y-1">
                      <div className="flex items-center justify-between text-xs font-medium text-emerald-900">
                        <span>Réponse officielle publiée ({esc.answered_by_role || 'Référent Conformité'})</span>
                        {esc.answered_at && <span>{new Date(esc.answered_at).toLocaleString('fr-FR')}</span>}
                      </div>
                      <p className="text-sm text-slate-800 whitespace-pre-line">{esc.referent_answer}</p>
                      {esc.referent_answer_sha256 && (
                        <p className="text-[11px] text-slate-500">
                          SHA-256 :{' '}
                          <code className="bg-white px-1 py-0.5 rounded border border-slate-200">
                            {esc.referent_answer_sha256}
                          </code>
                        </p>
                      )}
                    </div>
                  ) : gov.roleMeta.canWrite ? (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <textarea
                        rows={2}
                        value={replyDrafts[esc.id] || ''}
                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [esc.id]: e.target.value }))}
                        placeholder="Rédiger la réponse officielle du référent conformité..."
                        className="w-full text-sm border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleReplyEscalation(esc.id)}
                          disabled={replySaving[esc.id] || !(replyDrafts[esc.id] || '').trim()}
                          className="text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3.5 py-1.5 rounded-lg transition"
                        >
                          {replySaving[esc.id] ? 'Publication...' : 'Publier la réponse anonyme'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {tab === 'settings' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Lock className="w-4 h-4 text-indigo-600" /> Socle commun
                </div>
                <label className="flex items-center justify-between text-sm">
                  <span>Autoriser le socle mutualisé A.C.R.</span>
                  <input
                    type="checkbox"
                    checked={useSharedBase}
                    onChange={(e) => setUseSharedBase(e.target.checked)}
                  />
                </label>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
                <div className="font-semibold text-sm">Authentification</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="auth" checked={authMode === 'sso'} onChange={() => setAuthMode('sso')} />
                  <span>SSO (Entra ID / Google)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="auth"
                    checked={authMode === 'local_email'}
                    onChange={() => setAuthMode('local_email')}
                  />
                  <span>Sans SSO (Email pro + OTP)</span>
                </label>
              </div>
            </div>
          )}
        </main>
      
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 mt-6">
      <h2 className="font-semibold text-sm text-slate-900">Remontée des réponses Pushes Référent & Preuves SHA-256 ({pushResponses.length})</h2>
      {pushResponses.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune réponse push enregistrée sur ce tenant.</p>
      ) : pushResponses.map((r) => (
        <div key={r.id} className="border border-slate-100 rounded-lg p-2.5 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="font-semibold text-slate-800">{r.user_identifier} • {r.push_title}</span>
            <span className="text-slate-500">{new Date(r.responded_at).toLocaleString("fr-FR")}</span>
          </div>
          <p className="text-slate-700">Réponse : <strong>{r.selected_option || r.free_text || "ACK"}</strong> — Référent : {r.referent_name}</p>
          <p className="font-mono text-[11px] text-slate-500 break-all">SHA-256 : {r.sha256_proof}</p>
        </div>
      ))}
    </div>
</div>
    </>
  );
}
