# CodeGraph MCP - AI-Powered Code Intelligence for VS Code Copilot

A local, incrementally-updated codebase index combining **graph database** (dependency tracking) and **vector embeddings** (semantic search) in a single SQLite file, exposed to VS Code Copilot via MCP (Model Context Protocol).

## Why CodeGraph MCP?

- **Semantic Code Search**: Find code by concept, not just text matching
- **Dependency Analysis**: Understand blast radius before making changes
- **Dead Code Detection**: Find unused code through graph analysis
- **Incremental Updates**: Only re-index changed files (git diff-based)
- **Local-First**: No cloud dependencies, runs entirely on your machine
- **Multi-Language**: C#, TypeScript/Angular, YAML pipelines out of the box

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code Copilot                        │
│           (Asks questions about your codebase)              │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  CodeGraph MCP Server                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ search_code  │  │ get_call_    │  │ get_related_     │  │
│  │ (semantic)   │  │ graph        │  │ files            │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │    SQLite Database           │
          │  .repo-index/index.db        │
          ├──────────────────────────────┤
          │ Graph: Nodes + Edges         │
          │  - Classes, Methods          │
          │  - Calls, Implements         │
          │  - Injects, Registers        │
          ├──────────────────────────────┤
          │ Vectors: Code Chunks         │
          │  - Method-level embeddings   │
          │  - Semantic similarity       │
          └──────────────────────────────┘
                         │
                    (Optional)
                         ▼
          ┌──────────────────────────────┐
          │      Neo4j (Visualization)   │
          │   Graph queries & exploration│
          └──────────────────────────────┘
```

## Quick Start

### Choose Your Mode

**CodeGraph MCP** supports two indexing modes:

| Mode | Speed | Tools Available | Use Case |
|------|-------|----------------|----------|
| **Graph-Only** | ~3 minutes | `get_call_graph`, `get_related_files`, Neo4j export | Fast dependency analysis, no embedding setup needed |
| **Full (Graph + Embeddings)** | ~2-2.5 hours | `search_code`, `get_call_graph`, `get_related_files`, Neo4j export | Semantic code search + dependency analysis |

Set `GRAPH_ONLY=true` to skip embeddings and get instant graph-based tools.

### When to Use Each Mode

**Use Graph-Only If:**
- You want **fast setup** and immediate results
- You primarily need **dependency analysis** and blast radius
- You're using VS Code Copilot's `#codebase` for semantic search already
- You want to **visualize** the codebase in Neo4j
- You're **exploring** a new codebase and want quick insights

**Use Full Mode If:**
- You need **natural language code search** ("find retry logic")
- You want **concept-based discovery** ("show me error handling patterns")
- You have time for the initial 2.5-hour indexing
- You want the most comprehensive code intelligence

### Prerequisites

#### Graph-Only Mode
- **Node.js** 18+
- **Optional**: Docker or Neo4j Desktop (for graph visualization)
- **Optional**: Beekeeper Studio (for SQLite database browser)

#### Full Mode (Graph + Embeddings)
- **Node.js** 18+
- **Ollama** (for local embeddings) OR Azure OpenAI
- **Optional**: Docker (for Neo4j graph visualization)
- **Optional**: Neo4j Desktop (alternative to Docker)
- **Optional**: Beekeeper Studio (for SQLite database browser)

### 1. Install Dependencies
```bash
cd /path/to/codegraph-mcp
npm install
```

### 2. Choose Your Embedding Provider

#### Option A: Ollama (Recommended - Free & Local)
```bash
# Install Ollama from https://ollama.ai
# Pull embedding model
ollama pull qwen3-embedding

# Set environment variables
export EMBEDDING_ENDPOINT="http://localhost:11434/api/embeddings"
export EMBEDDING_MODEL="qwen3-embedding"
```

#### Option B: Azure OpenAI
```bash
export EMBEDDING_ENDPOINT="https://<your-instance>.openai.azure.com/openai/deployments/<model>/embeddings?api-version=2024-02-01"
export EMBEDDING_API_KEY="your-api-key"
export EMBEDDING_MODEL="text-embedding-ada-002"  # or text-embedding-3-small
```

### 3. Index Your Repository

#### Option A: Graph-Only Mode (Fast - 3 minutes)
Perfect for immediate dependency analysis and Neo4j visualization:

```bash
cd /path/to/your/repo
GRAPH_ONLY=true node /path/to/codegraph-mcp/src/indexer.js
```

**Performance**:
- Graph extraction: ~3 minutes (9,611 nodes, 46,693 edges for a ~500-file repo)
- Database size: ~10-20 MB
- No embedding setup required

**Available Tools**: `get_call_graph`, `get_related_files`, Neo4j export

#### Option B: Full Index (Graph + Embeddings - 2.5 hours)
For semantic search capabilities:

```bash
cd /path/to/your/repo
EMBEDDING_ENDPOINT="http://localhost:11434/api/embeddings" \
EMBEDDING_MODEL="qwen3-embedding" \
node /path/to/codegraph-mcp/src/indexer.js
```

**Performance**:
- Graph extraction: ~3 minutes (9,611 nodes, 46,693 edges for a ~500-file repo)
- Embeddings: ~2-2.5 hours with parallel processing (10 concurrent requests)
- Database size: ~100-110 MB

**Available Tools**: `search_code`, `get_call_graph`, `get_related_files`, Neo4j export

#### Upgrading from Graph-Only to Full
Simply re-run the indexer without `GRAPH_ONLY=true` and with embedding configuration. Existing graph data will be preserved, and only embeddings will be added.

### 4. Configure VS Code Copilot

Copy the MCP config to your repository:
```bash
cd /path/to/your/repo
mkdir -p .vscode
cp /path/to/codegraph-mcp/.vscode-mcp-example.json .vscode/mcp.json
```

Edit `.vscode/mcp.json` based on your mode:

#### Graph-Only Mode
```json
{
  "servers": {
    "repo-index": {
      "command": "node",
      "args": ["/absolute/path/to/codegraph-mcp/src/mcpServer.js"]
    }
  }
}
```

#### Full Mode (Graph + Embeddings)
```json
{
  "servers": {
    "repo-index": {
      "command": "node",
      "args": ["/absolute/path/to/codegraph-mcp/src/mcpServer.js"],
      "env": {
        "EMBEDDING_ENDPOINT": "http://localhost:11434/api/embeddings",
        "EMBEDDING_MODEL": "qwen3-embedding"
      }
    }
  }
}
```

### 5. Reload VS Code
```
Cmd+Shift+P → "Developer: Reload Window"
```

## Usage

### MCP Tools Available to Copilot

#### 1. `search_code` - Semantic Search *(Full Mode Only)*
Find code by natural language, not just keywords.

**Availability**: Only works when indexed with embeddings (without `GRAPH_ONLY=true`)

If you try to use `search_code` in graph-only mode, you'll get:
```
⚠️  search_code is unavailable: Index was built in GRAPH-ONLY mode (no embeddings).

To enable semantic search:
1. Re-run the indexer WITHOUT GRAPH_ONLY=true
2. Set EMBEDDING_ENDPOINT and EMBEDDING_MODEL environment variables
3. Indexing will take ~2-2.5 hours for embeddings

Graph-based tools (get_call_graph, get_related_files) are still available.
```

**Example queries**:
```
Find JWT token validation logic
Show me retry mechanisms
Where is error handling implemented?
Find code that calculates profit margins
```

#### 2. `get_call_graph` - Dependency Analysis
Understand what calls what, and blast radius analysis.

**Example queries**:
```
What's the blast radius for AuthenticationHelper?
Show me what depends on MarginController
What does UserService call?
Find all callers of ValidateToken method
```

#### 3. `get_related_files` - Discover Connected Code
Find files related through call edges.

**Example queries**:
```
What files are related to Program.cs?
Show me files connected to this service
```

### Best Practices for Copilot Queries

**Good (Uses MCP tools)**:
```
What's the impact of changing the authorization middleware?
Find all implementations of IRepository pattern
Show me error handling across the codebase
```

**Better (Explicit tool usage)**:
```
Use get_call_graph to analyze the blast radius of AuthHelper with depth 3
Use search_code to find margin calculation patterns
```

### Example Workflow: Graph-Only → Full Mode

Many users start with graph-only mode for quick exploration, then add semantic search later:

```bash
# Day 1: Quick exploration with graph-only
cd ~/projects/new-codebase
GRAPH_ONLY=true node ~/tools/codegraph-mcp/src/indexer.js

# Use graph tools in VS Code Copilot
# "Use get_call_graph to show what depends on AuthHelper"

# Export to Neo4j for visual exploration
NEO4J_PASSWORD="password" node ~/tools/codegraph-mcp/export-to-neo4j.js .

# Day 2: Add semantic search after initial exploration
EMBEDDING_ENDPOINT="http://localhost:11434/api/embeddings" \
EMBEDDING_MODEL="qwen3-embedding" \
node ~/tools/codegraph-mcp/src/indexer.js

# Now use semantic search
# "Use search_code to find JWT validation logic"
```

## Graph Visualization with Neo4j

Export your SQLite graph to Neo4j for visual exploration:

### Setup Neo4j

#### Option A: Docker (Recommended - Quick & Easy)
```bash
# Pull and run Neo4j
docker run -d \
  --name neo4j-codegraph \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest

# Check status
docker ps | grep neo4j-codegraph
```

To stop/start later:
```bash
docker stop neo4j-codegraph
docker start neo4j-codegraph
```

#### Option B: Neo4j Desktop
1. Install [Neo4j Desktop](https://neo4j.com/download/)
2. Create a local database
3. Set password

### Export to Neo4j
```bash
cd /path/to/your/repo
NEO4J_PASSWORD="password" \
node /path/to/codegraph-mcp/export-to-neo4j.js .
```

### Explore in Neo4j Browser
Open http://localhost:7474 and try these queries:

```cypher
// View all classes
MATCH (n:Class) RETURN n LIMIT 50

// Find call chains
MATCH path=(a:Method)-[:CALLS*1..3]->(b:Method)
RETURN path LIMIT 25

// DI registrations (interface → implementation)
MATCH (i:Interface)<-[:REGISTERS]-(impl)
RETURN i, impl

// Dead code (no incoming references)
MATCH (n:Method)
WHERE NOT ()-[:CALLS]->(n)
RETURN n.name, n.path

// Blast radius from a specific method
MATCH path=(caller)-[:CALLS*1..3]->(target:Method {name: 'Authenticate'})
RETURN path
```

## Database Access with Beekeeper Studio

To browse the SQLite database directly:

1. Install [Beekeeper Studio](https://www.beekeeperstudio.io/)
2. **File** → **New Connection**
3. **Connection Type**: SQLite
4. **Database File**: `/path/to/your/repo/.repo-index/index.db`
5. **Connect**

### Useful Queries

```sql
-- Count nodes by type
SELECT kind, COUNT(*)
FROM nodes
GROUP BY kind;

-- Count edges by type
SELECT kind, COUNT(*)
FROM edges
GROUP BY kind;

-- Find methods with most callers
SELECT n.name, n.path, COUNT(e.src_id) as caller_count
FROM nodes n
JOIN edges e ON e.dst_id = n.id AND e.kind = 'calls'
WHERE n.kind = 'method'
GROUP BY n.id
ORDER BY caller_count DESC
LIMIT 20;

-- Find classes with no callers (potential dead code)
SELECT n.name, n.path
FROM nodes n
WHERE n.kind = 'class'
  AND NOT EXISTS (
    SELECT 1 FROM edges e WHERE e.dst_id = n.id
  );

-- View embedding statistics
SELECT
  COUNT(*) as total_chunks,
  AVG(LENGTH(text)) as avg_chunk_size,
  SUM(LENGTH(embedding)) / COUNT(*) as avg_embedding_size
FROM chunks;
```

## Nightly Refresh (Incremental Updates)

Set up automated indexing to keep your index fresh:

### Manual Refresh

**Graph-Only Mode**:
```bash
cd /path/to/your/repo
GRAPH_ONLY=true /path/to/codegraph-mcp/nightly-refresh.sh
```

**Full Mode**:
```bash
cd /path/to/your/repo
/path/to/codegraph-mcp/nightly-refresh.sh
```

### Automated (Cron - macOS/Linux)
```bash
crontab -e
# Add line (runs daily at 2 AM):
0 2 * * * /path/to/your/repo/nightly-refresh-index.sh >> /path/to/your/repo/.repo-index/refresh.log 2>&1
```

The indexer automatically:
1. Fetches latest git changes
2. Identifies modified files since last index
3. Only re-indexes changed files
4. Preserves existing embeddings for unchanged code

## Project Layout

```
codegraph-mcp/
├── schema.sql                # Database schema (graph + vectors)
├── SCHEMA.md                  # Design rationale
├── src/
│   ├── db.js                  # SQLite connection
│   ├── indexer.js             # Main indexing engine
│   ├── graph.js               # Call graph queries
│   ├── search.js              # Vector similarity search
│   ├── embeddings.js          # Embedding provider abstraction
│   ├── mcpServer.js           # MCP protocol server
│   └── extractors/
│       ├── csharp.js          # C# symbol extraction
│       ├── angular.js         # TypeScript/Angular extraction
│       └── yaml.js            # YAML pipeline extraction
├── export-to-neo4j.js         # Neo4j export utility
├── nightly-refresh.sh         # Incremental update script
└── .vscode-mcp-example.json   # MCP config template
```

## Language Support

### C# (.cs)
- **Nodes**: Classes, interfaces, records, structs, methods, functions
- **Edges**:
  - `calls`: Method invocations
  - `implements`: Interface/base class relationships
  - `injects`: Constructor/primary constructor DI
  - `registers`: DI container registrations (`AddScoped<I, Impl>()`)
- **Features**: C# 12 primary constructors, expression-bodied members

### TypeScript/Angular (.ts, .tsx, .js, .jsx)
- **Nodes**: Classes (by decorator: `@Component`, `@Injectable`, `@NgModule`, `@Directive`, `@Pipe`)
- **Edges**:
  - `calls`: Method invocations
  - `injects`: Constructor parameter DI
  - `imports`: Relative import statements
- **Limitations**: Template files (`.html`) not yet indexed

### YAML (.yml, .yaml)
- **Nodes**: Azure DevOps stages/jobs, GitHub Actions, k8s resources, docker-compose services
- **Edges**: None (structural only)
- **Features**: Templated YAML skipped structurally but embedded for semantic search

## Performance Optimizations

### Parallel Embedding Processing
The indexer processes embeddings in batches of 10 concurrent requests:
- **Sequential**: ~1,100 chunks/hour
- **Parallel (10x)**: ~2,800 chunks/hour
- **Speedup**: 2.5x faster

### Content Hashing
Only generates new embeddings for changed code:
```javascript
const hash = sha256(chunk.text);
const existing = db.prepare(
  `SELECT id FROM chunks WHERE node_id = ? AND content_hash = ?`
).get(chunk.nodeId, hash);
if (!existing) {
  chunksToEmbed.push({ ...chunk, hash });
}
```

### Incremental Git Diff
```javascript
const diff = getChangedFiles(lastCommit);
targets = diff.filter(d => EXT_LANG[path.extname(d.filePath)]);
```

## Known Limitations & Future Improvements

### Current Simplifications
- **Regex-based extraction**: For production, replace with:
  - C#: Roslyn analyzer (`Microsoft.CodeAnalysis.CSharp`)
  - TypeScript: ts-morph or tree-sitter
  - Benefit: 100% accuracy vs ~95% with regex

- **Brute-force vector search**: Fine for <50K chunks. For larger repos:
  - Use `sqlite-vec`, Qdrant, or pgvector
  - Implement ANN (Approximate Nearest Neighbor) index

- **Angular templates**: HTML templates not indexed
  - Missing: `(click)="handler()"` → call edges

- **Non-generic DI**: Only `AddScoped<I, Impl>()` supported
  - Missing: `AddScoped(typeof(I), typeof(Impl))`

### Planned Features
- [ ] Multi-repo indexing (monorepo support)
- [ ] Python extractor
- [ ] Java/Kotlin extractor
- [ ] Workspace-wide refactoring suggestions
- [ ] Code smell detection via graph patterns
- [ ] Historical analysis (code churn, hotspots)

## Troubleshooting

### MCP Server Not Connecting
1. Check `.vscode/mcp.json` path is absolute
2. Reload VS Code: `Cmd+Shift+P` → "Developer: Reload Window"
3. Check Output panel: `View` → `Output` → Select "MCP: repo-index"

### Ollama Embedding Errors
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Verify model is installed
ollama list

# Re-pull if needed
ollama pull qwen3-embedding
```

### Slow Indexing
- **Graph only**: Disable embeddings temporarily (comment lines 159-199 in indexer.js)
- **Parallel batching**: Increase `PARALLEL_BATCH_SIZE` in indexer.js (default: 10)
- **Smaller model**: Use faster embedding models (lower dimensions)

### Database Locked Errors
SQLite doesn't support concurrent writes. If running multiple indexers:
1. Wait for current indexing to complete
2. Use file locking wrapper
3. Run indexers sequentially

### Neo4j Docker Issues
```bash
# Check if Neo4j container is running
docker ps | grep neo4j

# View Neo4j logs
docker logs neo4j-codegraph

# Restart Neo4j
docker restart neo4j-codegraph

# Remove and recreate (clears data!)
docker rm -f neo4j-codegraph
docker run -d \
  --name neo4j-codegraph \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest
```

## Contributing

Contributions welcome! Priority areas:
1. Language extractors (Python, Java, Go, Rust)
2. ANN vector index integration
3. Roslyn/ts-morph replacement for regex parsers
4. Performance optimizations

## License

MIT License - See LICENSE file

## Name Suggestions

**CodeGraph MCP** - Current working name, emphasizes the graph + MCP integration

Alternative names to consider:
- **RepoMind MCP** - AI-powered repository knowledge
- **CodeIndex Pro** - Professional code intelligence
- **GraphCode MCP** - Graph-based code understanding
- **CodeAtlas MCP** - Maps your entire codebase
- **DevGraph** - Developer-focused graph database
- **RepoGraph AI** - AI-powered repository graphing

---

**Built for developers who want to understand their codebase deeply, not just search it superficially.**
