// Blast Radius Visualization Tool
// Visualize the impact of code changes on the dependency graph
//
// Usage:
//   node blast-radius.js --staged              # Staged changes only
//   node blast-radius.js --all                 # All local changes (staged + unstaged)
//   node blast-radius.js --commits 5           # Last 5 commits (max 10)
//   node blast-radius.js --commits 5 --depth 3 # With custom blast radius depth

import { execSync } from "node:child_process";
import neo4j from 'neo4j-driver';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    mode: null,
    commits: 1,
    depth: 3, // Default blast radius depth
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--staged') {
      config.mode = 'staged';
    } else if (arg === '--all') {
      config.mode = 'all';
    } else if (arg === '--commits') {
      config.mode = 'commits';
      const n = parseInt(args[++i], 10);
      config.commits = Math.min(Math.max(1, n), 10); // Clamp to 1-10
    } else if (arg === '--depth') {
      config.depth = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!config.mode) {
    console.error('❌ Error: No mode specified\n');
    printHelp();
    process.exit(1);
  }

  return config;
}

function printHelp() {
  console.log(`
Blast Radius Visualization Tool
Visualize the impact of code changes on the dependency graph

Usage:
  node blast-radius.js [MODE] [OPTIONS]

Modes (choose one):
  --staged              Show blast radius for staged changes only
  --all                 Show blast radius for all local changes (staged + unstaged)
  --commits N           Show blast radius for last N commits (max 10)

Options:
  --depth N             Set blast radius depth (default: 3)
  --help, -h            Show this help message

Examples:
  # Visualize staged changes before committing
  node blast-radius.js --staged

  # Check all uncommitted changes
  node blast-radius.js --all

  # Analyze last 3 commits for release planning
  node blast-radius.js --commits 3

  # QA acceptance criteria for last commit with deeper analysis
  node blast-radius.js --commits 1 --depth 5

Environment Variables:
  NEO4J_URI             Neo4j connection URI (default: bolt://localhost:7687)
  NEO4J_USER            Neo4j username (default: neo4j)
  NEO4J_PASSWORD        Neo4j password (default: password)
  NEO4J_DATABASE        Neo4j database name (default: neo4j)

Output:
  - Exports graph to Neo4j with changed files highlighted in red
  - Shows blast radius (dependent nodes) in the visualization
  - Open http://localhost:7474 to view the graph
`);
}

// Get changed files based on mode
function getChangedFiles(mode, commits = 1) {
  const repoRoot = process.cwd();
  let changedFiles = [];

  try {
    if (mode === 'staged') {
      // Staged changes only
      const output = execSync('git diff --cached --name-only', { cwd: repoRoot }).toString().trim();
      changedFiles = output ? output.split('\n') : [];
    } else if (mode === 'all') {
      // All local changes (staged + unstaged)
      const output = execSync('git diff HEAD --name-only', { cwd: repoRoot }).toString().trim();
      changedFiles = output ? output.split('\n') : [];
    } else if (mode === 'commits') {
      // Last N NON-MERGE commits. `git log --no-merges` (not `git diff
      // HEAD~N HEAD`) so a merge commit sitting in that range doesn't (a)
      // eat one of the N slots for a commit that isn't "your work", and
      // (b) pull in every file the merged branch touched.
      const output = execSync(
        `git log --no-merges -n ${commits} --name-only --pretty=format:`,
        { cwd: repoRoot }
      ).toString().trim();
      changedFiles = output ? [...new Set(output.split('\n').filter(Boolean))] : [];
    }
  } catch (error) {
    console.error(`❌ Failed to get changed files: ${error.message}`);
    process.exit(1);
  }

  return changedFiles;
}

// Calculate blast radius for a set of node IDs
function calculateBlastRadius(db, nodeIds, depth = 3) {
  const visited = new Set(nodeIds);
  const blastRadiusNodes = new Set();
  let frontier = [...nodeIds];

  for (let d = 0; d < depth; d++) {
    const next = [];

    for (const id of frontier) {
      // Get all callers (nodes that depend on this node)
      const callers = db.prepare(`
        SELECT DISTINCT n.id, n.qualified_name, n.path, n.kind, n.name, n.start_line, n.end_line
        FROM edges e
        JOIN nodes n ON n.id = e.src_id
        WHERE e.dst_id = ?
      `).all(id);

      for (const caller of callers) {
        blastRadiusNodes.add(caller.id);
        if (!visited.has(caller.id)) {
          visited.add(caller.id);
          next.push(caller.id);
        }
      }
    }

    frontier = next;
    if (frontier.length === 0) break;
  }

  return Array.from(blastRadiusNodes);
}

async function visualizeBlastRadius(config) {
  const repoRoot = process.cwd();
  const dbPath = path.join(repoRoot, '.repo-index', 'index.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    console.error('Please run the indexer first:');
    console.error('  GRAPH_ONLY=true node /path/to/repo-index-mcp/src/indexer.js');
    process.exit(1);
  }

  console.log(`\n Blast Radius Analysis`);
  console.log(`Mode: ${config.mode}`);
  if (config.mode === 'commits') {
    console.log(`Commits: Last ${config.commits}`);
  }
  console.log(`Depth: ${config.depth} hops\n`);

  // Get changed files
  const changedFiles = getChangedFiles(config.mode, config.commits);

  if (changedFiles.length === 0) {
    console.log('✓ No changes detected');
    process.exit(0);
  }

  console.log(`Changed files (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`  - ${f}`));
  console.log();

  // Open SQLite database
  const sqliteDb = new Database(dbPath, { readonly: true });

  // Find nodes in changed files
  const changedNodes = [];
  for (const filePath of changedFiles) {
    const nodes = sqliteDb.prepare(`
      SELECT id, qualified_name, path, kind, name, start_line, end_line
      FROM nodes
      WHERE path = ? AND kind != 'file'
    `).all(filePath);
    changedNodes.push(...nodes);
  }

  if (changedNodes.length === 0) {
    console.log('No indexed nodes found in changed files');
    console.log('Tip: Make sure the indexer has run on this repository');
    sqliteDb.close();
    process.exit(0);
  }

  console.log(`Changed nodes (${changedNodes.length}):`);
  changedNodes.forEach(n => console.log(`  - ${n.qualified_name} (${n.kind}) in ${n.path}:${n.start_line}`));
  console.log();

  // Calculate blast radius
  const changedNodeIds = changedNodes.map(n => n.id);
  const blastRadiusIds = calculateBlastRadius(sqliteDb, changedNodeIds, config.depth);

  console.log(`Blast radius: ${blastRadiusIds.length} dependent nodes\n`);

  // Export to Neo4j
  console.log('Exporting to Neo4j...');
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session({ database: NEO4J_DATABASE });

  try {
    // Clear existing data
    console.log('Clearing existing graph...');
    await session.run('MATCH (n) DETACH DELETE n');

    // Create indexes
    console.log('Creating indexes...');
    await session.run('CREATE INDEX node_id_idx IF NOT EXISTS FOR (n:Node) ON (n.sqlite_id)');

    // Export all nodes with change markers
    console.log('Exporting nodes...');
    const allNodes = sqliteDb.prepare(`
      SELECT id, repo, path, kind, name, qualified_name, start_line, end_line
      FROM nodes
    `).all();

    const changedNodeIdSet = new Set(changedNodeIds);
    const blastRadiusIdSet = new Set(blastRadiusIds);

    let nodeCount = 0;
    for (const node of allNodes) {
      const label = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);
      const isChanged = changedNodeIdSet.has(node.id);
      const isInBlastRadius = blastRadiusIdSet.has(node.id);

      // Determine visual color based on change status
      let color = '#9CA3AF'; // Gray for unchanged nodes
      if (isChanged) {
        color = '#EF4444'; // Red for changed nodes
      } else if (isInBlastRadius) {
        color = '#F97316'; // Orange for blast radius nodes
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

      nodeCount++;
      if (nodeCount % 100 === 0) {
        console.log(`${nodeCount} nodes exported...`);
      }
    }
    console.log(`${nodeCount} nodes exported`);

    // Export edges
    console.log('Exporting edges...');
    const edges = sqliteDb.prepare(`
      SELECT src_id, dst_id, kind
      FROM edges
      WHERE dst_id IS NOT NULL
    `).all();

    let edgeCount = 0;
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

      edgeCount++;
      if (edgeCount % 100 === 0) {
        console.log(`${edgeCount} edges exported...`);
      }
    }
    console.log(`${edgeCount} edges exported\n`);

    // Generate and save .grass style file
    console.log('Generating Neo4j style file...');
    const grassContent = generateGrassFile();
    const grassPath = path.join(repoRoot, '.repo-index', 'blast-radius-style.grass');
    fs.writeFileSync(grassPath, grassContent, 'utf8');
    console.log(`✓ Style file saved to: ${grassPath}\n`);

    console.log('Export complete!\n');
    console.log('VISUALIZATION GUIDE');
    console.log('Step 1: Open Neo4j Browser');
    console.log('  → http://localhost:7474');
    console.log(`  → Database: "${NEO4J_DATABASE}"\n`);

    console.log('Step 2: Import Automatic Styling (RECOMMENDED) 🎨\n');
    console.log('  Option A - Drag & Drop:');
    console.log('    1. Click the ⚙️  icon (bottom left) → "Graph Stylesheet"');
    console.log('    2. Drag this file into the panel:');
    console.log(`       ${grassPath}`);
    console.log('    3. Colors will apply automatically!\n');

    console.log('  Option B - Manual Paste:');
    console.log('    1. Click the ⚙️  icon (bottom left) → "Graph Stylesheet"');
    console.log('    2. Open the .grass file and copy all content');
    console.log('    3. Paste into the text area');
    console.log('    4. Click outside to apply\n');

    console.log('Step 3: Run this query to see the blast radius:\n');
    console.log('  MATCH (n:Node)');
    console.log('  WHERE n.changed = true OR n.blast_radius = true');
    console.log('  OPTIONAL MATCH (n)-[r]-(connected)');
    console.log('  WHERE connected.changed = true OR connected.blast_radius = true');
    console.log('  RETURN n, r, connected\n');

    console.log('Alternative - View all nodes with automatic colors:\n');
    console.log('  MATCH (n:Node)');
    console.log('  RETURN n');
    console.log('  LIMIT 1000\n');

    console.log('Color Legend (Auto-applied with .grass file):');
    console.log('  🔴 Red (#EF4444)    = Changed nodes (your modifications)');
    console.log('  🟠 Orange (#F97316) = Blast radius (affected dependencies)');
    console.log('  ⚪ Gray (#9CA3AF)   = Unchanged nodes\n');

    console.log('Pro Tips:');
    console.log('  • The .grass file applies colors automatically - no manual config!');
    console.log('  • Run "--staged" before committing to understand impact');
    console.log('  • Use "--commits N" for release planning');
    console.log('  • Share Neo4j screenshots with QA for acceptance criteria');
    console.log('  • Adjust "--depth" to see deeper dependency chains');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Export failed:', error);
  } finally {
    await session.close();
    await driver.close();
    sqliteDb.close();
  }
}

// Main execution
const config = parseArgs();
visualizeBlastRadius(config).catch(console.error);
