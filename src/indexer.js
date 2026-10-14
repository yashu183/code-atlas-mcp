// Indexer: walks the repo (or a diff subset of it), extracts nodes/edges
// for the graph, and chunks+embeds for the vector table.
//
// Dispatches by extension to a per-language extractor (src/extractors/*):
//   .cs          -> C# (classes/interfaces/records/structs, methods, DI registrations,
//                  top-level-statement Program.cs, [Authorize]/[AllowAnonymous] attributes)
//   .ts/.tsx/.js -> Angular/TS (decorated classes, methods, constructor injection, relative imports)
//   .yml/.yaml   -> pipeline/manifest structural nodes (Azure DevOps, GitHub Actions, k8s, compose)
//
// Each extractor is still a regex-based pass for readability end-to-end.
// For real accuracy on C#, swap in a Roslyn-based analyzer; for TS, ts-morph
// or tree-sitter. The schema and the rest of the pipeline don't change.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDb } from "./db.js";
import { embed, toBuffer } from "./embeddings.js";
import { extractCSharpSymbols, extractDiRegistrations, isDiRegistrationFile } from "./extractors/csharp.js";
import { extractAngularSymbols, extractRelativeImports } from "./extractors/angular.js";
import { extractYamlNodes } from "./extractors/yaml.js";

const REPO_ROOT = process.cwd();
const GRAPH_ONLY = process.env.GRAPH_ONLY === "true";
const EXT_LANG = {
  ".cs": "csharp",
  ".ts": "angular",
  ".tsx": "angular",
  ".js": "angular",
  ".jsx": "angular",
  ".yml": "yaml",
  ".yaml": "yaml",
};
const IGNORE_DIRS = new Set(["node_modules", "bin", "obj", ".git", ".repo-index", "dist", ".angular"]);

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function gitBlobSha(filePath) {
  try {
    return execSync(`git hash-object "${filePath}"`, { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return null;
  }
}

function getChangedFiles(sinceSha) {
  if (!sinceSha) return null; // full index
  try {
    const out = execSync(`git diff --name-status ${sinceSha} HEAD`, { cwd: REPO_ROOT }).toString().trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status, filePath: rest[rest.length - 1] };
    });
  } catch {
    return null;
  }
}

function walkAllSourceFiles(dir = REPO_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllSourceFiles(full, acc);
    } else if (EXT_LANG[path.extname(entry.name)]) {
      acc.push(path.relative(REPO_ROOT, full));
    }
  }
  return acc;
}

/** Dispatches to the right extractor; returns a uniform array of symbol dicts. */
function extractSymbols(filePath, text) {
  const lang = EXT_LANG[path.extname(filePath)];
  if (lang === "csharp") return extractCSharpSymbols(text);
  if (lang === "angular") return extractAngularSymbols(text);
  if (lang === "yaml") {
    // config nodes don't have precise line ranges (structural, not code) —
    // default to spanning the whole file, which is fine since the file
    // itself is short and gets embedded as one chunk anyway.
    const totalLines = text.split("\n").length;
    return extractYamlNodes(text).map((n) => ({ ...n, startLine: 1, endLine: totalLines, calls: [] }));
  }
  return [];
}

async function indexFile(db, repo, filePath) {
  const abs = path.join(REPO_ROOT, filePath);
  if (!fs.existsSync(abs)) return;
  const text = fs.readFileSync(abs, "utf-8");
  const blobSha = gitBlobSha(abs);
  const now = new Date().toISOString();
  const lang = EXT_LANG[path.extname(filePath)];

  db.prepare(`DELETE FROM nodes WHERE repo = ? AND path = ?`).run(repo, filePath);

  const fileNode = db
    .prepare(
      `INSERT INTO nodes (repo, path, kind, name, qualified_name, start_line, end_line, git_blob_sha, updated_at)
       VALUES (?, ?, 'file', ?, ?, 1, ?, ?, ?)`
    )
    .run(repo, filePath, path.basename(filePath), filePath, text.split("\n").length, blobSha, now);

  const symbols = extractSymbols(filePath, text);
  const nameToId = {};

  for (const sym of symbols) {
    const info = db
      .prepare(
        `INSERT INTO nodes (repo, path, kind, name, qualified_name, start_line, end_line, git_blob_sha, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(repo, filePath, sym.kind, sym.name, sym.qualifiedName, sym.startLine, sym.endLine, blobSha, now);
    nameToId[sym.name] = info.lastInsertRowid;
  }

  // 'calls' edges (C# and Angular methods both populate sym.calls)
  for (const sym of symbols) {
    const srcId = nameToId[sym.name];
    for (const callee of sym.calls || []) {
      const dstId = nameToId[callee] || null;
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, ?, ?, 'calls')`).run(srcId, dstId, callee);
    }
  }

  // 'injects' edges — constructor/primary-constructor DI (C#) and Angular
  // constructor injection. Target may not be indexed yet (cross-file), so
  // dst_id is left null here and repaired in the cross-file pass below.
  for (const sym of symbols) {
    const srcId = nameToId[sym.name];
    for (const injected of sym.injects || []) {
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, NULL, ?, 'injects')`).run(srcId, injected);
    }
  }

  // 'implements' edges from C# base lists (interfaces primarily)
  for (const sym of symbols) {
    const srcId = nameToId[sym.name];
    for (const base of sym.implements || []) {
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, NULL, ?, 'implements')`).run(srcId, base.replace(/<.*>/, ""));
    }
  }

  // 'references' edges — e.g. C# [Authorize]/[AllowAnonymous] attributes.
  // dst_id is intentionally always null (there's no node named "Authorize");
  // dst_ref carries the marker so "which methods require auth" is a graph
  // query (`WHERE kind='references' AND dst_ref='Authorize'`) instead of grep.
  for (const sym of symbols) {
    const srcId = nameToId[sym.name];
    for (const ref of sym.references || []) {
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, NULL, ?, 'references')`).run(srcId, ref);
    }
  }

  // 'imports' edges for Angular relative imports, resolved to a path guess
  // (exact file existence isn't checked here — cheap heuristic, refined
  // in the cross-file pass if needed)
  if (lang === "angular") {
    for (const spec of extractRelativeImports(text)) {
      const resolved = path.normalize(path.join(path.dirname(filePath), spec));
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, NULL, ?, 'imports')`).run(
        fileNode.lastInsertRowid,
        resolved
      );
    }
  }

  // chunks + embeddings - PARALLEL BATCH PROCESSING (skip if GRAPH_ONLY=true)
  if (!GRAPH_ONLY) {
    const PARALLEL_BATCH_SIZE = 10; // Process 10 embeddings concurrently

    const chunkTargets =
      lang === "yaml"
        ? [{ nodeId: fileNode.lastInsertRowid, start: 1, end: text.split("\n").length, text }]
        : symbols.length
        ? symbols
            .filter((s) => s.kind === "method" || s.kind === "function")
            .map((sym) => ({
              nodeId: nameToId[sym.name],
              start: sym.startLine,
              end: sym.endLine,
              text: text.split("\n").slice(sym.startLine - 1, sym.endLine).join("\n"),
            }))
        : [{ nodeId: fileNode.lastInsertRowid, start: 1, end: text.split("\n").length, text }];

    // Filter out chunks that already exist
    const chunksToEmbed = [];
    for (const chunk of chunkTargets) {
      const hash = sha256(chunk.text);
      const existing = db.prepare(`SELECT id FROM chunks WHERE node_id = ? AND content_hash = ?`).get(chunk.nodeId, hash);
      if (!existing) {
        chunksToEmbed.push({ ...chunk, hash });
      }
    }

    // Process chunks in parallel batches
    for (let i = 0; i < chunksToEmbed.length; i += PARALLEL_BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + PARALLEL_BATCH_SIZE);
      const embeddings = await Promise.all(batch.map(chunk => embed(chunk.text)));

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const vector = embeddings[j];
        db.prepare(
          `INSERT INTO chunks (node_id, path, start_line, end_line, content_hash, text, embedding)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(chunk.nodeId, filePath, chunk.start, chunk.end, chunk.hash, chunk.text, toBuffer(vector));
      }
    }
  }
}

/** Resolves dst_id for edges left pointing only at dst_ref (cross-file targets). */
function resolveCrossFileEdges(db) {
  const unresolved = db.prepare(`SELECT id, dst_ref, kind FROM edges WHERE dst_id IS NULL AND dst_ref IS NOT NULL`).all();
  const findNode = db.prepare(`SELECT id FROM nodes WHERE name = ? OR qualified_name = ? LIMIT 1`);
  for (const edge of unresolved) {
    // strip a leading 'I' for interface->impl style matching isn't done here on
    // purpose — 'implements'/'injects' edges to an interface should resolve to
    // the interface node itself, not silently jump to an implementation.
    const target = findNode.get(edge.dst_ref, edge.dst_ref);
    if (target) {
      db.prepare(`UPDATE edges SET dst_id = ? WHERE id = ?`).run(target.id, edge.id);
    }
  }
}

/** Scans Program.cs / Startup*.cs for AddScoped/Singleton/Transient<IFoo, Foo>() and records 'registers' edges. */
function indexDiRegistrations(db, repo, allFiles) {
  const diFiles = allFiles.filter((f) => isDiRegistrationFile(f));
  db.prepare(`DELETE FROM edges WHERE kind = 'registers'`).run();
  const findNode = db.prepare(`SELECT id FROM nodes WHERE repo = ? AND (name = ? OR qualified_name = ?) LIMIT 1`);

  for (const filePath of diFiles) {
    const abs = path.join(REPO_ROOT, filePath);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf-8");
    for (const reg of extractDiRegistrations(text)) {
      const ifaceNode = findNode.get(repo, reg.iface, reg.iface);
      const implNode = findNode.get(repo, reg.impl, reg.impl);
      // Skip if either interface or implementation node wasn't found
      if (!ifaceNode || !implNode) continue;
      db.prepare(`INSERT INTO edges (src_id, dst_id, dst_ref, kind) VALUES (?, ?, ?, 'registers')`).run(
        ifaceNode.id,
        implNode.id,
        `${reg.iface}->${reg.impl} (${reg.lifetime})`
      );
    }
  }
}

async function main() {
  const repo = path.basename(REPO_ROOT);
  const db = openDb();
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  console.log(`\nIndex Mode: ${GRAPH_ONLY ? "GRAPH-ONLY (fast, no embeddings)" : "FULL (graph + embeddings)"}`);
  if (GRAPH_ONLY) {
    console.log("Embeddings disabled. search_code tool will not work, but graph tools will.\n");
  }

  const lastCommit = db.prepare(`SELECT value FROM meta WHERE key = 'last_indexed_commit'`).pluck().get();
  const headSha = execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();

  // --files=path1,path2,... reprocesses ONLY the listed files (e.g. to pick
  // up an extractor change for a specific set of files without walking the
  // whole repo or disturbing the incremental-index watermark). It's a
  // partial update: last_indexed_commit is intentionally left untouched so
  // a later plain incremental run still correctly diffs from where it left
  // off, instead of silently skipping everything else that changed in
  // between.
  const filesArg = process.argv.find((a) => a.startsWith("--files="));
  let targets;
  if (filesArg) {
    const files = filesArg
      .slice("--files=".length)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    targets = files.map((filePath) => ({ status: "M", filePath }));
    console.log(`Targeted reindex: ${files.length} file(s) via --files (last_indexed_commit left unchanged)`);
  } else {
    const diff = getChangedFiles(lastCommit);
    if (diff === null) {
      console.log("Full index (no prior commit recorded)...");
      targets = walkAllSourceFiles().map((filePath) => ({ status: "M", filePath }));
    } else {
      console.log(`Incremental index: ${diff.length} changed file(s) since ${lastCommit}`);
      targets = diff.filter((d) => EXT_LANG[path.extname(d.filePath)]);
    }
  }

  for (const { status, filePath } of targets) {
    if (status === "D") {
      db.prepare(`DELETE FROM nodes WHERE repo = ? AND path = ?`).run(repo, filePath);
      console.log(`  removed ${filePath}`);
      continue;
    }
    await indexFile(db, repo, filePath);
    console.log(`  indexed ${filePath} [${EXT_LANG[path.extname(filePath)]}]`);
  }

  resolveCrossFileEdges(db);
  indexDiRegistrations(db, repo, walkAllSourceFiles());

  if (!filesArg) {
    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('last_indexed_commit', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(headSha);
    console.log(`Done. Index now at commit ${headSha}.`);
  } else {
    console.log("Done (targeted reindex — last_indexed_commit unchanged).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
