import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import { openDb } from "./db.js";
import { searchCode } from "./search.js";
import { findNodeByQualifiedName, getCallees, getCallers, getBlastRadius } from "./graph.js";
import neo4j from 'neo4j-driver';
import fs from 'fs';
import path from 'path';

const db = openDb();

// Neo4j configuration from environment variables
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

// Generate Neo4j Browser Graph Style Sheet (.grass)
function generateGrassFile() {
  return `node {
  diameter: 50px;
  color: #A5ABB6;
  border-color: #9AA1AC;
  border-width: 2px;
  text-color-internal: #FFFFFF;
  font-size: 10px;
}

relationship {
  color: #A5ABB6;
  shaft-width: 1px;
  font-size: 8px;
  padding: 3px;
  text-color-external: #000000;
  text-color-internal: #FFFFFF;
}

node.Node {
  color: #9CA3AF;
  border-color: #6B7280;
  caption: {name};
}

node.Class {
  diameter: 60px;
  caption: {name};
}

node.Method {
  diameter: 45px;
  caption: {name};
}

node.Interface {
  diameter: 55px;
  caption: {name};
}

node:selected {
  border-width: 3px;
  border-color: #FDB022;
}

/* Changed nodes - RED */
node {
  color: <{color}>;
  border-color: <{color}>;
}

/* Override for specific states */
@node:changed(true) {
  color: #EF4444;
  border-color: #DC2626;
  border-width: 3px;
}

@node:blast_radius(true) {
  color: #F97316;
  border-color: #EA580C;
  border-width: 2.5px;
}

/* Relationship colors */
relationship.CALLS {
  color: #60A5FA;
  shaft-width: 1.5px;
}

relationship.IMPLEMENTS {
  color: #34D399;
  shaft-width: 2px;
}

relationship.INJECTS {
  color: #A78BFA;
  shaft-width: 1.5px;
}

relationship.REGISTERS {
  color: #FBBF24;
  shaft-width: 1.5px;
}
`;
}

// Helper function to get changed files based on mode
function getChangedFilesForBlastRadius(mode, commits = 1) {
  const repoRoot = process.cwd();
  let changedFiles = [];

  try {
    if (mode === 'staged') {
      const output = execSync('git diff --cached --name-only', { cwd: repoRoot }).toString().trim();
      changedFiles = output ? output.split('\n') : [];
    } else if (mode === 'all') {
      const output = execSync('git diff HEAD --name-only', { cwd: repoRoot }).toString().trim();
      changedFiles = output ? output.split('\n') : [];
    } else if (mode === 'commits') {
      // Walk the last N NON-MERGE commits directly (git log, not a HEAD~N
      // diff). HEAD~N counts merge commits as a single step too, so if one
      // of the last N commits was a merge, the diff picks up every file the
      // merged branch touched — not just "the last N things actually worked
      // on". `git log --no-merges` skips merge commits both for the count
      // and for the file list, and a bare `--pretty=format:` with
      // `--name-only` gives the changed files per commit with no header
      // noise to filter out.
      const output = execSync(
        `git log --no-merges -n ${commits} --name-only --pretty=format:`,
        { cwd: repoRoot }
      ).toString().trim();
      changedFiles = output ? [...new Set(output.split('\n').filter(Boolean))] : [];
    }
  } catch (error) {
    return { error: `Failed to get changed files: ${error.message}` };
  }

  return { files: changedFiles };
}

// Helper function to calculate blast radius for a set of node IDs
function calculateBlastRadiusForNodes(db, nodeIds, depth = 3) {
  const visited = new Set(nodeIds);
  const blastRadiusNodes = [];
  let frontier = [...nodeIds];

  for (let d = 0; d < depth; d++) {
    const next = [];

    for (const id of frontier) {
      const callers = db.prepare(`
        SELECT DISTINCT n.id, n.qualified_name, n.path, n.kind, n.name, n.start_line, n.end_line
        FROM edges e
        JOIN nodes n ON n.id = e.src_id
        WHERE e.dst_id = ?
      `).all(id);

      for (const caller of callers) {
        blastRadiusNodes.push({ ...caller, hops: d + 1 });
        if (!visited.has(caller.id)) {
          visited.add(caller.id);
          next.push(caller.id);
        }
      }
    }

    frontier = next;
    if (frontier.length === 0) break;
  }

  return blastRadiusNodes;
}

// Exports the full graph to Neo4j with change/blast-radius color markers, and
// writes the matching .grass stylesheet. Best-effort: throws on failure so
// callers can degrade gracefully (the text/JSON analysis stays valid even if
// Neo4j is unreachable — this is a visualization bonus on top of it, not a
// prerequisite for it).
async function exportGraphToNeo4j(db, { changedNodeIds, blastRadiusNodeIds, repoRoot }) {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session({ database: NEO4J_DATABASE });

  try {
    // Clear existing data
    await session.run('MATCH (n) DETACH DELETE n');

    // Create indexes
    await session.run('CREATE INDEX node_id_idx IF NOT EXISTS FOR (n:Node) ON (n.sqlite_id)');

    // Export all nodes with change markers
    const allNodes = db.prepare(`
      SELECT id, repo, path, kind, name, qualified_name, start_line, end_line
      FROM nodes
    `).all();

    const changedSet = new Set(changedNodeIds);
    const blastRadiusSet = new Set(blastRadiusNodeIds);

    for (const node of allNodes) {
      const label = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
      const isChanged = changedSet.has(node.id);
      const isInBlastRadius = blastRadiusSet.has(node.id);

      // Determine visual color
      let color = '#9CA3AF'; // Gray for unchanged
      if (isChanged) {
        color = '#EF4444'; // Red for changed
      } else if (isInBlastRadius) {
        color = '#F97316'; // Orange for blast radius
      }

      await session.run(`
        CREATE (n:Node:${label} {
          sqlite_id: $id,
          repo: $repo,
          path: $path,
          kind: $kind,
          name: $name,
          qualified_name: $qualified_name,
          start_line: $start_line,
          end_line: $end_line,
          changed: $changed,
          blast_radius: $blast_radius,
          color: $color
        })
      `, {
        id: neo4j.int(node.id),
        repo: node.repo,
        path: node.path,
        kind: node.kind,
        name: node.name,
        qualified_name: node.qualified_name,
        start_line: neo4j.int(node.start_line),
        end_line: neo4j.int(node.end_line),
        changed: isChanged,
        blast_radius: isInBlastRadius,
        color: color
      });
    }

    // Export edges
    const edges = db.prepare(`
      SELECT src_id, dst_id, kind
      FROM edges
      WHERE dst_id IS NOT NULL
    `).all();

    for (const edge of edges) {
      const relType = edge.kind.toUpperCase();
      await session.run(`
        MATCH (src:Node {sqlite_id: $src_id})
        MATCH (dst:Node {sqlite_id: $dst_id})
        CREATE (src)-[r:${relType}]->(dst)
      `, {
        src_id: neo4j.int(edge.src_id),
        dst_id: neo4j.int(edge.dst_id)
      });
    }

    // Generate and save .grass style file
    const grassPath = path.join(repoRoot, '.repo-index', 'blast-radius-style.grass');
    fs.mkdirSync(path.dirname(grassPath), { recursive: true });
    fs.writeFileSync(grassPath, generateGrassFile(), 'utf8');

    return {
      exported: true,
      nodeCount: allNodes.length,
      edgeCount: edges.length,
      grassFile: grassPath,
      browserUrl: 'http://localhost:7474',
      database: NEO4J_DATABASE,
      viewInstructions: [
        `Open http://localhost:7474 and select database "${NEO4J_DATABASE}"`,
        `Import colors once: Settings (⚙️) → Graph Stylesheet → drag in ${grassPath}`,
        "Run this query to see the blast radius:",
        "MATCH (n:Node) WHERE n.changed = true OR n.blast_radius = true " +
          "OPTIONAL MATCH (n)-[r]-(connected) WHERE connected.changed = true OR connected.blast_radius = true " +
          "RETURN n, r, connected"
      ],
      colorLegend: {
        "#EF4444": "changed nodes (red)",
        "#F97316": "blast radius / affected dependencies (orange)",
        "#9CA3AF": "unchanged nodes (gray)"
      }
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

const server = new Server(
  { name: "repo-index", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  {
    name: "search_code",
    description:
      "PRIMARY SEARCH TOOL: Semantic search over the entire indexed repo using embeddings. MUCH MORE ACCURATE than grep/regex. Returns the most relevant code chunks for natural-language or symbol-name queries, with file paths, line ranges, and containing symbols. Always prefer this over text-based searches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for, e.g. 'JWT validation logic' or 'GetUserAsync'" },
        topK: { type: "number", description: "How many results to return (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_call_graph",
    description:
      "PRIMARY DEPENDENCY ANALYSIS TOOL for HYPOTHETICAL / PRE-CHANGE questions. Computed from the current indexed codebase — does NOT require any git changes to exist yet. Returns precise call relationships, callers, callees, and blast radius for any symbol. ALWAYS use this for 'what would be affected IF I change X', planning, or impact analysis BEFORE edits are made. For blast radius of changes that already exist (staged/uncommitted/committed), use get_blast_radius_from_changes instead.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Qualified or short name, e.g. 'UserService.GetUserAsync'" },
        blastRadiusDepth: { type: "number", description: "Hops of callers to include (default 2, 0 to skip)" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_related_files",
    description:
      "Returns files most related to a given file, based on shared call edges and semantic similarity of their content. Useful for 'what else do I need to look at' before editing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_blast_radius_from_changes",
    description:
      "IMPACT ANALYSIS TOOL for changes that ALREADY EXIST (staged, all local uncommitted, or recent commits). ALWAYS use this INSTEAD OF running `git log`/`git diff`/`git show` manually to answer impact questions — those only show you a file-level text diff; this tool resolves the diff to actual indexed code symbols, walks the real call graph to find every dependent, automatically skips merge/promotion commits so they don't get counted as 'your changes' or pull in an unrelated branch's files (git log/diff alone will NOT do this), and auto-visualizes the result in Neo4j. Matches ANY phrasing of: 'what's the effect/impact of the last N commits', 'what did recent commits change/affect/break', 'blast radius of my changes', 'what will my changes affect', before committing, release planning, or QA acceptance criteria. Requires real changes to be present (git-diff-based) — for a HYPOTHETICAL 'what would be affected IF I change X' question asked before any edit exists, use get_call_graph instead. Returns changed files, affected nodes, and all dependent code that could be impacted, AND automatically exports the full graph to Neo4j with color-coded visualization (red=changed, orange=blast radius, gray=unchanged) plus a ready-to-import .grass stylesheet — so results are visible in the Neo4j Browser UI, not just as text.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["staged", "all", "commits"],
          description: "Change scope: 'staged' = staged changes only, 'all' = all local changes (staged+unstaged), 'commits' = last N commits"
        },
        commits: {
          type: "number",
          description: "Number of recent commits to analyze (1-10, only used when mode='commits', default 1). Counts NON-MERGE commits only — a merge commit in that range is skipped, not counted as one of the N."
        },
        depth: {
          type: "number",
          description: "Blast radius depth in hops (default 3). Higher = more comprehensive but slower."
        },
      },
      required: ["mode"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_code") {
    // Check if embeddings are available (graph-only mode check)
    const chunkCount = db.prepare(`SELECT COUNT(*) as count FROM chunks`).get();
    if (chunkCount.count === 0) {
      return {
        content: [{
          type: "text",
          text: "⚠️  search_code is unavailable: Index was built in GRAPH-ONLY mode (no embeddings).\n\n" +
                "To enable semantic search:\n" +
                "1. Re-run the indexer WITHOUT GRAPH_ONLY=true\n" +
                "2. Set EMBEDDING_ENDPOINT and EMBEDDING_MODEL environment variables\n" +
                "3. Indexing will take ~2-2.5 hours for embeddings\n\n" +
                "Graph-based tools (get_call_graph, get_related_files) are still available."
        }]
      };
    }
    const results = await searchCode(db, args.query, args.topK ?? 8);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }

  if (name === "get_call_graph") {
    const node = findNodeByQualifiedName(db, args.symbol);
    if (!node) {
      return { content: [{ type: "text", text: `No symbol found matching "${args.symbol}".` }] };
    }
    const payload = {
      symbol: node.qualified_name,
      path: node.path,
      lines: [node.start_line, node.end_line],
      calls: getCallees(db, node.id),
      calledBy: getCallers(db, node.id),
      blastRadius:
        args.blastRadiusDepth === 0 ? [] : getBlastRadius(db, node.id, args.blastRadiusDepth ?? 2),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "get_related_files") {
    const rows = db
      .prepare(
        `SELECT DISTINCT n2.path
         FROM nodes n1
         JOIN edges e ON e.src_id = n1.id
         JOIN nodes n2 ON n2.id = e.dst_id
         WHERE n1.path = ? AND n2.path != ?
         LIMIT 20`
      )
      .all(args.path, args.path);
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === "get_blast_radius_from_changes") {
    const mode = args.mode;
    const commits = Math.min(Math.max(1, args.commits || 1), 10); // Clamp to 1-10
    const depth = args.depth || 3;

    // Get changed files
    const result = getChangedFilesForBlastRadius(mode, commits);
    if (result.error) {
      return { content: [{ type: "text", text: `Error: ${result.error}` }] };
    }

    const changedFiles = result.files;
    if (changedFiles.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            mode,
            commits: mode === 'commits' ? commits : undefined,
            depth,
            changedFiles: [],
            changedNodes: [],
            blastRadius: [],
            summary: "No changes detected"
          }, null, 2)
        }]
      };
    }

    // Find nodes in changed files
    const changedNodes = [];
    for (const filePath of changedFiles) {
      const nodes = db.prepare(`
        SELECT id, qualified_name, path, kind, name, start_line, end_line
        FROM nodes
        WHERE path = ? AND kind != 'file'
      `).all(filePath);
      changedNodes.push(...nodes);
    }

    if (changedNodes.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            mode,
            commits: mode === 'commits' ? commits : undefined,
            depth,
            changedFiles,
            changedNodes: [],
            blastRadius: [],
            summary: "No indexed nodes found in changed files. Tip: Make sure the indexer has run on this repository."
          }, null, 2)
        }]
      };
    }

    // Calculate blast radius
    const changedNodeIds = changedNodes.map(n => n.id);
    const blastRadiusNodes = calculateBlastRadiusForNodes(db, changedNodeIds, depth);

    // Always export to Neo4j so the result is actually visible, not just JSON
    // text. Best-effort: a Neo4j failure degrades the response, it doesn't
    // fail the whole tool call — the analysis above is still valid.
    let neo4jExport;
    try {
      neo4jExport = await exportGraphToNeo4j(db, {
        changedNodeIds,
        blastRadiusNodeIds: blastRadiusNodes.map(n => n.id),
        repoRoot: process.cwd(),
      });
    } catch (error) {
      neo4jExport = {
        exported: false,
        error: error.message,
        hint: "Visualization skipped — Neo4j unreachable at " + NEO4J_URI +
          ". Start it (e.g. `docker run -p 7474:7474 -p 7687:7687 neo4j`) and re-run this tool to visualize. Troubleshooting: check `docker ps | grep neo4j`, `curl http://localhost:7474`, and the NEO4J_* env vars."
      };
    }

    // Build response
    const payload = {
      mode,
      commits: mode === 'commits' ? commits : undefined,
      depth,
      changedFiles: changedFiles.map(f => ({ path: f })),
      changedNodes: changedNodes.map(n => ({
        qualified_name: n.qualified_name,
        kind: n.kind,
        path: n.path,
        line: n.start_line
      })),
      blastRadius: blastRadiusNodes.map(n => ({
        qualified_name: n.qualified_name,
        kind: n.kind,
        path: n.path,
        line: n.start_line,
        hops: n.hops
      })),
      summary: {
        changedFilesCount: changedFiles.length,
        changedNodesCount: changedNodes.length,
        blastRadiusCount: blastRadiusNodes.length,
        totalImpact: changedNodes.length + blastRadiusNodes.length
      },
      neo4jExport
    };

    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
