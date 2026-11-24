const crypto = require('crypto');
const express = require('express');
const db = require('../services/db');
const { embedText } = require('../services/llm');

const router = express.Router();

function toVector1536Literal(embedding) {
  const targetDim = 1536;
  const arr = Array.isArray(embedding) ? embedding.slice(0, targetDim) : [];
  while (arr.length < targetDim) {
    arr.push(0);
  }
  return `[${arr.map((n) => Number(n) || 0).join(',')}]`;
}

function chunkText(rawText, maxLen = 900, overlap = 120) {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (!buffer) {
      buffer = para;
    } else if (buffer.length + 2 + para.length <= maxLen) {
      buffer += `\n\n${para}`;
    } else {
      chunks.push(buffer);
      const tail = buffer.slice(Math.max(0, buffer.length - overlap));
      buffer = `${tail}\n\n${para}`.slice(0, maxLen);
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

router.get('/documents', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const result = await client.query(
      `SELECT
         d.id,
         d.module_code,
         d.title,
         d.version,
         d.sha256_hash,
         d.status,
         d.audience_scope,
         d.requires_acknowledgment,
         d.is_shared_base,
         d.published_at,
         d.created_at,
         COUNT(c.id)::int AS chunk_count
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id
       GROUP BY d.id
       ORDER BY d.created_at DESC`
    );

    await client.query('COMMIT');
    return res.json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      documents: result.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur GET /api/documents:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to list documents',
    });
  } finally {
    client.release();
  }
});

router.post('/documents', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const {
      title,
      module_code,
      content,
      version = '1.0',
      status = 'published',
      audience_scope = 'all',
      requires_acknowledgment = false,
      file_url = null,
    } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ status: 'error', message: 'Field "title" is required' });
    }
    if (!module_code || typeof module_code !== 'string' || !module_code.trim()) {
      return res.status(400).json({ status: 'error', message: 'Field "module_code" is required' });
    }
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ status: 'error', message: 'Field "content" is required' });
    }

    const cleanTitle = title.trim().slice(0, 255);
    const cleanModule = module_code.trim().slice(0, 50);
    const cleanVersion = String(version).trim().slice(0, 50) || '1.0';
    const cleanStatus = ['draft', 'published', 'archived'].includes(status) ? status : 'published';
    const cleanContent = content.trim();

    const sha256Hash = crypto.createHash('sha256').update(cleanContent, 'utf8').digest('hex');
    const chunks = chunkText(cleanContent);

    if (chunks.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Document content produced no chunks' });
    }

    const embeddedChunks = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const embedding = await embedText(chunks[i]);
      embeddedChunks.push({
        index: i,
        content: chunks[i],
        vectorLiteral: toVector1536Literal(embedding),
      });
    }

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
      req.tenant.id,
    ]);

    const publishedAt = cleanStatus === 'published' ? new Date().toISOString() : null;

    const docRes = await client.query(
      `INSERT INTO documents (
         tenant_id,
         is_shared_base,
         module_code,
         title,
         version,
         sha256_hash,
         file_url,
         status,
         audience_scope,
         requires_acknowledgment,
         published_at
       )
       VALUES ($1, false, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, module_code, title, version, sha256_hash, status, requires_acknowledgment, published_at, created_at`,
      [
        req.tenant.id,
        cleanModule,
        cleanTitle,
        cleanVersion,
        sha256Hash,
        file_url,
        cleanStatus,
        String(audience_scope).slice(0, 100),
        Boolean(requires_acknowledgment),
        publishedAt,
      ]
    );

    const createdDoc = docRes.rows[0];

    for (const chunk of embeddedChunks) {
      await client.query(
        `INSERT INTO document_chunks (
           document_id,
           tenant_id,
           is_shared_base,
           module_code,
           chunk_index,
           content,
           page_number,
           embedding
         )
         VALUES ($1, $2, false, $3, $4, $5, $6, $7::vector(1536))`,
        [
          createdDoc.id,
          req.tenant.id,
          cleanModule,
          chunk.index,
          chunk.content,
          chunk.index + 1,
          chunk.vectorLiteral,
        ]
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'ok',
      tenant: { id: req.tenant.id, name: req.tenant.name },
      document: createdDoc,
      chunks_indexed: embeddedChunks.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Erreur POST /api/documents:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to ingest document',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
