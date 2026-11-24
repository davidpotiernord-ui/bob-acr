import React, { useState } from 'react';
import { ShieldCheck, FileText, AlertTriangle, Settings, Download, Lock, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [tab, setTab] = useState('documents');
  const [useSharedBase, setUseSharedBase] = useState(true);
  const [authMode, setAuthMode] = useState('sso');
  const [exported, setExported] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="font-semibold text-base">BOB — Gouvernance & Conformité</h1>
            <p className="text-xs text-slate-400">Atelier Métal & Industrie du Sud • 80 salariés</p>
          </div>
        </div>
        <button
          onClick={() => { setExported(true); setTimeout(() => setExported(false), 3500); }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3.5 py-2 rounded-lg flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export preuve (Art. R. 1321-1)
        </button>
      </header>

      {exported && (
        <div className="bg-emerald-600 text-white text-xs py-2 px-6 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Dossier de preuve horodaté prêt (empreintes SHA-256 et traçabilité).
        </div>
      )}

      <nav className="bg-white border-b border-slate-200 px-6 flex gap-6 text-sm">
        <button onClick={() => setTab('documents')} className={`py-3 border-b-2 flex items-center gap-2 ${tab === 'documents' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'}`}>
          <FileText className="w-4 h-4" /> Documents
        </button>
        <button onClick={() => setTab('friction')} className={`py-3 border-b-2 flex items-center gap-2 ${tab === 'friction' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'}`}>
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Zones de friction
        </button>
        <button onClick={() => setTab('settings')} className={`py-3 border-b-2 flex items-center gap-2 ${tab === 'settings' ? 'border-indigo-600 text-indigo-600 font-medium' : 'border-transparent text-slate-600'}`}>
          <Settings className="w-4 h-4" /> SSO & Socle commun
        </button>
      </nav>

      <main className="max-w-5xl w-full mx-auto p-6 flex-1">
        {tab === 'documents' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h2 className="font-semibold">Règlement Intérieur v1.2</h2>
            <p className="text-sm text-slate-600">Empreinte SHA-256 : <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">e3b0c44298fc1c14…</code></p>
            {useSharedBase && <p className="text-sm text-emerald-700">Socle réglementaire mutualisé A.C.R. : actif</p>}
          </div>
        )}

        {tab === 'friction' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
            <h2 className="font-semibold">Questions hors documentation (anonymisées)</h2>
            <p className="text-sm text-slate-700">• « Quel est le plafond des paniers repas ? » → Escalade DRH</p>
            <p className="text-sm text-slate-700">• « Droit d’utiliser ChatGPT gratuit sur un devis ? » → Escalade DPO</p>
          </div>
        )}

        {tab === 'settings' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm"><Lock className="w-4 h-4 text-indigo-600" /> Socle commun</div>
              <label className="flex items-center justify-between text-sm">
                <span>Autoriser le socle mutualisé A.C.R.</span>
                <input type="checkbox" checked={useSharedBase} onChange={(e) => setUseSharedBase(e.target.checked)} />
              </label>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="font-semibold text-sm">Authentification</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="auth" checked={authMode === 'sso'} onChange={() => setAuthMode('sso')} />
                <span>SSO (Entra ID / Google)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="auth" checked={authMode === 'local_email'} onChange={() => setAuthMode('local_email')} />
                <span>Sans SSO (Email pro + OTP)</span>
              </label>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
