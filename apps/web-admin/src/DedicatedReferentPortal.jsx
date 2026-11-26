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
      setError(e.message);
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
    if (!pushTitle.trim() || !pushBody.trim()) return;
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
  return (
  <div className="min-h-screen bg-slate-50 p-6">
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-white border rounded-xl p-4 flex justify-between items-center">
        <div>
          <h1 className="font-bold text-lg">Espace Referent - {ref.name}</h1>
          <p className="text-xs text-slate-500">{badge.label} - {ref.scopes.join(", ")}</p>
        </div>
        <button type="button" onClick={loadPortal} className="px-3 py-1.5 border rounded-lg text-sm">
          Actualiser
        </button>
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
          <p className="font-medium">{e.question_topic || "Escalade"}</p>
          {e.referent_answer ? (
            <p className="text-sm text-emerald-700">{e.referent_answer}</p>
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
          <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded text-sm">
            Diffuser
          </button>
        </form>
      )}
    </div>
  </div>
  );
}
