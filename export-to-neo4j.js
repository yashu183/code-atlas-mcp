// Export SQLite graph to Neo4j for visualization
// Usage: node export-to-neo4j.js [repo-path]
// Example: node export-to-neo4j.js /Users/yashu/Yashu/workspace/<folder_of_the_project>

import neo4j from 'neo4j-driver';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

async function exportToNeo4j() {
  // Get repo path from command line arg or use current directory
  const repoPath = process.argv[2] || process.cwd();
  const dbPath = path.join(repoPath, '.repo-index', 'index.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database not found at: ${dbPath}`);
    console.error('Please provide the repo path as an argument:');
    console.error('  node export-to-neo4j.js /path/to/repo');
    process.exit(1);
  }

  console.log(`Reading SQLite database from: ${dbPath}`);
  const sqliteDb = new Database(dbPath, { readonly: true });

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session({ database: NEO4J_DATABASE });

  try {
    console.log('Connecting to Neo4j...');

    // Clear existing data
    console.log('Clearing existing graph...');
    await session.run('MATCH (n) DETACH DELETE n');

    // Create indexes for performance
    console.log('Creating indexes...');
    await session.run('CREATE INDEX node_id_idx IF NOT EXISTS FOR (n:Node) ON (n.sqlite_id)');

    // Export nodes
    console.log('Exporting nodes...');
    const nodes = sqliteDb.prepare(`
      SELECT id, repo, path, kind, name, qualified_name, start_line, end_line
      FROM nodes
    `).all();

    let nodeCount = 0;
    for (const node of nodes) {
      const label = node.kind.charAt(0).toUpperCase() + node.kind.slice(1); // class -> Class
      await session.run(`
        CREATE (n:Node:${label} {
          sqlite_id: $id,
          repo: $repo,
          path: $path,
          kind: $kind,
          name: $name,
          qualified_name: $qualified_name,
          start_line: $start_line,
          end_line: $end_line
        })
      `, {
        id: neo4j.int(node.id),
        repo: node.repo,
        path: node.path,
        kind: node.kind,
        name: node.name,
        qualified_name: node.qualified_name,
        start_line: neo4j.int(node.start_line),
        end_line: neo4j.int(node.end_line)
      });

      nodeCount++;
      if (nodeCount % 100 === 0) {
        console.log(`  ${nodeCount} nodes exported...`);
      }
    }
    console.log(`✓ ${nodeCount} nodes exported`);

    // Export edges
    console.log('Exporting edges...');
    const edges = sqliteDb.prepare(`
      SELECT src_id, dst_id, kind, dst_ref
      FROM edges
      WHERE dst_id IS NOT NULL
    `).all();

    let edgeCount = 0;
    for (const edge of edges) {
      const relType = edge.kind.toUpperCase(); // calls -> CALLS
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
        console.log(`  ${edgeCount} edges exported...`);
      }
    }
    console.log(`✓ ${edgeCount} edges exported`);

    console.log('\n✅ Export complete!');
    console.log(`\n📊 Database: ${NEO4J_DATABASE}`);
    console.log(`🌐 Open Neo4j Browser at http://localhost:7474`);
    console.log(`   (Make sure to select database "${NEO4J_DATABASE}" in the browser)`);
    console.log('\n💡 Try these queries:');
    console.log('  - View all classes: MATCH (n:Class) RETURN n LIMIT 50');
    console.log('  - Find call chains: MATCH path=(a:Method)-[:CALLS*1..3]->(b:Method) RETURN path LIMIT 25');
    console.log('  - DI registrations: MATCH (i:Interface)<-[:REGISTERS]-(impl) RETURN i, impl');

  } catch (error) {
    console.error('Export failed:', error);
  } finally {
    await session.close();
    await driver.close();
    sqliteDb.close();
  }
}

exportToNeo4j().catch(console.error);
