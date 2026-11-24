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

router.post('/query', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { question, channel = 'api', module_code = null } = req.body || {};

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
      moduleFilter = `AND module_code = $${params.length}`;
    }

    const chunksRes = await client.query(
      `SELECT
         id,
         document_id,
         module_code,
         chunk_index,
         page_number,
         content,
         1 - (embedding <=> $1::vector(1536)) AS similarity
       FROM document_chunks
       WHERE 1=1 ${moduleFilter}
       ORDER BY embedding <=> $1::vector(1536)
       LIMIT 4`,
      params
    );

    const topChunks = chunksRes.rows;
    const bestChunk = topChunks[0] || null;
    const confidenceScore = bestChunk
      ? Math.max(0, Math.min(1, Number(Number(bestChunk.similarity).toFixed(3))))
      : 0;
    const hasContext = topChunks.length > 0 && confidenceScore >= 0.35;

    const contextBlock = topChunks
      .map(
        (c, idx) =>
          `[Source ${idx + 1} | doc=${c.document_id} | module=${c.module_code} | page=${c.page_number ?? 'n/a'} | score=${Number(c.similarity).toFixed(2)}]\n${c.content}`
      )
      .join('\n\n');

    const systemPrompt = `Tu es BOB, l'assistant souverain de conformité et réglementation (A.C.R.) pour l'entreprise "${req.tenant.name}".
Réponds en français, de manière précise, factuelle et structurée, uniquement à partir des extraits fournis.
Si l'information n'est pas suffisamment étayée par les extraits, indique clairement que tu n'as pas la confirmation dans les documents disponibles et invite à escalader vers le référent conformité.`;

    const userPrompt = hasContext
      ? `Question : ${cleanQuestion}\n\nExtraits documentaires :\n${contextBlock}`
      : `Question : ${cleanQuestion}\n\nAucun extrait suffisamment pertinent n'a été trouvé dans la base documentaire.`;

    const answer = await generateAnswer({
      systemPrompt,
      userPrompt,
    });

    const unansweredFlag = !hasContext;
    const wasEscalated = unansweredFlag;
    const escalatedToRole = wasEscalated ? 'compliance_referent' : null;
    const citedDocumentId = bestChunk ? bestChunk.document_id : null;
    const resolvedModule = (module_code && String(module_code).trim()) || (bestChunk && bestChunk.module_code) || null;
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

    return res.json({
      status: 'ok',
      query_id: logRes.rows[0].id,
      tenant: {
        id: req.tenant.id,
        name: req.tenant.name,
      },
      answer,
      confidence_score: confidenceScore,
      unanswered_flag: unansweredFlag,
      was_escalated: wasEscalated,
      sources: topChunks.map((c) => ({
        chunk_id: c.id,
        document_id: c.document_id,
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
