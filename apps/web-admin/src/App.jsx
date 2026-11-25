import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'https://bob-acr-api.osc-fr1.scalingo.io/api';

function getAuthHeaders(extra = {}) {
  const token =
    (typeof window !== "undefined" && window.sessionStorage?.getItem("bob_admin_key")) ||
    import.meta.env.VITE_BOB_ADMIN_KEY ||
    "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

export default function App() {
  const [tab, setTab] = useState('documents');
  const [useSharedBase, setUseSharedBase] = useState(true);
  const [authMode, setAuthMode] = useState('sso');
  const [exported, setExported] = useState(false);

  const [overview, setOverview] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [acknowledgments, setAcknowledgments] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replySaving, setReplySaving] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [adminKeyInput, setAdminKeyInput] = useState(() =>
    (typeof window !== "undefined" && window.sessionStorage?.getItem("bob_admin_key")) ||
    import.meta.env.VITE_BOB_ADMIN_KEY ||
    ""
  );

  const [title, setTitle] = useState('');
  const [moduleCode, setModuleCode] = useState('socle_ri');
  const [version, setVersion] = useState('1.0');
  const [requiresAck, setRequiresAck] = useState(true);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    setErrorMsg('');
    const headers = getAuthHeaders();
    try {
      const [ovRes, docRes, ackRes, escRes] = await Promise.all([
        fetch(`${API_BASE}/admin/overview`, { headers }),
        fetch(`${API_BASE}/documents`, { headers }),
        fetch(`${API_BASE}/acknowledgments`, { headers }),
        fetch(`${API_BASE}/admin/escalations`, { headers }),
      ]);

      if (!ovRes.ok || !docRes.ok || !ackRes.ok || !escRes.ok) {
        throw new Error('Erreur HTTP lors du chargement du cockpit');
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
    } catch (err) {
      setErrorMsg(`Impossible de synchroniser l'API Scalingo : ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;
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

  const handleExportCsv = () => {
    const headers = [
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
    const rows = acknowledgments.map((a) => headers.map((h) => escapeCsv(a[h])).join(','));
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bob-acr-emargements-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
    a.click();
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => setExported(false), 3500);
  };

    const handleReplyEscalation = async (queryId) => {
    const answerText = (replyDrafts[queryId] || '').trim();
    if (!answerText || replySaving[queryId]) return;
    setReplySaving((prev) => ({ ...prev, [queryId]: true }));
    try {
      const res = await fetch(`${API_BASE}/admin/escalations/${queryId}/reply`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ answer: answerText }),
      });
      const data = await res.json();
      if (res.ok && data.escalation) {
        setEscalations((prev) =>
          prev.map((item) => (item.id === queryId ? { ...item, ...data.escalation } : item))
        );
        setReplyDrafts((prev) => ({ ...prev, [queryId]: '' }));
      }
    } finally {
      setReplySaving((prev) => ({ ...prev, [queryId]: false }));
    }
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
              if (typeof window !== "undefined") {
                window.sessionStorage?.setItem("bob_admin_key", adminKeyInput.trim());
              }
              fetchAll();
            }}
            className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1 font-medium text-white shrink-0"
          >
            Appliquer
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminKeyInput("");
              if (typeof window !== "undefined") {
                window.sessionStorage?.removeItem("bob_admin_key");
              }
              fetchAll();
            }}
            className="rounded bg-slate-700 hover:bg-slate-600 px-2.5 py-1 text-slate-200 shrink-0"
          >
            Effacer
          </button>
        </div>
      </div>
      <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="font-semibold text-base">BOB — Gouvernance & Conformité</h1>
            <p className="text-xs text-slate-400">Atelier Métal & Industrie du Sud SAS • Scalingo osc-fr1</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Synchroniser
          </button>
          <button
            onClick={() => { handleExportProof(); handleExportCsv(); }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3.5 py-2 rounded-lg flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export preuve (Art. R. 1321-1)
          </button>
        </div>
      </header>

      {exported && (
        <div className="bg-emerald-600 text-white text-xs py-2 px-6 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Dossier de preuve téléchargé ({documents.length} documents SHA-256 et {acknowledgments.length} émargements).
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-600 text-white text-xs py-2 px-6 text-center">{errorMsg}</div>
      )}

      {overview && (
        <section className="bg-white border-b border-slate-200 px-6 py-3">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="text-slate-500 flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-indigo-600" /> Documents / Chunks</div>
              <div className="text-base font-semibold text-slate-900 mt-1">{overview.total_documents} docs • {overview.total_chunks} chunks</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="text-slate-500 flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5 text-indigo-600" /> Requêtes / Confiance moy.</div>
              <div className="text-base font-semibold text-slate-900 mt-1">{overview.total_queries} req. • {overview.avg_confidence ?? '—'}</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="text-slate-500 flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5 text-emerald-600" /> Émargements SHA-256</div>
              <div className="text-base font-semibold text-emerald-700 mt-1">{overview.total_acknowledgments} signatures</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div className="text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Escalades référents</div>
              <div className="text-base font-semibold text-amber-700 mt-1">{overview.escalated_queries} alertes</div>
            </div>
          </div>
        </section>
      )}

      <nav className="bg-white border-b border-slate-200 px-6 flex gap-6 text-sm">
        <button
          onClick={() => setTab('documents')}
          className={`py-3 border-b-2 flex items-center gap-2 ${
            tab === 'documents' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'
          }`}
        >
          <FileText className="w-4 h-4" /> Documents ({documents.length})
        </button>
        <button
          onClick={() => setTab('acknowledgments')}
          className={`py-3 border-b-2 flex items-center gap-2 ${
            tab === 'acknowledgments' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'
          }`}
        >
          <FileCheck2 className="w-4 h-4 text-emerald-600" /> Émargements ({acknowledgments.length})
        </button>
        <button
          onClick={() => setTab('friction')}
          className={`py-3 border-b-2 flex items-center gap-2 ${
            tab === 'friction' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Zones de friction ({escalations.length})
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`py-3 border-b-2 flex items-center gap-2 ${
            tab === 'settings' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'
          }`}
        >
          <Settings className="w-4 h-4" /> SSO & Socle commun
        </button>
      </nav>

      <main className="max-w-5xl w-full mx-auto p-6 flex-1 space-y-6">
        {tab === 'documents' && (
          <>
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

            <div className="space-y-3">
              {documents.map((doc) => (
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
            {acknowledgments.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-500">
                Aucun émargement enregistré pour ce tenant.
              </div>
            ) : (
              acknowledgments.map((ack) => (
                <div
                  key={ack.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 space-y-1.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">
                      {ack.full_name || ack.user_email}{' '}
                      <span className="text-xs font-normal text-slate-500">
                        ({ack.user_email}{ack.department ? ` • ${ack.department}` : ''})
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
            {escalations.map((esc) => (
              <div
                key={esc.id}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-2.5 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full">
                      Réf. #{esc.id.slice(0, 8).toUpperCase()} • {esc.was_escalated ? 'Transmise au référent' : 'Hors périmètre'}
                    </span>
                    {esc.referent_acknowledged_at && (
                      <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                        Émargé le {new Date(esc.referent_acknowledged_at).toLocaleString('fr-FR')}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    Canal : {esc.channel} • Confiance : {esc.confidence_score ?? '0.000'} • {new Date(esc.created_at).toLocaleString('fr-FR')}
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
                        SHA-256 : <code className="bg-white px-1 py-0.5 rounded border border-slate-200">{esc.referent_answer_sha256}</code>
                      </p>
                    )}
                  </div>
                ) : (
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
                )}
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
    </div>
  
    </>);
}
