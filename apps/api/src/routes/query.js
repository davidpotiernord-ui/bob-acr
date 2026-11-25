const express = require('express');
const db = require('../services/db');
const { embedText, generateAnswer } = require('../services/llm');

const router = express.Router();

function toVector1536Literal(embedding) {
  const targetDim = 1536;
  const arr = Array.isArray(embedding) ? embedding.slice(0, targetDim) : [];
  while (arr.length < targetDim) {
    arr.push(0);
  }
  return `[${arr.map((n) => Number(n) || 0).join(',')}]`;
}

function formatContextSummary(context) {
  if (!context || typeof context !== 'object') return '';
  const parts = [];
  if (context.domain) parts.push(`Domaine/outil actif : ${String(context.domain).slice(0, 120)}`);
  if (context.page_title) parts.push(`Page : ${String(context.page_title).slice(0, 140)}`);
  if (context.team_channel) parts.push(`Canal Teams : ${String(context.team_channel).slice(0, 120)}`);
  return parts.length > 0 ? `\nContexte d'utilisation : ${parts.join(' | ')}` : '';
}

function answerIndicatesMissingDocInfo(answerText) {
  if (!answerText || typeof answerText !== "string") return false;
  const normalized = answerText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return (
    normalized.includes("aucun extrait") ||
    normalized.includes("aucune confirmation disponible") ||
    normalized.includes("ne contiennent aucune information") ||
    normalized.includes("n'ai pas la confirmation dans les documents") ||
    normalized.includes("n ai pas la confirmation dans les documents") ||
    (normalized.includes("escalader") && normalized.includes("referent"))
  );
}

router.post('/query', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      question,
      channel = 'api',
      module_code = null,
      context = null,
    } = req.body || {};

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Field "question" is required',
      });
    }

    const cleanQuestion = question.trim();
    const rawEmbedding = await embedText(cleanQuestion);
    const vectorLiteral = toVector1536Literal(rawEmbedding);

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const params = [vectorLiteral];
    let moduleFilter = '';
    if (module_code && typeof module_code === 'string') {
      params.push(module_code.trim());
      moduleFilter = `AND dc.module_code = $${params.length}`;
    }

    const chunksRes = await client.query(
      `SELECT
         dc.id,
         dc.document_id,
         dc.module_code,
         dc.chunk_index,
         dc.page_number,
         dc.content,
         d.title AS document_title,
         d.version AS document_version,
         d.sha256_hash AS document_sha256,
         1 - (dc.embedding <=> $1::vector(1536)) AS similarity
       FROM document_chunks dc
       LEFT JOIN documents d ON d.id = dc.document_id
       WHERE (d.status = 'published' OR d.status IS NULL) ${moduleFilter}
       ORDER BY dc.embedding <=> $1::vector(1536)
       LIMIT 4`,
      params
    );

    const topChunks = chunksRes.rows;
    const bestChunk = topChunks[0] || null;
    const confidenceScore = bestChunk
      ? Math.max(0, Math.min(1, Number(Number(bestChunk.similarity).toFixed(3))))
      : 0;
    const hasContext = topChunks.length > 0 && confidenceScore >= 0.78;

    const contextBlock = topChunks
      .map(
        (c, idx) =>
          `[Source ${idx + 1} | titre="${c.document_title || c.module_code || 'Document'}" | version=${c.document_version || '1.0'} | module=${c.module_code} | page=${c.page_number ?? 'n/a'} | score=${Number(c.similarity).toFixed(2)}]\n${c.content}`
      )
      .join('\n\n');

    const usageContext = formatContextSummary(context);

    const systemPrompt = `Tu es BOB, l'assistant souverain de conformité et réglementation (A.C.R.) pour l'entreprise "${req.tenant.name}".
Réponds en français, de manière précise, factuelle et structurée, uniquement à partir des extraits fournis.
Cite explicitement le titre et la version des documents sources utilisés.
Si l'information n'est pas suffisamment étayée par les extraits, indique clairement que tu n'as pas la confirmation dans les documents disponibles et invite à escalader vers le référent conformité.`;

    const userPrompt = hasContext
      ? `Question : ${cleanQuestion}${usageContext}\n\nExtraits documentaires :\n${contextBlock}`
      : `Question : ${cleanQuestion}${usageContext}\n\nAucun extrait suffisamment pertinent n'a été trouvé dans la base documentaire.`;

    const answer = await generateAnswer({
      systemPrompt,
      userPrompt,
    });

    const unansweredFlag = !hasContext || answerIndicatesMissingDocInfo(answer);
    const wasEscalated = unansweredFlag;
    const escalatedToRole = wasEscalated ? 'compliance_referent' : null;
    const citedDocumentId = bestChunk ? bestChunk.document_id : null;
    const resolvedModule =
      (module_code && String(module_code).trim()) ||
      (bestChunk && bestChunk.module_code) ||
      null;
    const questionTopic = cleanQuestion.slice(0, 255);

    const logRes = await client.query(
      `INSERT INTO query_logs (
         tenant_id,
         channel,
         module_code,
         question_topic,
         cited_document_id,
         confidence_score,
         unanswered_flag,
         was_escalated,
         escalated_to_role
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        req.tenant.id,
        String(channel).slice(0, 50),
        resolvedModule,
        questionTopic,
        citedDocumentId,
        confidenceScore,
        unansweredFlag,
        wasEscalated,
        escalatedToRole,
      ]
    );

    await client.query('COMMIT');

    const escalation = wasEscalated
      ? {
          role: 'Référent Conformité',
          contact: process.env.DEFAULT_REFERENT_EMAIL || 'conformite@atelier-sud.fr',
        }
      : null;

    return res.json({
      status: 'ok',
      response_status: wasEscalated ? 'ESCALATED_OUT_OF_SCOPE' : 'ANSWERED',
      query_id: logRes.rows[0].id,
      tenant: {
        id: req.tenant.id,
        name: req.tenant.name,
      },
      answer,
      confidence_score: confidenceScore,
      unanswered_flag: unansweredFlag,
      was_escalated: wasEscalated,
      escalation,
      sources: topChunks.map((c) => ({
        chunk_id: c.id,
        document_id: c.document_id,
        title: c.document_title || c.module_code || 'Document interne',
        version: c.document_version || '1.0',
        sha256_hash: c.document_sha256 || null,
        module_code: c.module_code,
        page_number: c.page_number,
        similarity: Number(Number(c.similarity).toFixed(3)),
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/query:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to process RAG query',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
