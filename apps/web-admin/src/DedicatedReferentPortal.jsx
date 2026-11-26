import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, AlertTriangle, FileText, FileCheck2, Send, CheckCircle2, Lock, RefreshCw, BarChart3, BellRing } from "lucide-react";

const MODULE_LABELS = {
  socle_ri: "Socle Règlement Intérieur",
  rgpd: "RGPD & Données",
  cyber: "Cybersécurité & Charte IT",
  sapin_ii: "Loi Sapin II & Anticorruption",
  lcb_ft: "LCB-FT & Vigilance",
};

const ACCESS_BADGES = {
  read_only: { label: "Lecture seule", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  read_write: { label: "Lecture et écriture", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  read_write_push: { label: "Lecture, écriture + Push autorisé", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export default function DedicatedReferentPortal({ token, apiBase }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("escalations");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [escStatusFilter, setEscStatusFilter] = useState("open");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pushType, setPushType] = useState("acknowledgment");
  const [pushScope, setPushScope] = useState("");
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushDocId, setPushDocId] = useState("");
  const [quizOptions, setQuizOptions] = useState(["", "", ""]);
  const [correctOption, setCorrectOption] = useState("");
  const [pushSending, setPushSending] = useState(false);

  const headers = useMemo(() => ({ "Content-Type": "application/json", "x-referent-token": token }), [token]);

  const loadPortal = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/referent/me`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Erreur chargement");
      setData(json);
      if (json.referent?.scopes?.length && !pushScope) setPushScope(json.referent.scopes[0]);
    } catch (e) {
      console.error("Erreur portail référent:", e); setError(e.message || "Erreur réseau lors de la diffusion.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortal();
  }, [token]);

  const handleReply = async (queryId) => {
    const answer = (drafts[queryId] || "").trim();
    if (!answer) return;
    setSavingId(queryId);
    setFeedback("");
    try {
      const res = await fetch(`${apiBase}/referent/escalations/${queryId}/reply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ answer }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Erreur publication");
      setDrafts((p) => ({ ...p, [queryId]: "" }));
      setFeedback("Réponse officielle publiée et horodatée (SHA-256).");
      await loadPortal();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId("");
    }
  };

  const handleSendPush = async (e) => {
    e.preventDefault();
    if (!pushTitle.trim() || !pushBody.trim()) { setError("Renseigne un titre et un message avant de diffuser."); return; }
    setPushSending(true);
    setError("");
    setFeedback("");
    try {
      const res = await fetch(`${apiBase}/referent/pushes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          moduleCode: pushScope || data?.referent?.scopes?.[0],
          pushType,
          title: pushTitle.trim(),
          body: pushBody.trim(),
          documentId: pushType === "acknowledgment" && pushDocId ? pushDocId : null,
          options: pushType === "quiz" ? quizOptions.map((o) => o.trim()).filter(Boolean) : [],
          correctOption: pushType === "quiz" ? correctOption.trim() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Erreur push");
      setPushTitle("");
      setPushBody("");
      setPushDocId("");
      setQuizOptions(["", "", ""]);
      setCorrectOption("");
      setFeedback("Notification poussée vers l'extension et le widget BOB.");
      await loadPortal();
    } catch (e) {
      setError(e.message);
    } finally {
      setPushSending(false);
    }
  };

  if (loading && !data) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">Chargement espace référent...</div>;
  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-5 space-y-3 text-center">
          <p className="font-semibold text-red-700">Accès espace référent impossible</p>
          <p className="text-sm text-slate-600">{error}</p>
          <button type="button" onClick={loadPortal} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm">
            Réessayer
          </button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  const ref = data.referent || { name: "Référent", scopes: [], canWrite: false, canPush: false };
  const badge = ACCESS_BADGES[ref.accessLevel] || ACCESS_BADGES.read_only;
  const escs = data.escalations || [];
  const docs = data.documents || [];
  const acks = Array.isArray(data.acknowledgments) ? data.acknowledgments : [];
  const pushes = data.pushes || [];
  const pushResponses = data.push_responses || [];

  const triggerDownload = (filename, mimeType, content) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportJson = () => {
    if (!data) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const payload = {
      exported_at: new Date().toISOString(),
      tenant: data.tenant,
      referent: {
        name: ref.name,
        email: ref.email,
        role: ref.role,
        scopes: ref.scopes,
      },
      summary: {
        pushes_count: pushes.length,
        responses_count: pushResponses.length,
        escalations_count: escs.length,
        acknowledgments_count: acks.length,
      },
      pushes,
      push_responses: pushResponses,
      escalations: escs,
      acknowledgments: acks,
    };
    triggerDownload(`audit-bob-${stamp}.json`, "application/json;charset=utf-8", JSON.stringify(payload, null, 2));
  };

  const handleExportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const escCsv = (val) => `"${String(val ?? "").replaceAll("\"", "\"\"")}"`;
    const headers = [
      "responded_at",
      "module_code",
      "push_type",
      "push_title",
      "user_identifier",
      "selected_option",
      "is_correct",
      "sha256_proof",
    ];
    const lines = [
      headers.join(";"),
      ...pushResponses.map((r) =>
        [
          r.responded_at,
          r.module_code,
          r.push_type,
          r.push_title,
          r.user_identifier,
          r.selected_option || r.free_text || "ACK",
          r.is_correct,
          r.sha256_proof,
        ]
          .map(escCsv)
          .join(";")
      ),
    ];
    triggerDownload(`audit-quiz-responses-${stamp}.csv`, "text/csv;charset=utf-8", "\uFEFF" + lines.join("\n"));
  };

  return (
  <div className="min-h-screen bg-slate-50 p-6">
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-white border rounded-xl p-4 flex justify-between items-center">
        <div>
          <h1 className="font-bold text-lg">Espace Referent - {ref.name}</h1>
          <p className="text-xs text-slate-500">{badge.label} - {ref.scopes.join(", ")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={handleExportCsv} className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-slate-50">
            Export CSV
          </button>
          <button type="button" onClick={handleExportJson} className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-slate-50">
            Export JSON
          </button>
          <button type="button" onClick={loadPortal} className="px-3 py-1.5 border rounded-lg text-sm">
          Actualiser
        </button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {["escalations", "documents", "acknowledgments", ...(ref.canPush ? ["push"] : [])].map((t) => (
          <button key={t} type="button" onClick={() => setActiveTab(t)} className="px-3 py-1.5 rounded-lg border text-sm bg-white">
            {t}
          </button>
        ))}
      </div>
      {activeTab === "escalations" && escs.map((e) => (
        <div key={e.id} className="bg-white border rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-start gap-2"><p className="font-medium">{e.question_topic || "Escalade"}</p><span className="text-xs text-slate-500 shrink-0">Reçue le {e.created_at ? new Date(e.created_at).toLocaleString("fr-FR") : "—"}</span></div>
          {e.referent_answer ? (
            <div className="space-y-1"><p className="text-sm text-emerald-700">{e.referent_answer}</p><p className="text-[11px] text-slate-500">Répondu le {e.answered_at ? new Date(e.answered_at).toLocaleString("fr-FR") : "—"}{e.referent_answer_sha256 ? ` • SHA-256 : ${e.referent_answer_sha256}` : ""}</p></div>
          ) : ref.canWrite ? (
            <div className="space-y-2">
              <textarea
                rows={2}
                value={drafts[e.id] || ""}
                onChange={(ev) => setDrafts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                className="w-full border rounded p-2 text-sm"
              />
              <button type="button" onClick={() => handleReply(e.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">
                Publier
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Lecture seule</p>
          )}
        </div>
      ))}
      {activeTab === "documents" && (
        <div className="bg-white border rounded-xl p-4 space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="text-sm">
              {d.title} (v{d.version})
            </div>
          ))}
        </div>
      )}
      
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}
      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-sm font-medium">
          {feedback}
        </div>
      )}

      {activeTab === "acknowledgments" && (
        <div className="bg-white border rounded-xl p-4 space-y-2">
          {acks.map((a) => (
            <div key={a.id} className="text-sm">
              {a.user_identifier} - {a.document_title}
            </div>
          ))}
        </div>
      )}
      {activeTab === "push" && ref.canPush && (
        <form onSubmit={handleSendPush} className="bg-white border rounded-xl p-4 space-y-3">
          <select value={pushType} onChange={(e) => setPushType(e.target.value)} className="border rounded p-2 text-sm">
            <option value="acknowledgment">Emargement</option>
            <option value="quiz">Micro-sondage</option>
          </select>
          <input
            value={pushTitle}
            onChange={(e) => setPushTitle(e.target.value)}
            placeholder="Titre"
            className="w-full border rounded p-2 text-sm"
            required
          />
          <textarea
            rows={2}
            value={pushBody}
            onChange={(e) => setPushBody(e.target.value)}
            placeholder="Message"
            className="w-full border rounded p-2 text-sm"
            required
          />
          {pushType === "quiz" && (
            <div className="space-y-1">
              {quizOptions.map((o, idx) => (
                <input
                  key={idx}
                  value={o}
                  onChange={(e) => setQuizOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                  placeholder={"Option " + (idx + 1)}
                  className="w-full border rounded p-2 text-sm"
                />
              ))}
              <input
                value={correctOption}
                onChange={(e) => setCorrectOption(e.target.value)}
                placeholder="Bonne reponse"
                className="w-full border rounded p-2 text-sm"
              />
            </div>
          )}
          <button type="submit" disabled={pushSending} className="px-4 py-2 bg-emerald-600 disabled:opacity-50 text-white rounded text-sm font-medium">
            {pushSending ? "Diffusion en cours..." : "Diffuser"}
          </button>
        </form>
      )}
      {activeTab === "push" && (
        <div className="space-y-4">
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm">Pushes diffusés ({pushes.length})</h3>
        {pushes.map((p) => {
          const opts = Array.isArray(p.options_json) ? p.options_json : [];
          const relatedResponses = pushResponses.filter((r) => r.push_id === p.id);
          return (
            <div key={p.id} className="border rounded-lg p-3.5 text-sm space-y-2.5 bg-slate-50/40">
              <div className="flex justify-between items-start gap-3">
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-900">
                    {p.title}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      ({p.push_type} • {p.module_code}{p.referent_name ? ` • ${p.referent_name}` : ""})
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Publié le {p.created_at ? new Date(p.created_at).toLocaleString("fr-FR") : "—"}
                  </p>
                </div>
                <div className="text-right text-xs shrink-0">
                  <p className="font-semibold text-slate-800">{p.total_responses || 0} réponse(s)</p>
                  {p.push_type === "quiz" && (
                    <p className="text-slate-500">✓ {p.correct_responses || 0} / ✗ {p.wrong_responses || 0}</p>
                  )}
                </div>
              </div>

              <div className="bg-white border rounded-md p-2.5 space-y-2">
                <p className="text-xs font-medium text-slate-800 whitespace-pre-line">{p.body}</p>
                {p.push_type === "quiz" && (
                  <div className="space-y-1 pt-1 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      Réponses suggérées & bonne réponse
                    </p>
                    {opts.length > 0 ? (
                      <ul className="space-y-1">
                        {opts.map((opt, idx) => {
                          const isExpected =
                            p.correct_option &&
                            String(opt).trim().toLowerCase() === String(p.correct_option).trim().toLowerCase();
                          return (
                            <li
                              key={idx}
                              className={`text-xs px-2.5 py-1 rounded border flex items-center justify-between gap-2 ${
                                isExpected
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold"
                                  : "bg-slate-50 border-slate-200 text-slate-700"
                              }`}
                            >
                              <span>{opt}</span>
                              {isExpected && (
                                <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                                  ✓ Bonne réponse
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    {p.correct_option && (
                      <p className="text-xs text-emerald-800 font-medium pt-0.5">
                        Bonne réponse attendue : {p.correct_option}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {relatedResponses.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                    Trace des réponses ({relatedResponses.length})
                  </p>
                  <div className="space-y-1">
                    {relatedResponses.map((r) => (
                      <div key={r.id} className="bg-white border rounded p-2 text-xs space-y-0.5">
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold text-slate-800">{r.user_identifier}</span>
                          <span className="text-slate-500">
                            {r.responded_at ? new Date(r.responded_at).toLocaleString("fr-FR") : ""}
                          </span>
                        </div>
                        <p className="text-slate-700">
                          Choix : <strong>{r.selected_option || r.free_text || "ACK"}</strong>
                          {r.is_correct === true ? " (✓ Correct)" : r.is_correct === false ? " (✗ Incorrect)" : ""}
                        </p>
                        {r.sha256_proof && (
                          <p className="font-mono text-[11px] text-slate-500 break-all">
                            SHA-256 : {r.sha256_proof}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="bg-white border rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-sm">Réponses & preuves SHA-256 ({pushResponses.length})</h3>
        {pushResponses.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune réponse enregistrée pour le moment.</p>
        ) : pushResponses.map((r) => (
          <div key={r.id} className="border rounded-lg p-2.5 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="font-semibold">{r.user_identifier}</span>
              <span className="text-slate-500">{new Date(r.responded_at).toLocaleString("fr-FR")}</span>
            </div>
            <p className="text-slate-700">Push : <strong>{r.push_title}</strong> — Réponse : <strong>{r.selected_option || r.free_text || "ACK"}</strong>{r.is_correct === true ? " (✓ Correct)" : r.is_correct === false ? " (✗ Incorrect)" : ""}</p>
            <p className="font-mono text-[11px] text-slate-500 break-all">SHA-256 : {r.sha256_proof}</p>
          </div>
        ))}
      </div>
        </div>
      )}
    </div>
  </div>
  );
}
