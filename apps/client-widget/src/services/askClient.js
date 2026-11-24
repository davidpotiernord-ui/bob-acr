const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
const DEMO_TENANT_ID = '11111111-1111-1111-1111-111111111111';

export async function askBob({ question, channel }) {
  try {
    const res = await fetch(`${API_BASE}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dev-tenant-id': DEMO_TENANT_ID,
        'x-dev-role': 'employee',
        'x-client-channel': channel
      },
      body: JSON.stringify({ question })
    });

    if (!res.ok) {
      throw new Error('API_UNAVAILABLE');
    }
    return await res.json();
  } catch {
    // Secours local si l'API Gateway n'est pas encore démarrée
    const lower = question.toLowerCase();
    if (lower.includes('epi') || lower.includes('soudure') || lower.includes('horaire')) {
      return {
        status: 'ANSWERED',
        answer:
          "D'après le document « Règlement Intérieur — Atelier Métal & Industrie du Sud » (version 1.2, page 5) : Le port des chaussures de sécurité S3, des lunettes de protection et des bouchons d'oreilles est strictement obligatoire dans toute la zone de soudure et de découpe laser.",
        confidence: 0.942,
        sources: [
          {
            documentId: '33333333-3333-3333-3333-333333333301',
            title: 'Règlement Intérieur — Atelier Métal & Industrie du Sud',
            version: '1.2',
            page: 5,
            origin: 'Documentation interne entreprise'
          }
        ]
      };
    }

    return {
      status: 'ESCALATED_OUT_OF_SCOPE',
      answer:
        "Cette question n'est pas couverte avec certitude par la documentation interne validée de votre entreprise. Votre demande a été signalée de façon anonyme pour enrichir la base et vous pouvez contacter votre référent interne.",
      escalation: {
        role: 'drh',
        contact: 'drh@atelier-metal-sud.fr'
      },
      sources: []
    };
  }
}
