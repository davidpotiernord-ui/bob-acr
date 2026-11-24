import React, { useState } from 'react';
import {
  ShieldCheck,
  FileText,
  AlertTriangle,
  Settings,
  Download,
  Upload,
  Lock,
  CheckCircle2,
  Building2
} from 'lucide-react';
import { DEMO_TENANT, DEMO_DOCUMENTS, DEMO_FRICTION_QUESTIONS } from './services/apiClient';

export default function App() {
  const [activeTab, setActiveTab] = useState('documents');
  const [useSharedBase, setUseSharedBase] = useState(DEMO_TENANT.useSharedBase);
  const [authMode, setAuthMode] = useState(DEMO_TENANT.authMode);
  const [exportNotice, setExportNotice] = useState(false);

  const visibleDocuments = useSharedBase
    ? DEMO_DOCUMENTS
    : DEMO_DOCUMENTS.filter((doc) => doc.origin === 'Interne client');

  const handleExportProof = () => {
    setExportNotice(true);
    setTimeout(() => setExportNotice(false), 4000);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-lg tracking-tight">BOB — Assistant Conformité & Réglementation</h1>
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              {DEMO_TENANT.name} • {DEMO_TENANT.headcount} salariés
            </p>
          </div>
        </div>

        <button
          onClick={handleExportProof}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition"
        >
          <Download className="w-4 h-4" />
          Exporter le dossier de preuve (Art. R. 1321-1)
        </button>
      </header>

      {exportNotice && (
        <div className="bg-emerald-600 text-white text-sm px-6 py-2.5 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Archive horodatée générée : empreintes SHA-256, versions actives et registre d’accusés de lecture prêts pour audit.
        </div>
      )}

      <nav className="bg-white border-b border-slate-200 px-6 flex gap-6">
        <button
          onClick={() => setActiveTab('documents')}
          className={`py-3.5 text-sm font-medium border-b-2 flex items-center gap-2 ${
            activeTab === 'documents'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          Coffre-fort documentaire ({visibleDocuments.length})
        </button>

        <button
          onClick={() => setActiveTab('friction')}
          className={`py-3.5 text-sm font-medium border-b-2 flex items-center gap-2 ${
            activeTab === 'friction'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Radar des zones de friction ({DEMO_FRICTION_QUESTIONS.length})
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`py-3.5 text-sm font-medium border-b-2 flex items-center gap-2 ${
            activeTab === 'settings'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Settings className="w-4 h-4" />
          Souveraineté & Accès (SSO / Socle)
        </button>
      </nav>

      <main className="max-w-6xl w-full mx-auto p-6 flex-1">
        {activeTab === 'documents' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Documents opposables & Traçabilité SHA-256</h2>
                <p className="text-sm text-slate-500">
                  Chaque version publiée est horodatée et scellée cryptographiquement pour justifier sa diffusion.
                </p>
              </div>
              <button className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Publier un document interne
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4 font-medium">Document</th>
                    <th className="py-3 px-4 font-medium">Origine</th>
                    <th className="py-3 px-4 font-medium">Version</th>
                    <th className="py-3 px-4 font-medium">Empreinte SHA-256</th>
                    <th className="py-3 px-4 font-medium">Prise de connaissance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-medium text-slate-900">{doc.title}</td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            doc.origin === 'Interne client'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {doc.origin}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">v{doc.version}</td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-500" title={doc.sha256}>
                        {doc.sha256.slice(0, 16)}…
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{doc.acknowledgmentRate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'friction' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
              <strong>Confidentialité RGPD garantie :</strong> les questions ci-dessous sont 100 % anonymisées (aucun nom de salarié n’est enregistré). Elles signalent les sujets non couverts par vos documents actuels.
            </div>

            <div className="space-y-3">
              {DEMO_FRICTION_QUESTIONS.map((item) => (
                <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between shadow-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-indigo-600">{item.moduleCode}</span>
                      <span>•</span>
                      <span>{item.channel}</span>
                      <span>•</span>
                      <span>{item.date}</span>
                    </div>
                    <p className="font-medium text-slate-900">« {item.question} »</p>
                    <p className="text-xs text-slate-500">Escalade automatique proposée vers : {item.escalatedTo}</p>
                  </div>
                  <button className="text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-2 rounded-lg">
                    Ajouter une règle / FAQ
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-indigo-600" />
                Cloisonnement documentaire (Opt-out Socle commun)
              </div>
              <p className="text-sm text-slate-600">
                Choisissez si BOB peut s’appuyer sur le socle réglementaire mutualisé A.C.R. (CNIL, Code du travail) en complément de vos documents internes.
              </p>
              <label className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                <span className="text-sm font-medium">Utiliser le socle documentaire mutualisé A.C.R.</span>
                <input
                  type="checkbox"
                  checked={useSharedBase}
                  onChange={(e) => setUseSharedBase(e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
              <p className="text-xs text-slate-500">
                État actuel en base PostgreSQL (RLS) :{' '}
                <strong>{useSharedBase ? 'Hybride (Interne + Socle A.C.R.)' : '100 % Interne client uniquement'}</strong>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                Authentification des collaborateurs
              </div>
              <p className="text-sm text-slate-600">
                Mode de connexion actif pour vos 80 salariés sur Teams et l’extension navigateur.
              </p>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === 'sso'}
                    onChange={() => setAuthMode('sso')}
                    className="accent-indigo-600"
                  />
                  <span>SSO Entreprise (Microsoft Entra ID / Google Workspace)</span>
                </label>
                <label className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === 'local_email'}
                    onChange={() => setAuthMode('local_email')}
                    className="accent-indigo-600"
                  />
                  <span>Sans SSO : Email professionnel (@atelier-metal-sud.fr) + Code OTP</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
