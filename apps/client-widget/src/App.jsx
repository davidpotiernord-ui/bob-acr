import React, { useState } from 'react';
import { Send, ShieldAlert, BookOpen, MessageSquare, Globe } from 'lucide-react';
import { askBob } from './services/askClient';

const QUICK_QUESTIONS = [
  'Quels EPI sont obligatoires en zone de soudure ?',
  'Quel est le plafond des paniers repas ?'
];

export default function App() {
  const [channel, setChannel] = useState('teams');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      status: 'ANSWERED',
      text: 'Bonjour, je suis BOB. Posez-moi une question sur le règlement intérieur ou les règles de conformité de votre entreprise.',
      sources: []
    }
  ]);

  const handleSend = async (textToSend) => {
    const cleanText = (textToSend ?? question).trim();
    if (!cleanText || loading) return;

    setMessages((prev) => [...prev, { role: 'user', text: cleanText }]);
    setQuestion('');
    setLoading(true);

    try {
      const response = await askBob({ question: cleanText, channel });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          status: response.status,
          text: response.answer,
          escalation: response.escalation || null,
          sources: response.sources || []
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden flex flex-col h-[640px]">
        {/* En-tête du widget */}
        <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-sm">BOB — Conformité & Règlement</h1>
            <p className="text-[11px] text-slate-400">Réponses sourcées • Confidentialité préservée</p>
          </div>

          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg text-xs">
            <button
              onClick={() => setChannel('teams')}
              className={`px-2 py-1 rounded flex items-center gap-1 ${
                channel === 'teams' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
              title="Mode Microsoft Teams"
            >
              <MessageSquare className="w-3 h-3" />
              Teams
            </button>
            <button
              onClick={() => setChannel('chrome_extension')}
              className={`px-2 py-1 rounded flex items-center gap-1 ${
                channel === 'chrome_extension' ? 'bg-indigo-600 text-white' : 'text-slate-300'
              }`}
              title="Mode Extension Chrome / Edge"
            >
              <Globe className="w-3 h-3" />
              Ext.
            </button>
          </div>
        </header>

        {/* Zone de conversation */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : msg.status === 'ESCALATED_OUT_OF_SCOPE'
                      ? 'bg-amber-50 border border-amber-200 text-amber-950'
                      : 'bg-white border border-slate-200 text-slate-800 shadow-sm'
                }`}
              >
                <p>{msg.text}</p>

                {msg.escalation && (
                  <div className="mt-2 pt-2 border-t border-amber-200 text-xs flex items-center gap-1.5 font-medium text-amber-900">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    Référent : {msg.escalation.role.toUpperCase()} ({msg.escalation.contact})
                  </div>
                )}

                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1">
                    {msg.sources.map((src, sIdx) => (
                      <div key={sIdx} className="text-[11px] text-slate-500 flex items-start gap-1">
                        <BookOpen className="w-3 h-3 mt-0.5 text-indigo-600 shrink-0" />
                        <span>
                          <strong>{src.title}</strong> (v{src.version}
                          {src.page ? `, p.${src.page}` : ''}) — {src.origin}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="text-xs text-slate-500 italic px-2">BOB vérifie les textes applicables…</div>
          )}
        </div>

        {/* Questions rapides */}
        <div className="px-3 py-2 bg-white border-t border-slate-100 flex gap-1.5 overflow-x-auto">
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

        {/* Saisie de la question */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Posez votre question réglementaire..."
            className="flex-1 text-sm bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white p-2.5 rounded-xl transition"
            aria-label="Envoyer la question"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
