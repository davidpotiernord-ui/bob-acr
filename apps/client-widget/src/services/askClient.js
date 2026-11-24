const API_BASE = import.meta.env.VITE_API_URL || 'https://bob-acr-api.osc-fr1.scalingo.io/api';
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

const MODULE_LABELS = {
  socle_ri: 'Règlement Intérieur & Chartes',
  rgpd: 'Protection des Données (RGPD)',
  sapin_ii: 'Anti-corruption (Sapin II)',
  cyber: 'Sécurité des Systèmes (Cyber)',
  lcb_ft: 'Lutte Blanchiment (LCB-FT)',
};

export async function askBob({ question, channel }) {
  const res = await fetch(`${API_BASE}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': DEMO_TENANT_ID,
    },
    body: JSON.stringify({ question, channel }),
  });

  if (!res.ok) {
    throw new Error(`Erreur API (${res.status})`);
  }

  const data = await res.json();
  const isEscalated = Boolean(data.was_escalated || data.unanswered_flag);

  return {
    status: isEscalated ? 'ESCALATED_OUT_OF_SCOPE' : 'ANSWERED',
    answer: data.answer,
    confidence: data.confidence_score,
    escalation: isEscalated
      ? {
          role: 'Référent Conformité / DRH',
          contact: 'referent@atelier-metal-sud.fr',
        }
      : null,
    sources: (data.sources || []).map((src) => ({
      documentId: src.document_id,
      title: MODULE_LABELS[src.module_code] || src.module_code,
      version: `score ${(Number(src.similarity || 0) * 100).toFixed(0)}%`,
      page: src.page_number,
      origin: 'Base documentaire certifiée',
    })),
  };
}

export async function acknowledgeDocument({
  documentId,
  userEmail = 'salarie.demo@atelier-metal-sud.fr',
  fullName = 'Salarié Atelier',
  department = 'Production',
}) {
  const res = await fetch(`${API_BASE}/acknowledgments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': DEMO_TENANT_ID,
    },
    body: JSON.stringify({
      document_id: documentId,
      user_email: userEmail,
      full_name: fullName,
      department,
    }),
  });

  if (!res.ok) {
    throw new Error(`Erreur émargement (${res.status})`);
  }

  return await res.json();
}
