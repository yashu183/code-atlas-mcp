// Pluggable embedding provider. Swap the body of `embed()` for whichever
// API/model you standardize on (Voyage, OpenAI, a local model via Ollama,
// Azure OpenAI embeddings, etc). Kept as a single function so the rest of
// the codebase never cares which provider is behind it.

const EMBEDDING_DIM = 1024; // match whatever model you actually use

/**
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embed(text) {
  const endpoint = process.env.EMBEDDING_ENDPOINT;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL || "qwen3-embedding";

  if (!endpoint) {
    throw new Error(
      "Set EMBEDDING_ENDPOINT (and EMBEDDING_API_KEY) before indexing. " +
        "E.g. an Azure OpenAI embeddings deployment, or a local Ollama endpoint."
    );
  }

  // Detect Ollama vs OpenAI-style API
  const isOllama = endpoint.includes("localhost") || endpoint.includes("127.0.0.1") || endpoint.includes("ollama");

  const body = isOllama
    ? { model, prompt: text }  // Ollama format
    : { input: text };          // OpenAI/Azure format

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Handle different response formats
  const vector = data.data ? data.data[0].embedding : data.embedding;
  return Float32Array.from(vector);
}

export function toBuffer(float32arr) {
  return Buffer.from(float32arr.buffer, float32arr.byteOffset, float32arr.byteLength);
}

export function fromBuffer(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
}

export { EMBEDDING_DIM };
