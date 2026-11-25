import React, { useEffect, useState } from 'react';
import { Users, Layers, Mail } from 'lucide-react';

export const PERIMETERS = [
  { code: 'socle_ri', label: 'Règlement Intérieur & Sécurité', short: 'Socle RI' },
  { code: 'rgpd', label: 'RGPD & Protection des données', short: 'RGPD' },
  { code: 'cyber', label: 'Cybersécurité & SI', short: 'Cyber' },
  { code: 'sapin_ii', label: 'Sapin II & Éthique', short: 'Sapin II' },
  { code: 'lcb_ft', label: 'LCB-FT & Conformité financière', short: 'LCB-FT' },
];

export const REFERENT_ROLES = [
  { id: 'admin_conformite', label: 'Admin Conformité (Tous périmètres)', canWrite: true, allScopes: true },
  { id: 'referent_metier', label: 'Référent Métier (Périmètre ciblé)', canWrite: true, allScopes: false },
  { id: 'auditeur_lecture', label: 'Auditeur / Direction (Lecture seule)', canWrite: false, allScopes: true },
];

export const DEFAULT_REFERENTS = [
  {
    id: 'ref-1',
    name: 'Claire Moreau',
    email: 'claire.moreau@atelier-metal.fr',
    role: 'referent_metier',
    accessLevel: 'read_write',
    scopes: ['socle_ri', 'cyber'],
  },
  {
    id: 'ref-2',
    name: 'Marc Lefèvre',
    email: 'marc.lefevre@atelier-metal.fr',
    role: 'referent_metier',
    accessLevel: 'read_write',
    scopes: ['rgpd', 'sapin_ii', 'lcb_ft'],
  },
  {
    id: 'ref-3',
    name: 'Direction Conformité',
    email: 'conformite@atelier-metal.fr',
    role: 'admin_conformite',
    accessLevel: 'read_write',
    scopes: ['socle_ri', 'rgpd', 'cyber', 'sapin_ii', 'lcb_ft'],
  },
];

export function getScopeLabel(code) {
  return PERIMETERS.find((p) => p.code === code)?.label || code || 'Non classé';
}

export function getScopeShort(code) {
  return PERIMETERS.find((p) => p.code === code)?.short || code || 'Général';
}

function buildConfirmationMailto(referent) {
  const accessText =
    referent.accessLevel === 'read_write'
      ? 'autorisé(e) en lecture et écriture'
      : 'autorisé(e) en lecture seule';
  const scopesText = (referent.scopes || []).map(getScopeLabel).join(', ');
  const subject = encodeURIComponent('BOB — Confirmation de votre rôle de référent conformité');
  const body = encodeURIComponent(
    `Bonjour ${referent.name},\n\n` +
      `Votre compte référent a bien été configuré sur BOB (Assistant Conformité et Réglementation).\n` +
      `Vous êtes ${accessText} sur le(s) périmètre(s) suivant(s) : ${scopesText}.\n\n` +
      `Cordialement,\nLa Gouvernance Conformité`
  );
  return `mailto:${encodeURIComponent(referent.email)}?subject=${subject}&body=${body}`;
}

export function useReferentGovernance({ documents, acknowledgments, escalations }) {
  const [referents, setReferents] = useState(() => {
    try {
      const saved = window.localStorage?.getItem('bob_acr_referents');
      return saved ? JSON.parse(saved) : DEFAULT_REFERENTS;
    } catch {
      return DEFAULT_REFERENTS;
    }
  });
  const [activeReferentId, setActiveReferentId] = useState('ref-3');
  const [selectedScopeFilter, setSelectedScopeFilter] = useState('all');
  const [publishToKnowledgeBase, setPublishToKnowledgeBase] = useState({});

  const [newRefName, setNewRefName] = useState('');
  const [newRefEmail, setNewRefEmail] = useState('');
  const [newRefAccess, setNewRefAccess] = useState('read_write');
  const [newRefScopes, setNewRefScopes] = useState(['socle_ri']);
  const [sendConfirmationMail, setSendConfirmationMail] = useState(true);
  const [lastCreatedReferent, setLastCreatedReferent] = useState(null);
  const [refFeedback, setRefFeedback] = useState('');

  useEffect(() => {
    try {
      window.localStorage?.setItem('bob_acr_referents', JSON.stringify(referents));
    } catch {}
  }, [referents]);

  const activeReferent =
    referents.find((r) => r.id === activeReferentId) || referents[0] || DEFAULT_REFERENTS[2];
  const roleMeta =
    REFERENT_ROLES.find((r) => r.id === activeReferent.role) || REFERENT_ROLES[0];
  const canWrite =
    (activeReferent.accessLevel ? activeReferent.accessLevel === 'read_write' : roleMeta.canWrite) &&
    roleMeta.canWrite;
  const allowedScopes = roleMeta.allScopes
    ? PERIMETERS.map((p) => p.code)
    : activeReferent.scopes || [];

  const isScopeVisible = (code) => {
    const normalized = code || 'socle_ri';
    if (!roleMeta.allScopes && !allowedScopes.includes(normalized)) return false;
    if (selectedScopeFilter !== 'all' && normalized !== selectedScopeFilter) return false;
    return true;
  };

  const filteredDocuments = (documents || []).filter((d) => isScopeVisible(d.module_code));
  const filteredAcknowledgments = (acknowledgments || []).filter((a) => isScopeVisible(a.module_code));
  const filteredEscalations = (escalations || []).filter((e) => isScopeVisible(e.module_code));

  const perimeterKpis = PERIMETERS.filter((p) =>
    roleMeta.allScopes ? true : allowedScopes.includes(p.code)
  ).map((p) => {
    const docs = (documents || []).filter((d) => (d.module_code || 'socle_ri') === p.code);
    const acks = (acknowledgments || []).filter((a) => (a.module_code || 'socle_ri') === p.code);
    const escs = (escalations || []).filter((e) => (e.module_code || 'socle_ri') === p.code);
    const openEscs = escs.filter((e) => !e.referent_answer);
    const answeredEscs = escs.filter((e) => Boolean(e.referent_answer));
    const resolutionRate = escs.length > 0 ? Math.round((answeredEscs.length / escs.length) * 100) : 100;
    const ackRatioPerDoc = docs.length > 0 ? (acks.length / docs.length).toFixed(1) : '0.0';
    return {
      ...p,
      docCount: docs.length,
      ackCount: acks.length,
      ackRatioPerDoc,
      escTotal: escs.length,
      openCount: openEscs.length,
      resolutionRate,
    };
  });

  const handleAddReferent = (e) => {
    e.preventDefault();
    setRefFeedback('');
    if (!canWrite) {
      setRefFeedback('Action impossible en mode lecture seule.');
      return;
    }
    if (!newRefName.trim() || !newRefEmail.trim()) {
      setRefFeedback('Renseignez le nom et l’adresse e-mail du référent.');
      return;
    }
    const scopesToAssign = newRefScopes.length ? newRefScopes : ['socle_ri'];
    const created = {
      id: `ref-${Date.now()}`,
      name: newRefName.trim(),
      email: newRefEmail.trim(),
      role: 'referent_metier',
      accessLevel: newRefAccess,
      scopes: scopesToAssign,
    };
    setReferents((prev) => [...prev, created]);
    setLastCreatedReferent(created);
    setNewRefName('');
    setNewRefEmail('');
    setRefFeedback(
      `${created.name} (${created.email}) ajouté en ${
        created.accessLevel === 'read_write' ? 'lecture et écriture' : 'lecture seule'
      } sur : ${scopesToAssign.map(getScopeShort).join(', ')}.`
    );

    if (sendConfirmationMail && typeof window !== 'undefined') {
      window.location.href = buildConfirmationMailto(created);
    }
  };

  const handleRemoveReferent = (refId) => {
    if (!canWrite || referents.length <= 1) return;
    setReferents((prev) => {
      const next = prev.filter((r) => r.id !== refId);
      if (activeReferentId === refId && next[0]) {
        setActiveReferentId(next[0].id);
      }
      return next;
    });
  };

  const updateReferentAccess = (refId, accessLevel) => {
    if (!canWrite) return;
    setReferents((prev) =>
      prev.map((r) => (r.id === refId ? { ...r, accessLevel } : r))
    );
  };

  const toggleReferentScope = (refId, scopeCode) => {
    if (!canWrite) return;
    setReferents((prev) =>
      prev.map((r) => {
        if (r.id !== refId) return r;
        const exists = r.scopes.includes(scopeCode);
        const nextScopes = exists ? r.scopes.filter((s) => s !== scopeCode) : [...r.scopes, scopeCode];
        return { ...r, scopes: nextScopes.length ? nextScopes : [scopeCode] };
      })
    );
  };

  return {
    referents,
    activeReferent,
    activeReferentId,
    setActiveReferentId,
    roleMeta: { ...roleMeta, canWrite },
    allowedScopes,
    selectedScopeFilter,
    setSelectedScopeFilter,
    filteredDocuments,
    filteredAcknowledgments,
    filteredEscalations,
    perimeterKpis,
    publishToKnowledgeBase,
    setPublishToKnowledgeBase,
    newRefName,
    setNewRefName,
    newRefEmail,
    setNewRefEmail,
    newRefAccess,
    setNewRefAccess,
    newRefScopes,
    setNewRefScopes,
    sendConfirmationMail,
    setSendConfirmationMail,
    lastCreatedReferent,
    refFeedback,
    handleAddReferent,
    handleRemoveReferent,
    updateReferentAccess,
    toggleReferentScope,
  };
}

export function ScopeToolbar({ gov }) {
  return (
    <div className="bg-indigo-950 text-indigo-50 px-6 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-indigo-900">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 font-medium text-indigo-200">
          <Users className="w-3.5 h-3.5 text-indigo-300" />
          Profil actif :
        </span>
        <select
          value={gov.activeReferentId}
          onChange={(e) => {
            gov.setActiveReferentId(e.target.value);
            gov.setSelectedScopeFilter('all');
          }}
          className="bg-indigo-900 border border-indigo-700 text-white rounded-lg px-2.5 py-1 text-xs font-medium"
        >
          {gov.referents.map((ref) => {
            const rMeta = REFERENT_ROLES.find((x) => x.id === ref.role);
            return (
              <option key={ref.id} value={ref.id}>
                {ref.name} ({ref.email || 'sans email'}) — {rMeta ? rMeta.label.split(' (')[0] : ref.role}
              </option>
            );
          })}
        </select>
        <span className="px-2 py-0.5 rounded bg-indigo-900/90 border border-indigo-700/70 text-[11px] text-indigo-200">
          {gov.roleMeta.canWrite ? 'Lecture et écriture' : 'Lecture seule'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-indigo-200">
          <Layers className="w-3.5 h-3.5 text-indigo-300" />
          Périmètre :
        </span>
        <select
          value={gov.selectedScopeFilter}
          onChange={(e) => gov.setSelectedScopeFilter(e.target.value)}
          className="bg-indigo-900 border border-indigo-700 text-white rounded-lg px-2.5 py-1 text-xs"
        >
          <option value="all">
            {gov.roleMeta.allScopes ? 'Tous les périmètres' : 'Mes périmètres assignés'}
          </option>
          {PERIMETERS.filter((p) =>
            gov.roleMeta.allScopes ? true : gov.allowedScopes.includes(p.code)
          ).map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function PerimeterKpiGrid({ gov }) {
  return (
    <section className="bg-slate-50 border-b border-slate-200 px-6 py-4">
      <div className="max-w-5xl mx-auto space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            KPI par périmètre métier ({gov.perimeterKpis.length} périmètres)
          </h2>
          <span className="text-[11px] text-slate-500">
            Périmètres actifs : {gov.allowedScopes.map(getScopeShort).join(', ')}
          </span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {gov.perimeterKpis.map((kpi) => (
            <div
              key={kpi.code}
              onClick={() =>
                gov.setSelectedScopeFilter(gov.selectedScopeFilter === kpi.code ? 'all' : kpi.code)
              }
              className={`cursor-pointer rounded-xl border p-3.5 bg-white transition shadow-sm ${
                gov.selectedScopeFilter === kpi.code
                  ? 'border-indigo-600 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">{kpi.label}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                  {kpi.resolutionRate}% résolu
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-slate-400">Docs</div>
                  <div className="font-semibold text-slate-800">{kpi.docCount}</div>
                </div>
                <div>
                  <div className="text-slate-400">Émarg.</div>
                  <div className="font-semibold text-emerald-700">
                    {kpi.ackCount}{' '}
                    <span className="font-normal text-slate-400">({kpi.ackRatioPerDoc}/d)</span>
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Escalades</div>
                  <div className="font-semibold text-amber-700">
                    {kpi.openCount} ouv. / {kpi.escTotal}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ReferentTabContent({
  gov,
  replyDrafts,
  setReplyDrafts,
  replySaving,
  handleReplyEscalation,
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-sm text-slate-900">
              File active du référent — {gov.activeReferent.name}
            </h2>
            <p className="text-xs text-slate-500">
              Périmètres couverts : {gov.allowedScopes.map(getScopeLabel).join(' • ')}
            </p>
          </div>
          <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2.5 py-1 rounded-full">
            {gov.filteredEscalations.filter((e) => !e.referent_answer).length} ticket(s) à traiter
          </span>
        </div>

        {gov.filteredEscalations.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune escalade sur le périmètre sélectionné.</p>
        ) : (
          <div className="space-y-3">
            {gov.filteredEscalations.map((esc) => (
              <div
                key={esc.id}
                className="border border-slate-200 rounded-xl p-4 space-y-2.5 bg-slate-50/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                      {getScopeShort(esc.module_code)}
                    </span>
                    <span className="font-mono text-slate-600">
                      #{String(esc.id).slice(0, 8).toUpperCase()}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full font-medium ${
                        esc.referent_answer
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {esc.referent_answer ? 'Répondu' : 'En attente'}
                    </span>
                  </div>
                  <span className="text-slate-500">
                    {esc.created_at ? new Date(esc.created_at).toLocaleString('fr-FR') : ''}
                  </span>
                </div>

                <p className="text-sm font-medium text-slate-900">« {esc.question_topic} »</p>

                {esc.referent_answer ? (
                  <div className="bg-white border border-emerald-200 rounded-lg p-3 text-xs space-y-1">
                    <div className="font-semibold text-emerald-800">
                      Réponse enregistrée ({esc.answered_by_role || 'Référent'})
                    </div>
                    <p className="text-slate-800 whitespace-pre-line">{esc.referent_answer}</p>
                  </div>
                ) : gov.roleMeta.canWrite ? (
                  <div className="space-y-2 pt-1">
                    <textarea
                      rows={2}
                      value={replyDrafts[esc.id] || ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [esc.id]: e.target.value }))
                      }
                      placeholder="Rédiger la réponse officielle pour ce périmètre..."
                      className="w-full text-sm bg-white border border-slate-200 rounded-lg p-2.5"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={Boolean(gov.publishToKnowledgeBase[esc.id])}
                          onChange={(e) =>
                            gov.setPublishToKnowledgeBase((prev) => ({
                              ...prev,
                              [esc.id]: e.target.checked,
                            }))
                          }
                        />
                        <span>
                          Capitaliser aussi dans la base documentaire ({getScopeShort(esc.module_code)})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleReplyEscalation(esc.id)}
                        disabled={replySaving[esc.id] || !(replyDrafts[esc.id] || '').trim()}
                        className="text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3.5 py-1.5 rounded-lg"
                      >
                        {replySaving[esc.id] ? 'Enregistrement...' : 'Publier la réponse'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs italic text-slate-500">
                    Mode lecture seule : réponse réservée aux référents.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5 shadow-sm">
        <h3 className="font-semibold text-sm text-slate-900">
          Attribution des rôles &amp; périmètres référents
        </h3>

        {gov.roleMeta.canWrite && (
          <form
            onSubmit={gov.handleAddReferent}
            className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3 text-xs"
          >
            <div className="grid md:grid-cols-3 gap-2.5">
              <input
                type="text"
                value={gov.newRefName}
                onChange={(e) => gov.setNewRefName(e.target.value)}
                placeholder="Nom du référent (ex: Madame Dupont)"
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900"
              />
              <input
                type="text"
                inputMode="email"
                value={gov.newRefEmail}
                onChange={(e) => gov.setNewRefEmail(e.target.value)}
                placeholder="Adresse e-mail (ex: dupont@entreprise.fr)"
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900"
              />
              <select
                value={gov.newRefAccess}
                onChange={(e) => gov.setNewRefAccess(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 font-medium text-slate-900"
              >
                <option value="read_write">Autorisé en lecture et écriture</option>
                <option value="read_only">Autorisé en lecture seule</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="font-medium text-slate-800">
                Est autorisée dans le(s) périmètre(s) suivant(s) :
              </div>
              <div className="flex flex-wrap gap-3">
                {PERIMETERS.map((p) => {
                  const checked = gov.newRefScopes.includes(p.code);
                  return (
                    <label
                      key={p.code}
                      className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 cursor-pointer text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          gov.setNewRefScopes((prev) =>
                            prev.includes(p.code)
                              ? prev.filter((x) => x !== p.code)
                              : [...prev, p.code]
                          )
                        }
                      />
                      <span>{p.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gov.sendConfirmationMail}
                  onChange={(e) => gov.setSendConfirmationMail(e.target.checked)}
                />
                <Mail className="w-3.5 h-3.5 text-indigo-600" />
                <span>Envoyer un e-mail de confirmation au référent lors de l'inscription</span>
              </label>

              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-4 py-2"
              >
                Enregistrer l'attribution
              </button>
            </div>

            {gov.refFeedback && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-indigo-900 bg-indigo-100/80 border border-indigo-200 rounded-lg px-3 py-2">
                <span>{gov.refFeedback}</span>
                {gov.lastCreatedReferent?.email && (
                  <a
                    href={buildConfirmationMailto(gov.lastCreatedReferent)}
                    className="inline-flex items-center gap-1 underline text-indigo-800 hover:text-indigo-950"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Ouvrir le mail ({gov.lastCreatedReferent.email})
                  </a>
                )}
              </div>
            )}
          </form>
        )}

        <div className="space-y-2.5">
          {gov.referents.map((ref) => {
            const rMeta = REFERENT_ROLES.find((x) => x.id === ref.role) || REFERENT_ROLES[0];
            const isRW = ref.accessLevel ? ref.accessLevel === 'read_write' : rMeta.canWrite;
            return (
              <div
                key={ref.id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900">{ref.name}</span>
                    {ref.email && (
                      <span className="text-slate-600 ml-2 font-mono text-[11px]">{ref.email}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ref.email && (
                      <a
                        href={buildConfirmationMailto(ref)}
                        className="text-[11px] text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded border border-indigo-200 bg-white inline-flex items-center gap-1"
                      >
                        <Mail className="w-3 h-3" />
                        Mail confirmation
                      </a>
                    )}
                    <select
                      value={isRW ? 'read_write' : 'read_only'}
                      disabled={!gov.roleMeta.canWrite || rMeta.allScopes}
                      onChange={(e) => gov.updateReferentAccess(ref.id, e.target.value)}
                      className="bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] font-medium"
                    >
                      <option value="read_write">Lecture et écriture</option>
                      <option value="read_only">Lecture seule</option>
                    </select>
                    {gov.roleMeta.canWrite && gov.referents.length > 1 && (
                      <button
                        type="button"
                        onClick={() => gov.handleRemoveReferent(ref.id)}
                        className="text-[11px] text-red-600 hover:text-red-700 px-2 py-1 rounded border border-red-200 bg-white"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500 mr-1">Périmètres :</span>
                  {PERIMETERS.map((p) => {
                    const active = rMeta.allScopes || ref.scopes.includes(p.code);
                    return (
                      <label
                        key={p.code}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={!gov.roleMeta.canWrite || rMeta.allScopes}
                          onChange={() => gov.toggleReferentScope(ref.id, p.code)}
                        />
                        <span>{p.short}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
