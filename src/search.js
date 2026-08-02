import { embed, fromBuffer, cosineSimilarity } from "./embeddings.js";

/**
 * Brute-force cosine search. Fine up to tens of thousands of chunks
 * (a single mid-size repo). Beyond that, swap this for an ANN index
 * (sqlite-vec, Qdrant, pgvector) — the calling code doesn't need to change.
 */
export async function searchCode(db, query, topK = 8) {
  const queryVec = await embed(query);
  const rows = db
    .prepare(
      `SELECT c.id, c.text, c.path, c.start_line, c.end_line, c.embedding,
              n.qualified_name, n.kind, n.id AS node_id
       FROM chunks c LEFT JOIN nodes n ON n.id = c.node_id`
    )
    .all();

  const scored = rows.map((row) => ({
    ...row,
    score: cosineSimilarity(queryVec, fromBuffer(row.embedding)),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ embedding, ...rest }) => rest);
}
