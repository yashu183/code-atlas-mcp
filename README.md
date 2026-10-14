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
| **Graph-Only** | ~3 minutes | `get_call_graph`, `get_related_files`, `get_blast_radius_from_changes` (auto-visualizes in Neo4j) | Fast dependency analysis, impact analysis, no embedding setup needed |
| **Full (Graph + Embeddings)** | ~2-2.5 hours | `search_code`, `get_call_graph`, `get_related_files`, `get_blast_radius_from_changes` (auto-visualizes in Neo4j) | Semantic code search + dependency analysis + impact analysis |

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

**Available Tools**: `get_call_graph`, `get_related_files`, `get_blast_radius_from_changes` (auto-visualizes in Neo4j)

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

**Available Tools**: `search_code`, `get_call_graph`, `get_related_files`, `get_blast_radius_from_changes` (auto-visualizes in Neo4j)

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

#### 2. `get_call_graph` - Dependency Analysis (hypothetical / pre-change)
Understand what calls what, and blast radius analysis — computed from the current indexed codebase, no git changes required. This is the tool for "what would be affected **if** I change X" questions asked *before* you've actually made the edit.

**Example queries**:
```
What's the blast radius for AuthenticationHelper?
Show me what depends on MarginController
What does UserService call?
Find all callers of ValidateToken method
If I change the authentication, what will be affected?
```

#### 3. `get_related_files` - Discover Connected Code
Find files related through call edges.

**Example queries**:
```
What files are related to Program.cs?
Show me files connected to this service
```

#### 4. `get_blast_radius_from_changes` - Impact Analysis *(auto-visualized)*
Analyze the blast radius of code changes that **already exist** (staged, all local uncommitted, or recent commits — read via `git diff`) for commit validation, release planning, and QA acceptance criteria. For a hypothetical "what if I change X" question before any edit exists, use `get_call_graph` instead.

Every call **automatically exports the result to Neo4j** as well — a JSON summary alone isn't much use if you can't actually see it, so there's no separate "export" step to remember. Nodes are color-coded (🔴 changed, 🟠 blast radius, ⚪ unchanged) and a ready-to-import `.repo-index/blast-radius-style.grass` stylesheet is (re)generated on every run. If Neo4j isn't reachable, the export is skipped gracefully — the text/JSON analysis is still returned in full, with a `neo4jExport.error` + troubleshooting hint instead of a graph.

**Availability**: Works in both Graph-Only and Full modes (Neo4j is optional — only needed for the visualization part)

**Example queries**:
```
What's the blast radius of my staged changes?
Show me the impact of all my local changes
What did the last 3 commits affect?
Analyze the blast radius of my uncommitted work with depth 5
Visualize the blast radius of the last 3 commits in Neo4j
```

**Modes**:
- `staged`: Analyze only staged changes (before committing)
- `all`: Analyze all local changes (staged + unstaged)
- `commits`: Analyze last N commits (max 10, for release planning)

**Use Cases**:
- **Before committing**: "What will my staged changes affect?"
- **Release planning**: "What's the impact of the last 5 commits?"
- **QA acceptance criteria**: "Show me all code affected by recent changes" — share the Neo4j view directly
- **Quick dev check**: "What's the blast radius of my work?"
- **Stakeholder demos**: point them at the auto-generated Neo4j graph instead of a JSON blob

### Best Practices for Copilot Queries

**Good (Natural language - Copilot chooses the right tool)**:
```
What's the impact of changing the authorization middleware?
Find all implementations of IRepository pattern
Show me error handling across the codebase
What will my staged changes affect?
```

**Better (Explicit tool usage for specific analysis)**:
```
Use get_call_graph to analyze the blast radius of AuthHelper with depth 3
Use search_code to find margin calculation patterns
Use get_blast_radius_from_changes with mode=staged to show impact of my changes
Use get_blast_radius_from_changes with mode=commits and commits=5 for release planning
```

### Intelligent Blast Radius Queries via MCP

Once MCP is configured, your coding assistant can **intelligently query blast radius** without leaving the editor:

**In VS Code Copilot Chat:**
```
You: What's the blast radius of my staged changes?
Copilot: [Uses get_blast_radius_from_changes with mode=staged]
         Your staged changes affect:
         - 3 files changed
         - 8 nodes modified (5 methods, 3 classes)
         - 23 dependent nodes in blast radius
         - Total impact: 31 nodes across 12 files

         Key dependencies affected:
         - UserController.GetUser (2 hops away)
         - AuthenticationMiddleware.Invoke (1 hop away)
         ...

You: What about the last 3 commits?
Copilot: [Uses get_blast_radius_from_changes with mode=commits, commits=3]
         Last 3 commits affect:
         - 7 files changed
         - 15 nodes modified
         - 45 dependent nodes
         - Total nodes exported to Neo4j: 1,234

         🎨 Visualized automatically — style file: .repo-index/blast-radius-style.grass
         📖 Open http://localhost:7474, import the .grass file once, then run the
             provided query to see red (changed) / orange (blast radius) nodes.
         ...

You: If I change the authentication, what will be affected?
Copilot: [No changes exist yet, so it uses get_call_graph on the auth symbol instead]
         AuthenticationMiddleware.Invoke is called by:
         - 12 controllers (1 hop)
         - 3 background jobs (2 hops)
         ...
```

**No need for manual commands!** Just ask naturally, and Copilot will:
1. Choose the right tool — `get_call_graph` for hypothetical/pre-change questions, `get_blast_radius_from_changes` once real changes exist
2. Select appropriate parameters (mode, commits, depth)
3. Parse the results and present them clearly
4. See the Neo4j graph that `get_blast_radius_from_changes` exports automatically — no separate export step

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

## Blast Radius Analysis

**Analyze and visualize the impact of your code changes before committing, releasing, or for QA planning.**

Available in **two modes**:
1. **MCP Tool** (recommended): Query intelligently via your coding assistant
2. **CLI + Neo4j Visualization**: Export visual graph with highlighted changes

### Mode 1: Intelligent MCP Queries (Recommended)

Once MCP is configured, ask your coding assistant naturally:

```
You: What's the blast radius of my staged changes?
You: Show me the impact of the last 3 commits
You: What will my uncommitted work affect with depth 5?
```

Your assistant will use the `get_blast_radius_from_changes` tool and present results instantly - **no manual commands needed!**

**Use Cases**:
1. **Before Committing**: "What will my staged changes affect?"
2. **Release Planning**: "What's the impact of the last 5 commits?"
3. **QA Acceptance Criteria**: "Show all code affected by recent changes"
4. **Quick Dev Check**: "What's the blast radius of my work?"

### Mode 2: CLI + Neo4j Visualization

For visual graph exploration, use the standalone CLI tool that exports to Neo4j with highlighting:
- **Red nodes**: Your changed files
- **Orange nodes**: Dependencies (blast radius)

### Usage

```bash
cd /path/to/your/repo

# Staged changes only (before commit)
node /path/to/codegraph-mcp/blast-radius.js --staged

# All local changes (staged + unstaged)
node /path/to/codegraph-mcp/blast-radius.js --all

# Last 3 commits (release planning)
node /path/to/codegraph-mcp/blast-radius.js --commits 3

# Custom depth for deeper dependency analysis
node /path/to/codegraph-mcp/blast-radius.js --commits 1 --depth 5
```

### Output Example

```
 Blast Radius Analysis
Mode: staged
Depth: 3 hops

 Changed files (2):
  - src/Services/AuthService.cs
  - src/Controllers/UserController.cs

 Changed nodes (5):
  - AuthService (class) in src/Services/AuthService.cs:10
  - ValidateToken (method) in src/Services/AuthService.cs:25
  - UserController (class) in src/Controllers/UserController.cs:8
  - GetUser (method) in src/Controllers/UserController.cs:15
  - UpdateUser (method) in src/Controllers/UserController.cs:45

 Blast radius: 23 dependent nodes

 Exporting to Neo4j...
✓ Style file saved to: .repo-index/blast-radius-style.grass
 Export complete!
```

### Viewing the Graph with Automatic Colors

**Step 1: Import Styling (One-time setup)**

The blast radius tool automatically generates a `.grass` (Graph Stylesheet) file with color rules. Import it once:

1. Open http://localhost:7474
2. Click the **⚙️ Settings icon** (bottom left)
3. Select **"Graph Stylesheet"**
4. **Drag and drop** `.repo-index/blast-radius-style.grass` into the panel
   - Or copy/paste the file contents manually
5. Colors apply automatically!

**Step 2: Run Query**

```cypher
MATCH (n:Node)
WHERE n.changed = true OR n.blast_radius = true
OPTIONAL MATCH (n)-[r]-(connected)
WHERE connected.changed = true OR connected.blast_radius = true
RETURN n, r, connected
```

**Colors will automatically display:**
- 🔴 **Red** = Changed nodes (your modifications)
- 🟠 **Orange** = Blast radius (affected dependencies)
- ⚪ **Gray** = Unchanged nodes

**Alternative - View All Nodes:**
```cypher
MATCH (n:Node)
RETURN n
LIMIT 1000
```
The `.grass` file uses the `color` property, so all nodes will be properly colored!

### Which Mode to Use?

**Use MCP Tool (Mode 1) when:**
- You want quick answers without leaving your editor
- You're in active development and need fast feedback
- You want to paste results into docs/PRs/tickets
- You need structured data for further analysis

**Use CLI + Neo4j (Mode 2) when:**
- You want visual graph exploration
- You're presenting to stakeholders (visual is more impactful)
- You need to share screenshots with QA
- You want to explore complex dependency chains visually

### Pro Tips

- **Before commit**: Ask Copilot "What's the blast radius of my staged changes?" or use `--staged`
- **Before push**: Use MCP with `mode=all` or CLI `--all` to see complete local impact
- **Release planning**: Use `--commits 5` to analyze scope of last sprint
- **Share with QA**: Export Neo4j visualization to help define acceptance criteria
- **Performance**: Adjust `--depth` based on codebase size (default: 3 hops)

## Graph Visualization with Neo4j

Export your complete SQLite graph to Neo4j for visual exploration:

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
├── blast-radius.js            # Blast radius visualization tool
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
