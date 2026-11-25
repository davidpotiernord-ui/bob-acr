import React, { useEffect, useState } from 'react';
import {
  Send,
  ShieldAlert,
  BookOpen,
  MessageSquare,
  Globe,
  FileCheck2,
  CheckCircle2,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import {
  askBob,
  acknowledgeDocument,
  escalateQuery,
  loadTrackedEscalations,
  saveTrackedEscalation,
  fetchEscalationsStatus,
  acknowledgeEscalationAnswer,
} from './services/askClient';

const QUICK_QUESTIONS = [
  'Quels EPI sont obligatoires en zone de soudure ?',
  'Combien de jours de télétravail sont autorisés ?',
  'Quel est le plafond des paniers repas ?',
];

function renderFormattedText(rawText) {
  if (!rawText) return null;
  return String(rawText)
    .split('\n')
    .map((line, lineIdx) => {
      if (!line.trim()) return <div key={lineIdx} className="h-2" />;
      const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
      return (
        <p key={lineIdx} className="leading-relaxed">
          {parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={pIdx} className="font-semibold text-slate-900">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            if (part.startsWith('*') && part.endsWith('*')) {
              return (
                <em key={pIdx} className="italic text-slate-600">
                  {part.slice(1, -1)}
                </em>
              );
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </p>
      );
    });
}

export default function App() {
  const [view, setView] = useState('chat');
  const [channel, setChannel] = useState('chrome_extension');
  const [question, setQuestion] = useState('');
  const [selectedExcerpt, setSelectedExcerpt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ackState, setAckState] = useState({});
  const [escalateState, setEscalateState] = useState({});
  const [trackedItems, setTrackedItems] = useState([]);
  const [syncingInbox, setSyncingInbox] = useState(false);
  const [refAckLoading, setRefAckLoading] = useState({});
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      status: 'ANSWERED',
      text: 'Bonjour, je suis BOB. Posez-moi une question sur le règlement intérieur ou les règles de conformité de votre entreprise.',
      sources: [],
    },
  ]);

  const syncTrackedStatuses = async (baseList) => {
    const list = baseList ?? (await loadTrackedEscalations());
    if (!list.length) {
      setTrackedItems([]);
      return;
    }
    setSyncingInbox(true);
    try {
      const res = await fetchEscalationsStatus(list.map((i) => i.query_id));
      const byId = new Map((res.items || []).map((item) => [item.query_id, item]));
      setTrackedItems(
        list.map((localItem) => {
          const remote = byId.get(localItem.query_id);
          return remote ? { ...localItem, ...remote } : localItem;
        })
      );
    } catch {
      setTrackedItems(list);
    } finally {
      setSyncingInbox(false);
    }
  };

  useEffect(() => {
    syncTrackedStatuses();

    const formatSourceDomain = (rawUrl) => {
      if (!rawUrl) return "";
      try {
        return new URL(rawUrl).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    };

    const loadExcerpt = (pending) => {
      if (!pending?.text) return;
      setView("chat");
      setSelectedExcerpt({
        text: pending.text.trim(),
        domain: formatSourceDomain(pending.pageUrl),
      });
    };

    const applyPendingSelection = async () => {
      try {
        if (!window.chrome?.storage?.local) return;
        const data = await chrome.storage.local.get("bobPendingSelection");
        const pending = data?.bobPendingSelection;
        if (pending && pending.text) {
          const isRecent = Date.now() - (pending.capturedAt || 0) < 5 * 60 * 1000;
          if (isRecent) {
            loadExcerpt(pending);
          }
          await chrome.storage.local.remove("bobPendingSelection");
        }
      } catch {
        // Ignore hors contexte extension
      }
    };

    applyPendingSelection();

    const onStorageChanged = (changes, areaName) => {
      if (areaName === "local" && changes.bobPendingSelection?.newValue?.text) {
        loadExcerpt(changes.bobPendingSelection.newValue);
        chrome.storage.local.remove("bobPendingSelection").catch(() => {});
      }
    };

    const onWindowMessage = (event) => {
      if (event.data?.type === "BOB_SELECTION_PAYLOAD" && event.data?.payload?.text) {
        loadExcerpt(event.data.payload);
        window.chrome?.storage?.local?.remove("bobPendingSelection").catch(() => {});
      }
    };
    window.addEventListener("message", onWindowMessage);

    if (window.chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged);
    }

    return () => {
      window.removeEventListener("message", onWindowMessage);
      if (window.chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChanged);
      }
    };
  }, []);

  const unreadAnswersCount = trackedItems.filter(
    (item) => item.referent_answer && !item.referent_acknowledged_at
  ).length;

  const handleSend = async (textToSend) => {
    const basePrompt = (textToSend ?? question).trim();
    const excerpt = selectedExcerpt?.text?.trim() || "";
    if (!basePrompt && !excerpt) return;
    if (loading) return;

    const promptInstruction = basePrompt || "Vérifie la conformité de cet extrait au regard des règles applicables.";
    const cleanText = excerpt
      ? `${promptInstruction}\n\nExtrait analysé : « ${excerpt} »`
      : promptInstruction;

    setView('chat');
    setMessages((prev) => [...prev, { role: 'user', text: cleanText }]);
    setQuestion('');
    setSelectedExcerpt(null);
    setLoading(true);
    try {
      const response = await askBob({ question: cleanText, channel });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          queryId: response.query_id || null,
          userQuestion: cleanText,
          status: response.response_status || response.status,
          text: response.answer,
          canEscalate: Boolean(response.can_escalate),
          escalation: response.escalation || null,
          sources: response.sources || [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          status: 'ERROR',
          text: `Connexion temporairement indisponible (${err.message}).`,
          sources: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleEscalate = async (msgIdx, queryId, userQuestion) => {
    if (!queryId || escalateState[msgIdx] === 'loading') return;
    setEscalateState((prev) => ({ ...prev, [msgIdx]: 'loading' }));
    try {
      const res = await escalateQuery({ queryId });
      const reference = res.escalation?.reference || queryId.slice(0, 8).toUpperCase();
      setEscalateState((prev) => ({
        ...prev,
        [msgIdx]: {
          status: 'sent',
          role: res.escalation?.role || 'Référent Conformité',
          reference,
        },
      }));
      const updated = await saveTrackedEscalation({
        query_id: queryId,
        reference,
        question_topic: userQuestion || 'Question transmise au référent',
        created_at: new Date().toISOString(),
      });
      await syncTrackedStatuses(updated);
    } catch {
      setEscalateState((prev) => ({ ...prev, [msgIdx]: 'error' }));
    }
  };

  const handleAckReferentAnswer = async (queryId) => {
    if (!queryId || refAckLoading[queryId]) return;
    setRefAckLoading((prev) => ({ ...prev, [queryId]: true }));
    try {
      const res = await acknowledgeEscalationAnswer({ queryId });
      setTrackedItems((prev) =>
        prev.map((item) =>
          item.query_id === queryId
            ? {
                ...item,
                referent_acknowledged_at: res.proof?.acknowledged_at || new Date().toISOString(),
                referent_answer_sha256: res.proof?.sha256_hash || item.referent_answer_sha256,
              }
            : item
        )
      );
    } finally {
      setRefAckLoading((prev) => ({ ...prev, [queryId]: false }));
    }
  };

  const handleAck = async (ackKey, documentId) => {
    if (!ackKey || !documentId || ackState[ackKey] === 'loading') return;
    setAckState((prev) => ({ ...prev, [ackKey]: 'loading' }));
    try {
      const res = await acknowledgeDocument({ documentId });
      setAckState((prev) => ({
        ...prev,
        [ackKey]: {
          status: 'signed',
          at: new Date(res.proof?.acknowledged_at || Date.now()).toLocaleTimeString('fr-FR'),
          docTitle: res.proof?.document_title || 'Document',
          sha256: res.proof?.sha256_hash || '',
        },
      }));
    } catch {
      setAckState((prev) => ({ ...prev, [ackKey]: 'error' }));
    }
  };

  return (
    <div className="h-screen w-full bg-white overflow-hidden flex flex-col">
      <header className="bg-slate-900 text-white pl-3.5 pr-10 py-2.5 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h1 className="font-semibold text-sm truncate">BOB — Conformité & Règlement</h1>
          <p className="text-[11px] text-slate-400 truncate">Réponses sourcées • Confidentialité préservée</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const next = view === 'inbox' ? 'chat' : 'inbox';
              setView(next);
              if (next === 'inbox') syncTrackedStatuses();
            }}
            className={`px-2 py-1 rounded-lg text-xs flex items-center gap-1 border transition ${
              view === 'inbox'
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Suivi anonyme des questions transmises au référent"
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Suivi</span>
            {trackedItems.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${
                  unreadAnswersCount > 0
                    ? 'bg-emerald-400 text-slate-950'
                    : 'bg-slate-700 text-slate-200'
                }`}
              >
                {unreadAnswersCount > 0 ? `${unreadAnswersCount} rép.` : trackedItems.length}
              </span>
            )}
          </button>

          <div className="flex items-center gap-0.5 bg-slate-800 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setChannel('teams')}
              className={`px-1.5 py-1 rounded flex items-center gap-1 ${
                channel === 'teams' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
              title="Mode Microsoft Teams"
            >
              <MessageSquare className="w-3 h-3" />
              Teams
            </button>
            <button
              onClick={() => setChannel('chrome_extension')}
              className={`px-1.5 py-1 rounded flex items-center gap-1 ${
                channel === 'chrome_extension' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
              title="Mode Extension Chrome / Edge"
            >
              <Globe className="w-3 h-3" />
              Ext.
            </button>
          </div>
        </div>
      </header>

      {view === 'inbox' ? (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Suivi anonyme Référent Conformité
              </h2>
              <p className="text-[11px] text-slate-500">
                Tickets anonymes enregistrés localement sur ce navigateur.
              </p>
            </div>
            <button
              type="button"
              onClick={() => syncTrackedStatuses()}
              disabled={syncingInbox}
              className="text-xs bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${syncingInbox ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>

          {trackedItems.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-500 text-center space-y-1">
              <p className="font-medium text-slate-700">Aucune demande transmise pour le moment</p>
              <p>
                Lorsqu’une question est hors base documentaire, cliquez sur « Oui, transmettre anonymement au référent » pour suivre sa réponse ici.
              </p>
            </div>
          ) : (
            trackedItems.map((item) => (
              <div
                key={item.query_id}
                className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">
                    Ticket anonyme #{item.reference}
                  </span>
                  {item.referent_answer ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Réponse reçue
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                      En attente du référent
                    </span>
                  )}
                </div>

                <p className="text-slate-800 font-medium">« {item.question_topic} »</p>

                {item.referent_answer && (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1">
                      <p className="text-[11px] font-semibold text-indigo-700">
                        Réponse officielle — {item.answered_by_role || 'Référent Conformité'}
                      </p>
                      <div className="text-xs text-slate-800 space-y-1">
                        {renderFormattedText(item.referent_answer)}
                      </div>
                    </div>

                    {item.referent_acknowledged_at ? (
                      <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Émargé le{' '}
                          {new Date(item.referent_acknowledged_at).toLocaleString('fr-FR')}
                          {item.referent_answer_sha256
                            ? ` • SHA-256 ${item.referent_answer_sha256.slice(0, 12)}…`
                            : ''}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAckReferentAnswer(item.query_id)}
                        disabled={refAckLoading[item.query_id]}
                        className="w-full text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2.5 py-1.5 flex items-center justify-center gap-1.5 transition"
                      >
                        <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {refAckLoading[item.query_id]
                            ? 'Enregistrement de la preuve...'
                            : 'Émarger la réponse du référent (SHA-256)'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50">
            {messages.map((msg, idx) => {
              const primaryDocId =
                msg.sources?.[0]?.documentId || msg.sources?.[0]?.document_id || msg.sources?.[0]?.id;
              const ackKey = primaryDocId ? `${idx}:${primaryDocId}` : null;
              const currentAck = ackKey ? ackState[ackKey] : null;
              const currentEsc = escalateState[idx];
              const canAcknowledge = Boolean(primaryDocId) && !msg.canEscalate && !msg.escalation;

              return (
                <div
                  key={idx}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : msg.canEscalate
                          ? 'bg-amber-50 border border-amber-200 text-amber-950'
                          : 'bg-white border border-slate-200 text-slate-800 shadow-sm'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p>{msg.text}</p>
                    ) : (
                      <div className="space-y-1">{renderFormattedText(msg.text)}</div>
                    )}

                    {msg.canEscalate && msg.queryId && (
                      <div className="mt-2.5 pt-2 border-t border-amber-200">
                        {typeof currentEsc === 'object' && currentEsc.status === 'sent' ? (
                          <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 space-y-1">
                            <div className="flex items-center gap-1.5 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                              <span>Transmise anonymement au {currentEsc.role}</span>
                            </div>
                            <p className="pl-5 text-emerald-700">
                              Réf. anonyme #{currentEsc.reference} • Suivez la réponse dans l’onglet « Suivi ».
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEscalate(idx, msg.queryId, msg.userQuestion)}
                            disabled={currentEsc === 'loading'}
                            className="w-full text-[11px] font-medium text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-2.5 py-1.5 flex items-center justify-center gap-1.5 transition"
                          >
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-800" />
                            <span>
                              {currentEsc === 'loading'
                                ? 'Transmission anonyme en cours...'
                                : currentEsc === 'error'
                                  ? 'Échec — Réessayer la transmission anonyme'
                                  : 'Oui, transmettre anonymement au référent'}
                            </span>
                          </button>
                        )}
                      </div>
                    )}

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1.5">
                        {msg.sources.map((src, sIdx) => (
                          <div key={sIdx} className="text-[11px] text-slate-500 flex items-start gap-1">
                            <BookOpen className="w-3 h-3 mt-0.5 text-indigo-600 shrink-0" />
                            <span>
                              <strong>{src.title || src.module_code || 'Source'}</strong>
                              {src.version || src.page_number || src.page
                                ? ` (${[src.version, src.page_number || src.page ? `p.${src.page_number || src.page}` : ''].filter(Boolean).join(', ')})`
                                : ''}{' '}
                              — {src.origin || (src.document_id ? `doc ${src.document_id.slice(0, 8)}` : 'extrait')}
                            </span>
                          </div>
                        ))}

                        {canAcknowledge && (
                          <div className="pt-1.5">
                            {typeof currentAck === 'object' && currentAck.status === 'signed' ? (
                              <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Émargé à {currentAck.at} ({currentAck.docTitle})
                                  {currentAck.sha256 ? ` • SHA-256 ${currentAck.sha256.slice(0, 12)}…` : ''}
                                </span>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAck(ackKey, primaryDocId)}
                                disabled={currentAck === 'loading'}
                                className="w-full text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2.5 py-1.5 flex items-center justify-center gap-1.5 transition"
                              >
                                <FileCheck2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {currentAck === 'loading'
                                    ? 'Enregistrement de la preuve...'
                                    : 'Émarger la prise de connaissance (SHA-256)'}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="text-xs text-slate-500 italic px-2">BOB vérifie les textes applicables…</div>
            )}
          </div>

          {selectedExcerpt && (
            <div className="px-3 py-2.5 bg-indigo-50 border-t border-indigo-200 space-y-2 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-indigo-900">
                    Extrait sélectionné {selectedExcerpt.domain ? `(${selectedExcerpt.domain})` : ""}
                  </p>
                  <p className="text-xs text-slate-700 italic line-clamp-2 mt-0.5">
                    « {selectedExcerpt.text} »
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedExcerpt(null)}
                  className="text-xs text-slate-500 hover:text-slate-800 px-1.5 py-0.5 rounded"
                  title="Retirer l extrait"
                >
                  ×
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Est-ce conforme au règlement intérieur ?",
                  "Y a-t-il un risque RGPD ou confidentialité ?",
                  "Quelle règle s applique ici ?",
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(preset)}
                    className="text-[11px] font-medium bg-white hover:bg-indigo-100 text-indigo-800 border border-indigo-200 px-2 py-1 rounded-lg transition"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="px-3 py-2 bg-white border-t border-slate-100 flex gap-1.5 overflow-x-auto shrink-0">
            {QUICK_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSend(q)}
                className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full whitespace-nowrap transition"
              >
                {q}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={selectedExcerpt ? "Précisez votre question ou cliquez sur Envoyer..." : "Posez votre question réglementaire..."}
              className="flex-1 text-sm bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading || (!question.trim() && !selectedExcerpt)}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white p-2.5 rounded-xl transition"
              aria-label="Envoyer la question"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
