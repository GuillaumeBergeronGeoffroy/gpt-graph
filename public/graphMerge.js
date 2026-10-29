// Three-way graph merge for saves.
// When the server copy changed since this tab last synced (a Claude task or a council
// seat merged into it), replay this tab's own edits onto the server copy instead of
// overwriting it. "Own edits" are the differences between the copy this tab started
// from (the base snapshot) and what it has now.

function graphRelKey(r) {
  const end = (ref) => (ref && typeof ref === "object" ? ref.id : ref);
  return `${end(r.startNodeId ?? r.source)}|${end(r.endNodeId ?? r.target)}|${r.type}`;
}

// What the server had when this tab last loaded or saved, frozen against D3's mutations
function snapshotGraph(graph) {
  return {
    nodes: new Map((graph.nodes || []).map((n) => [n.id, JSON.stringify(n)])),
    rels: new Set((graph.relationships || []).map(graphRelKey)),
  };
}

function graphNodeName(n) {
  return String(n.properties?.name ?? n.name ?? "").toLowerCase();
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
}

function rebaseGraph(base, local, server) {
  const result = {
    nodes: (server.nodes || []).map((n) => ({ ...n, properties: { ...(n.properties || {}) } })),
    relationships: (server.relationships || []).map((r) => ({ ...r })),
  };
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const byName = new Map(result.nodes.map((n) => [graphNodeName(n), n]));
  const numeric = (ids) => ids.filter((id) => typeof id === "number");
  let nextNodeId = Math.max(0, ...numeric(result.nodes.map((n) => n.id))) + 1;
  let nextRelId = Math.max(0, ...numeric(result.relationships.map((r) => r.id))) + 1;
  const idMap = new Map(); // this tab's new node id -> id in the result
  const localIds = new Set();

  for (const node of local.nodes || []) {
    localIds.add(node.id);
    const baseJson = base.nodes.get(node.id);
    if (baseJson) {
      // Edited here: apply only the fields this tab changed, so the server's other changes stay
      const target = byId.get(node.id);
      if (!target) continue; // deleted on the server since: it stays deleted
      const before = JSON.parse(baseJson);
      for (const key of changedKeys(before, node)) {
        if (key === "id" || key === "properties") continue;
        if (key in node) target[key] = node[key];
        else delete target[key];
      }
      for (const key of changedKeys(before.properties, node.properties)) {
        if (node.properties && key in node.properties) target.properties[key] = node.properties[key];
        else delete target.properties[key];
      }
      continue;
    }
    // New here. The same name arriving from the server too is one node, not two
    const twin = byName.get(graphNodeName(node));
    if (twin && graphNodeName(node)) {
      idMap.set(node.id, twin.id);
      Object.assign(twin.properties, node.properties || {});
      continue;
    }
    const added = { ...node, id: nextNodeId++, properties: { ...(node.properties || {}) } };
    idMap.set(node.id, added.id);
    result.nodes.push(added);
    byId.set(added.id, added);
    byName.set(graphNodeName(added), added);
  }

  // Nodes this tab deleted
  const deleted = new Set([...base.nodes.keys()].filter((id) => !localIds.has(id)));
  result.nodes = result.nodes.filter((n) => !deleted.has(n.id));

  // Relationships this tab added or deleted
  const resolve = (ref) => {
    const id = ref && typeof ref === "object" ? ref.id : ref;
    return idMap.has(id) ? idMap.get(id) : id;
  };
  const localKeys = new Set();
  const resultKeys = new Set(result.relationships.map(graphRelKey));
  for (const r of local.relationships || []) {
    const key = graphRelKey(r);
    localKeys.add(key);
    if (base.rels.has(key)) continue; // unchanged here (if the server dropped it, it stays dropped)
    const start = resolve(r.startNodeId ?? r.source);
    const end = resolve(r.endNodeId ?? r.target);
    const newKey = `${start}|${end}|${r.type}`;
    if (!byId.has(start) || !byId.has(end) || deleted.has(start) || deleted.has(end)) continue;
    if (resultKeys.has(newKey)) continue;
    result.relationships.push({
      id: nextRelId++,
      startNodeId: start,
      endNodeId: end,
      type: r.type,
      properties: { ...(r.properties || {}) },
    });
    resultKeys.add(newKey);
  }
  result.relationships = result.relationships.filter((r) => {
    const key = graphRelKey(r);
    if (base.rels.has(key) && !localKeys.has(key)) return false;
    return !deleted.has(r.startNodeId) && !deleted.has(r.endNodeId);
  });

  return result;
}

if (typeof module !== "undefined") {
  module.exports = { graphRelKey, snapshotGraph, rebaseGraph };
}
