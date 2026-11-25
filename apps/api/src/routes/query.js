const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { embedText, generateAnswer } = require("../services/llm");

const router = express.Router();

const OUT_OF_SCOPE_PROMPT_ANSWER =
  "Je n'ai pas de référence documentaire pour répondre précisément à votre question. Souhaitez-vous que je fasse suivre votre question au référent conformité de façon anonyme ?";

let schemaReadyPromise = null;
function ensureEscalationColumns() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = db.pool
      .query(`
        ALTER TABLE query_logs
          ADD COLUMN IF NOT EXISTS referent_answer TEXT,
          ADD COLUMN IF NOT EXISTS referent_answer_sha256 VARCHAR(64),
          ADD COLUMN IF NOT EXISTS answered_by_role VARCHAR(50),
          ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS referent_acknowledged_at TIMESTAMPTZ;
      `)
      .catch((err) => {
        console.error("Migration auto query_logs (colonnes réponse référent):", err.message);
        schemaReadyPromise = null;
      });
  }
  return schemaReadyPromise;
}

async function notifyReferentWebhook({ tenantName, reference, channel, moduleCode, questionTopic }) {
  const webhookUrl = process.env.REFERENT_WEBHOOK_URL;
  const payload = {
    event: "bob.anonymous_escalation",
    tenant: tenantName,
    reference,
    channel,
    module_code: moduleCode || "general",
    question_topic: questionTopic,
    admin_url: process.env.ADMIN_DASHBOARD_URL || "https://bob-acr-admin.osc-fr1.scalingo.io",
    created_at: new Date().toISOString(),
  };

  console.info("[ESCALATION_NOTIFY]", JSON.stringify(payload));

  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[BOB • ${tenantName}] Nouvelle question anonyme #${reference} (${channel}) : "${questionTopic}"`,
        ...payload,
      }),
    });
  } catch (err) {
    console.error("Erreur notification webhook référent:", err.message);
  }
}

function toVector1536Literal(embedding) {
  const targetDim = 1536;
  const arr = Array.isArray(embedding) ? embedding.slice(0, targetDim) : [];
  while (arr.length < targetDim) {
    arr.push(0);
  }
  return `[${arr.map((n) => Number(n) || 0).join(",")}]`;
}

function formatContextSummary(context) {
  if (!context || typeof context !== "object") return "";
  const parts = [];
  if (context.domain) parts.push(`Domaine/outil actif : ${String(context.domain).slice(0, 120)}`);
  if (context.page_title) parts.push(`Page : ${String(context.page_title).slice(0, 140)}`);
  if (context.team_channel) parts.push(`Canal Teams : ${String(context.team_channel).slice(0, 120)}`);
  return parts.length > 0 ? `\nContexte d'utilisation : ${parts.join(" | ")}` : "";
}

function answerIndicatesMissingDocInfo(answerText) {
  if (!answerText || typeof answerText !== "string") return false;
  const normalized = answerText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return (
    normalized.includes("aucun extrait") ||
    normalized.includes("aucune information") ||
    normalized.includes("aucune confirmation") ||
    normalized.includes("escalade requise") ||
    normalized.includes("n'ai pas la confirmation") ||
    normalized.includes("n ai pas la confirmation") ||
    normalized.includes("n'ai pas trouve d'extrait") ||
    normalized.includes("n ai pas trouve d extrait") ||
    (normalized.includes("escalader") && normalized.includes("referent")) ||
    normalized.includes("aucune procedure") ||
    normalized.includes("n'est mentionnee") ||
    normalized.includes("n est mentionnee") ||
    normalized.includes("n'est pas confirmee") ||
    normalized.includes("n est pas confirmee") ||
    normalized.includes("n'est pas confirme") ||
    normalized.includes("n est pas confirme") ||
    normalized.includes("pas confirmee dans les extraits") ||
    normalized.includes("non precise dans les extraits") ||
    normalized.includes("non mentionne dans les extraits")
  );
}

router.post("/query", async (req, res) => {
  await ensureEscalationColumns();
  const client = await db.pool.connect();
  try {
    const {
      question,
      channel = "api",
      module_code = null,
      context = null,
    } = req.body || {};

    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Field \"question\" is required",
      });
    }

    const cleanQuestion = question.trim();
    const rawEmbedding = await embedText(cleanQuestion);
    const vectorLiteral = toVector1536Literal(rawEmbedding);

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const params = [vectorLiteral];
    let moduleFilter = "";
    if (module_code && typeof module_code === "string") {
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

    let rawAnswer = OUT_OF_SCOPE_PROMPT_ANSWER;
    if (hasContext) {
      const contextBlock = topChunks
        .map(
          (c, idx) =>
            `[Source ${idx + 1} | titre="${c.document_title || c.module_code || "Document"}" | version=${c.document_version || "1.0"} | module=${c.module_code} | page=${c.page_number ?? "n/a"} | score=${Number(c.similarity).toFixed(2)}]\n${c.content}`
        )
        .join("\n\n");

      const usageContext = formatContextSummary(context);

      const systemPrompt = `Tu es BOB, l'assistant souverain de conformité et réglementation (A.C.R.) pour l'entreprise "${req.tenant.name}".
Réponds en français, de manière précise, factuelle et structurée, uniquement à partir des extraits fournis.
Cite explicitement le titre et la version des documents sources utilisés.
Si l'information n'est pas suffisamment étayée par les extraits, indique clairement que tu n'as pas la confirmation dans les documents disponibles.`;

      const userPrompt = `Question : ${cleanQuestion}${usageContext}\n\nExtraits documentaires :\n${contextBlock}`;

      rawAnswer = await generateAnswer({
        systemPrompt,
        userPrompt,
      });
    }

    const unansweredFlag = !hasContext || answerIndicatesMissingDocInfo(rawAnswer);
    const finalAnswer = unansweredFlag ? OUT_OF_SCOPE_PROMPT_ANSWER : rawAnswer;
    const wasEscalated = false;
    const escalatedToRole = null;
    const citedDocumentId = !unansweredFlag && bestChunk ? bestChunk.document_id : null;
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

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      response_status: unansweredFlag ? "OUT_OF_SCOPE_PROMPT" : "ANSWERED",
      query_id: logRes.rows[0].id,
      tenant: {
        id: req.tenant.id,
        name: req.tenant.name,
      },
      answer: finalAnswer,
      confidence_score: confidenceScore,
      unanswered_flag: unansweredFlag,
      can_escalate: unansweredFlag,
      was_escalated: false,
      escalation: null,
      sources: unansweredFlag
        ? []
        : topChunks.map((c) => ({
            chunk_id: c.id,
            document_id: c.document_id,
            title: c.document_title || c.module_code || "Document interne",
            version: c.document_version || "1.0",
            sha256_hash: c.document_sha256 || null,
            module_code: c.module_code,
            page_number: c.page_number,
            similarity: Number(Number(c.similarity).toFixed(3)),
          })),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/query:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to process RAG query",
    });
  } finally {
    client.release();
  }
});

router.post("/escalate", async (req, res) => {
  await ensureEscalationColumns();
  const client = await db.pool.connect();
  try {
    const { query_id: queryId } = req.body || {};
    if (!queryId || typeof queryId !== "string") {
      return res.status(400).json({
        status: "error",
        message: "Field \"query_id\" is required",
      });
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const updateRes = await client.query(
      `UPDATE query_logs
       SET was_escalated = TRUE,
           escalated_to_role = 'compliance_referent'
       WHERE id = $1
         AND tenant_id = $2
       RETURNING id, channel, module_code, question_topic`,
      [queryId.trim(), req.tenant.id]
    );

    if (updateRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Query not found for this tenant",
      });
    }

    await client.query("COMMIT");

    const row = updateRes.rows[0];
    const reference = row.id.slice(0, 8).toUpperCase();

    notifyReferentWebhook({
      tenantName: req.tenant.name,
      reference,
      channel: row.channel,
      moduleCode: row.module_code,
      questionTopic: row.question_topic,
    }).catch(() => {});

    return res.json({
      status: "ok",
      was_escalated: true,
      escalation: {
        role: "Référent Conformité",
        anonymous: true,
        transmitted: true,
        reference,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/escalate:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to escalate query anonymously",
    });
  } finally {
    client.release();
  }
});

router.post("/escalations/status", async (req, res) => {
  await ensureEscalationColumns();
  const client = await db.pool.connect();
  try {
    const rawIds = Array.isArray(req.body?.query_ids) ? req.body.query_ids : [];
    const queryIds = rawIds
      .filter((id) => typeof id === "string" && /^[0-9a-fA-F-]{36}$/.test(id.trim()))
      .slice(0, 50);

    if (queryIds.length === 0) {
      return res.json({ status: "ok", items: [] });
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const result = await client.query(
      `SELECT
         id,
         question_topic,
         was_escalated,
         escalated_to_role,
         referent_answer,
         referent_answer_sha256,
         answered_by_role,
         answered_at,
         referent_acknowledged_at,
         created_at
       FROM query_logs
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])
       ORDER BY created_at DESC`,
      [req.tenant.id, queryIds]
    );

    await client.query("COMMIT");

    return res.json({
      status: "ok",
      items: result.rows.map((r) => ({
        query_id: r.id,
        reference: r.id.slice(0, 8).toUpperCase(),
        question_topic: r.question_topic,
        was_escalated: r.was_escalated,
        escalated_to_role: r.escalated_to_role || "compliance_referent",
        referent_answer: r.referent_answer || null,
        referent_answer_sha256: r.referent_answer_sha256 || null,
        answered_by_role: r.answered_by_role || "Référent Conformité",
        answered_at: r.answered_at || null,
        referent_acknowledged_at: r.referent_acknowledged_at || null,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/escalations/status:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to load escalation statuses",
    });
  } finally {
    client.release();
  }
});

router.post("/escalations/:queryId/acknowledge", async (req, res) => {
  await ensureEscalationColumns();
  const client = await db.pool.connect();
  try {
    const { queryId } = req.params;
    if (!queryId || !/^[0-9a-fA-F-]{36}$/.test(queryId.trim())) {
      return res.status(400).json({
        status: "error",
        message: "Valid \"queryId\" is required",
      });
    }

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const updateRes = await client.query(
      `UPDATE query_logs
       SET referent_acknowledged_at = COALESCE(referent_acknowledged_at, NOW())
       WHERE id = $1
         AND tenant_id = $2
         AND referent_answer IS NOT NULL
       RETURNING id, referent_answer_sha256, referent_acknowledged_at`,
      [queryId.trim(), req.tenant.id]
    );

    if (updateRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        status: "error",
        message: "Answered escalation not found",
      });
    }

    await client.query("COMMIT");

    const row = updateRes.rows[0];
    return res.json({
      status: "ok",
      proof: {
        query_id: row.id,
        reference: row.id.slice(0, 8).toUpperCase(),
        sha256_hash:
          row.referent_answer_sha256 ||
          crypto.createHash("sha256").update(row.id).digest("hex"),
        acknowledged_at: row.referent_acknowledged_at,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erreur POST /api/escalations/:queryId/acknowledge:", err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to acknowledge referent answer",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
