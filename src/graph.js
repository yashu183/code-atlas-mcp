// Graph traversal helpers: callers, callees, blast radius.

export function findNodeByQualifiedName(db, qualifiedName) {
  return db
    .prepare(`SELECT * FROM nodes WHERE qualified_name = ? OR name = ? LIMIT 1`)
    .get(qualifiedName, qualifiedName);
}

export function getCallees(db, nodeId) {
  return db
    .prepare(
      `SELECT e.kind, n.qualified_name AS target, n.path, n.start_line, n.end_line, e.dst_ref
       FROM edges e LEFT JOIN nodes n ON n.id = e.dst_id
       WHERE e.src_id = ?`
    )
    .all(nodeId);
}

export function getCallers(db, nodeId) {
  return db
    .prepare(
      `SELECT n.qualified_name AS caller, n.path, n.start_line, n.end_line
       FROM edges e JOIN nodes n ON n.id = e.src_id
       WHERE e.dst_id = ?`
    )
    .all(nodeId);
}

/** Breadth-first blast radius: everything within `depth` hops of callers. */
export function getBlastRadius(db, nodeId, depth = 2) {
  const visited = new Set([nodeId]);
  let frontier = [nodeId];
  const result = [];

  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const id of frontier) {
      const callers = getCallers(db, id);
      for (const c of callers) {
        result.push({ ...c, hops: d + 1 });
      }
    }
    // re-fetch ids of those callers for next hop
    const callerRows = frontier.flatMap((id) => getCallers(db, id));
    for (const row of callerRows) {
      const node = db.prepare(`SELECT id FROM nodes WHERE qualified_name = ?`).get(row.caller);
      if (node && !visited.has(node.id)) {
        visited.add(node.id);
        next.push(node.id);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return result;
}
