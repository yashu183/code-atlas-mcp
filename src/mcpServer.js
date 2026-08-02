import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openDb } from "./db.js";
import { searchCode } from "./search.js";
import { findNodeByQualifiedName, getCallees, getCallers, getBlastRadius } from "./graph.js";

const db = openDb();

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
      "PRIMARY DEPENDENCY ANALYSIS TOOL: Fast and accurate graph-based dependency tracking. Returns precise call relationships, callers, callees, and blast radius for any symbol. ALWAYS use this for blast radius, impact analysis, or dependency questions instead of manual code searches.",
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
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_code") {
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

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
