// Run: node --test tests/test_graph_merge.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { snapshotGraph, rebaseGraph } = require("../public/graphMerge.js");

const node = (id, name, props = {}) => ({ id, labels: ["Concept"], properties: { name, ...props } });
const rel = (id, startNodeId, endNodeId, type = "AFFECTS") => ({ id, startNodeId, endNodeId, type, properties: {} });
const clone = (x) => JSON.parse(JSON.stringify(x));
const names = (g) => g.nodes.map((n) => n.properties.name).sort();

function setup() {
  const base = { nodes: [node(1, "A"), node(2, "B", { status: "proposed" })], relationships: [rel(1, 1, 2)] };
  return { base, snap: snapshotGraph(base), local: clone(base), server: clone(base) };
}

test("keeps nodes a seat merged while this tab edited something else", () => {
  const { snap, local, server } = setup();
  local.nodes[1].properties.status = "testing";
  server.nodes.push(node(3, "Seat Proposal"));
  server.relationships.push(rel(2, 3, 1, "TESTS"));
  const out = rebaseGraph(snap, local, server);
  assert.deepEqual(names(out), ["A", "B", "Seat Proposal"]);
  assert.equal(out.nodes.find((n) => n.id === 2).properties.status, "testing");
  assert.equal(out.relationships.length, 2);
});

test("a property changed only on the server is not reverted by the stale tab", () => {
  const { snap, local, server } = setup();
  server.nodes[1].properties.status = "adopted"; // the seat moved it
  local.nodes[0].properties.description = "edited here";
  const out = rebaseGraph(snap, local, server);
  assert.equal(out.nodes.find((n) => n.id === 2).properties.status, "adopted");
  assert.equal(out.nodes.find((n) => n.id === 1).properties.description, "edited here");
});

test("new local nodes get fresh ids and their edges follow", () => {
  const { snap, local, server } = setup();
  server.nodes.push(node(3, "Seat Proposal")); // the server took id 3
  local.nodes.push(node(3, "Tab Proposal")); // so did this tab
  local.relationships.push(rel(2, 3, 2, "EXTENDS"));
  const out = rebaseGraph(snap, local, server);
  const tab = out.nodes.find((n) => n.properties.name === "Tab Proposal");
  assert.equal(tab.id, 4);
  assert.ok(out.relationships.some((r) => r.startNodeId === 4 && r.endNodeId === 2 && r.type === "EXTENDS"));
  assert.ok(!out.relationships.some((r) => r.startNodeId === 3 && r.type === "EXTENDS"));
});

test("the same new name on both sides becomes one node", () => {
  const { snap, local, server } = setup();
  server.nodes.push(node(3, "Shared Idea", { source: "seat" }));
  local.nodes.push(node(9, "shared idea", { kind: "mechanism" }));
  local.relationships.push(rel(5, 9, 1, "PROPOSES_CHANGE_TO"));
  const out = rebaseGraph(snap, local, server);
  const shared = out.nodes.filter((n) => n.properties.name.toLowerCase() === "shared idea");
  assert.equal(shared.length, 1);
  assert.equal(shared[0].properties.kind, "mechanism");
  assert.ok(out.relationships.some((r) => r.startNodeId === 3 && r.endNodeId === 1));
});

test("deletions made here apply; deletions made on the server stay", () => {
  const { snap, local, server } = setup();
  local.nodes = local.nodes.filter((n) => n.id !== 1); // deleted here, with its edge
  local.relationships = [];
  server.nodes.push(node(3, "Seat Proposal"));
  const out = rebaseGraph(snap, local, server);
  assert.deepEqual(names(out), ["B", "Seat Proposal"]);
  assert.equal(out.relationships.length, 0);

  const s2 = setup();
  s2.server.nodes = s2.server.nodes.filter((n) => n.id !== 2);
  s2.server.relationships = [];
  s2.local.nodes[1].properties.status = "testing"; // edited a node the server deleted
  const out2 = rebaseGraph(s2.snap, s2.local, s2.server);
  assert.deepEqual(names(out2), ["A"]);
});

test("D3-rendered links (source/target objects) are understood", () => {
  const { snap, local, server } = setup();
  const [a, b] = local.nodes;
  local.relationships = [{ id: 1, source: a, target: b, type: "AFFECTS" }, { id: 7, source: b, target: a, type: "MITIGATES" }];
  const out = rebaseGraph(snap, local, server);
  assert.equal(out.relationships.length, 2);
  assert.ok(out.relationships.some((r) => r.startNodeId === 2 && r.endNodeId === 1 && r.type === "MITIGATES"));
});
