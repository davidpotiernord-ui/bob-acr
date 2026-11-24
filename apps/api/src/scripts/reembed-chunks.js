require('dotenv').config();
const db = require('../services/db');
const { embedText } = require('../services/llm');

function toVector1536Literal(embedding) {
  const targetDim = 1536;
  const arr = Array.isArray(embedding) ? embedding.slice(0, targetDim) : [];
  while (arr.length < targetDim) {
    arr.push(0);
  }
  return `[${arr.map((n) => Number(n) || 0).join(',')}]`;
}

async function run() {
  const res = await db.query(
    'SELECT id, module_code, page_number, content FROM document_chunks ORDER BY created_at ASC'
  );
  console.log(`Chunks à vectoriser avec Mistral : ${res.rows.length}`);

  for (const row of res.rows) {
    const embedding = await embedText(row.content);
    const vectorLiteral = toVector1536Literal(embedding);
    await db.query(
      'UPDATE document_chunks SET embedding = $1::vector(1536) WHERE id = $2',
      [vectorLiteral, row.id]
    );
    console.log(`OK -> ${row.id} (${row.module_code}, p.${row.page_number ?? 'n/a'})`);
  }

  await db.pool.end();
}

run().catch((err) => {
  console.error('Erreur reembed:', err.message);
  process.exit(1);
});
