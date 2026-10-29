"""Graph storage: load, save, delete, merge, list."""

import json
import os
import shutil
import threading
import time

# Graph storage directories (separate workspaces)
GRAPHS_DIR = os.path.expanduser("~/.gpt-graph/graphs")         # Client graphs
AGENT_GRAPHS_DIR = os.path.expanduser("~/.gpt-graph/agent-graphs")  # Agent-only graphs
os.makedirs(GRAPHS_DIR, exist_ok=True)
os.makedirs(AGENT_GRAPHS_DIR, exist_ok=True)

# Migrate legacy single-file format on startup
_legacy_file = os.path.expanduser("~/.gpt-graph/graph-state.json")
if os.path.exists(_legacy_file):
    _dest = os.path.join(GRAPHS_DIR, "default.json")
    if not os.path.exists(_dest):
        shutil.move(_legacy_file, _dest)
        print(f"Migrated legacy graph to {_dest}")
    else:
        print(f"Legacy file exists but default.json already present; skipping migration")


def _graph_file(graph_id, base_dir=None):
    """Get the file path for a graph ID. Sanitizes the ID to prevent path traversal."""
    safe_id = graph_id.replace('/', '_').replace('\\', '_').replace('..', '_')
    directory = base_dir or GRAPHS_DIR
    return os.path.join(directory, f"{safe_id}.json")


def load_graph_state(graph_id='default', base_dir=None):
    """Load graph state from file."""
    path = _graph_file(graph_id, base_dir)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {"nodes": [], "relationships": []}


# One writer at a time: UI saves, Claude task merges and council seats all land here
_write_lock = threading.RLock()


class StaleGraphError(Exception):
    """A full save was based on an older copy than the one on disk."""

    def __init__(self, updated_at):
        super().__init__(f"graph changed on the server at {updated_at}")
        self.updated_at = updated_at


def _write_json(path, state):
    """Write through a temp file and rename it, so no reader ever sees half a graph."""
    tmp = f"{path}.tmp"
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, path)


def save_graph_state(state, graph_id='default', base_dir=None, base_updated_at=None):
    """Save graph state to file.

    With base_updated_at (the updated_at of the copy the caller started from), refuse with
    StaleGraphError when someone else wrote the graph since, instead of overwriting them.
    """
    with _write_lock:
        path = _graph_file(graph_id, base_dir)
        existing = None
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    existing = json.load(f)
            except Exception:
                existing = None
        if base_updated_at is not None and existing and existing.get('updated_at', 0) > base_updated_at:
            raise StaleGraphError(existing['updated_at'])
        now = time.time()
        if 'created_at' not in state:
            # Preserve existing created_at from disk, or set now
            state['created_at'] = (existing or {}).get('created_at', now)
        if 'meta' not in state and (existing or {}).get('meta'):
            # The UI saves whole graphs without meta (e.g. the commit a refresh analyzed); keep it
            state['meta'] = existing['meta']
        state['updated_at'] = now
        _write_json(path, state)
        return state


def delete_graph(graph_id, base_dir=None):
    """Delete a graph file."""
    path = _graph_file(graph_id, base_dir)
    with _write_lock:
        if os.path.exists(path):
            os.unlink(path)
            return True
    return False


# Field names a relationship endpoint may arrive under (stored, agent-written, or rendered by D3)
_START_KEYS = ('startNodeId', 'from', 'source', 'startNode')
_END_KEYS = ('endNodeId', 'to', 'target', 'endNode')
_REL_FIELDS = {'id', 'type', 'properties', *_START_KEYS, *_END_KEYS}
_NODE_FIELDS = {'id', 'labels', 'label', 'type', 'name', 'properties'}


def _node_name(node):
    return node.get('name') or (node.get('properties') or {}).get('name') or node.get('label')


def _endpoint(rel, keys):
    """First endpoint reference present: an id, a node name, or a rendered node object."""
    for key in keys:
        ref = rel.get(key)
        if ref is not None:
            return ref.get('id') if isinstance(ref, dict) else ref
    return None


def merge_into_graph(new_data, graph_id='default', base_dir=None):
    """Merge nodes/relationships into a graph. Returns (graph, stats).

    Nodes are deduplicated by name (case-insensitive): merging a name that already exists
    updates that node's properties. Incoming node ids are local to the payload; new nodes
    always get a fresh numeric id and relationships are remapped to match. Relationship
    endpoints may be payload ids, existing graph ids, or node names. Relationships whose
    endpoints don't resolve are skipped and reported in stats.
    """
    with _write_lock:
        return _merge_unlocked(new_data, graph_id, base_dir)


def _merge_unlocked(new_data, graph_id, base_dir):
    current = load_graph_state(graph_id, base_dir)
    nodes = current.setdefault('nodes', [])
    relationships = current.setdefault('relationships', [])
    stats = {'added_nodes': 0, 'updated_nodes': 0, 'added_relationships': 0, 'updated_relationships': 0,
             'skipped_relationships': []}

    by_name = {}
    for n in nodes:
        name = _node_name(n)
        if name:
            by_name.setdefault(name.lower(), n)
    existing_ids = {n.get('id') for n in nodes}
    next_id = max([n['id'] for n in nodes if isinstance(n.get('id'), int)] + [0]) + 1
    payload_ids = {}  # str(incoming id) -> stored id

    for incoming in new_data.get('nodes', []):
        name = _node_name(incoming)
        if not name:
            continue
        # Top-level extras (description, evidence, ...) become properties
        extra = {k: v for k, v in incoming.items() if k not in _NODE_FIELDS}
        props = {**extra, **(incoming.get('properties') or {}), 'name': name}

        stored = by_name.get(name.lower())
        if stored:
            stored.setdefault('properties', {}).update(
                {k: v for k, v in props.items() if k != 'name' and v not in (None, '')})
            stats['updated_nodes'] += 1
        else:
            stored = {
                'id': next_id,
                'labels': incoming.get('labels') or [incoming.get('type') or 'Concept'],
                'properties': props,
            }
            if incoming.get('id') is not None:
                stored['_original_id'] = incoming['id']
            next_id += 1
            nodes.append(stored)
            by_name[name.lower()] = stored
            stats['added_nodes'] += 1

        if incoming.get('id') is not None:
            payload_ids[str(incoming['id'])] = stored['id']

    def resolve(ref):
        # Payload ids shadow graph ids, so a colliding id means the payload's node
        if ref is None:
            return None
        if str(ref) in payload_ids:
            return payload_ids[str(ref)]
        if isinstance(ref, str) and ref.lower() in by_name:
            return by_name[ref.lower()]['id']
        return ref if ref in existing_ids else None

    seen = {(_endpoint(r, _START_KEYS), _endpoint(r, _END_KEYS), r.get('type')): r for r in relationships}
    next_rel_id = max([r['id'] for r in relationships if isinstance(r.get('id'), int)] + [0]) + 1

    for rel in new_data.get('relationships', []):
        start = resolve(_endpoint(rel, _START_KEYS))
        end = resolve(_endpoint(rel, _END_KEYS))
        rel_type = rel.get('type') or 'RELATES_TO'
        if start is None or end is None:
            stats['skipped_relationships'].append(
                {k: v for k, v in rel.items() if k in _START_KEYS + _END_KEYS + ('type',)})
            continue
        extra = {k: v for k, v in rel.items() if k not in _REL_FIELDS}
        props = {**(rel.get('properties') or {}), **extra}
        existing = seen.get((start, end, rel_type))
        if existing is not None:
            # The same edge again: its properties update (evidence moved, removed_in, ...)
            if props:
                existing.setdefault('properties', {}).update(props)
                stats['updated_relationships'] += 1
            continue
        added = {
            'id': next_rel_id,
            'startNodeId': start,
            'endNodeId': end,
            'type': rel_type,
            'properties': props,
        }
        relationships.append(added)
        seen[(start, end, rel_type)] = added
        next_rel_id += 1
        stats['added_relationships'] += 1

    # Preserve metadata
    for key in ('title', 'description'):
        if key in new_data:
            current[key] = new_data[key]
    # Graph-level facts, e.g. the commit the graph describes (analyzed_commit)
    if isinstance(new_data.get('meta'), dict):
        current.setdefault('meta', {}).update(new_data['meta'])

    save_graph_state(current, graph_id, base_dir)
    return current, stats


def list_graphs(base_dir=None):
    """List all available graphs in a directory."""
    directory = base_dir or GRAPHS_DIR
    graphs = []
    if not os.path.exists(directory):
        return graphs
    for f in os.listdir(directory):
        if f.endswith('.json'):
            graph_id = f[:-5]
            path = os.path.join(directory, f)
            try:
                with open(path, 'r') as fh:
                    data = json.load(fh)
                mtime = os.path.getmtime(path)
                graphs.append({
                    'id': graph_id,
                    'title': data.get('title', ''),
                    'description': data.get('description', ''),
                    'node_count': len(data.get('nodes', [])),
                    'relationship_count': len(data.get('relationships', [])),
                    'created_at': data.get('created_at', mtime),
                    'updated_at': data.get('updated_at', mtime),
                    'modified_at': mtime
                })
            except Exception:
                graphs.append({'id': graph_id, 'node_count': 0, 'relationship_count': 0})
    graphs.sort(key=lambda g: g.get('modified_at', 0), reverse=True)
    return graphs


# ============ GRANULAR QUERY FUNCTIONS ============

def _get_node_name(node):
    """Extract name from node (handles different formats)."""
    return node.get('name') or node.get('properties', {}).get('name', '')


def _get_node_type(node):
    """Extract type/label from node."""
    if 'type' in node:
        return node['type']
    labels = node.get('labels', [])
    return labels[0] if labels else 'Unknown'


def _build_node_index(graph):
    """Build indexes for fast lookups."""
    nodes = graph.get('nodes', [])
    rels = graph.get('relationships', [])

    by_id = {}
    by_name = {}
    for n in nodes:
        nid = n.get('id')
        name = _get_node_name(n)
        if nid is not None:
            by_id[nid] = n
        if name:
            by_name[name.lower()] = n

    # Build adjacency lists
    outgoing = {}  # node_id -> [(rel_type, target_id, rel)]
    incoming = {}  # node_id -> [(rel_type, source_id, rel)]

    for rel in rels:
        src = rel.get('source') or rel.get('startNode') or rel.get('startNodeId') or rel.get('from')
        tgt = rel.get('target') or rel.get('endNode') or rel.get('endNodeId') or rel.get('to')
        rel_type = rel.get('type') or rel.get('label') or 'RELATED_TO'

        if src not in outgoing:
            outgoing[src] = []
        outgoing[src].append((rel_type, tgt, rel))

        if tgt not in incoming:
            incoming[tgt] = []
        incoming[tgt].append((rel_type, src, rel))

    return by_id, by_name, outgoing, incoming


def search_nodes(graph_id='default', query='', limit=50, base_dir=None):
    """Search nodes by name (case-insensitive substring match)."""
    graph = load_graph_state(graph_id, base_dir)
    nodes = graph.get('nodes', [])
    query_lower = query.lower()

    results = []
    for n in nodes:
        name = _get_node_name(n)
        if query_lower in name.lower():
            results.append({
                'id': n.get('id'),
                'name': name,
                'type': _get_node_type(n),
                'properties': n.get('properties', {})
            })
            if len(results) >= limit:
                break

    return results


def get_node_with_neighbors(graph_id='default', node_id=None, node_name=None, depth=1, base_dir=None):
    """Get a node and its neighbors up to N levels deep."""
    graph = load_graph_state(graph_id, base_dir)
    by_id, by_name, outgoing, incoming = _build_node_index(graph)

    # Find the starting node
    start_node = None
    if node_id is not None:
        start_node = by_id.get(node_id)
    elif node_name:
        start_node = by_name.get(node_name.lower())

    if not start_node:
        return None

    # BFS to collect neighbors
    visited_ids = set()
    result_nodes = []
    result_rels = []
    queue = [(start_node.get('id'), 0)]  # (node_id, current_depth)

    while queue:
        nid, d = queue.pop(0)
        if nid in visited_ids:
            continue
        visited_ids.add(nid)

        node = by_id.get(nid)
        if node:
            result_nodes.append({
                'id': node.get('id'),
                'name': _get_node_name(node),
                'type': _get_node_type(node),
                'properties': node.get('properties', {}),
                'depth': d
            })

        if d < depth:
            # Add outgoing neighbors
            for rel_type, tgt_id, rel in outgoing.get(nid, []):
                if tgt_id not in visited_ids:
                    queue.append((tgt_id, d + 1))
                    result_rels.append({
                        'source': nid,
                        'target': tgt_id,
                        'type': rel_type
                    })

            # Add incoming neighbors
            for rel_type, src_id, rel in incoming.get(nid, []):
                if src_id not in visited_ids:
                    queue.append((src_id, d + 1))
                    result_rels.append({
                        'source': src_id,
                        'target': nid,
                        'type': rel_type
                    })

    return {
        'center': _get_node_name(start_node),
        'depth': depth,
        'nodes': result_nodes,
        'relationships': result_rels
    }


def get_nodes_by_relation(graph_id='default', node_name=None, relation_type=None,
                          direction='both', base_dir=None):
    """Get all nodes that have a specific relation to/from a given node.

    Args:
        node_name: Name of the center node
        relation_type: Type of relationship to filter (or None for all)
        direction: 'in' (pointing to node), 'out' (from node), or 'both'
    """
    graph = load_graph_state(graph_id, base_dir)
    by_id, by_name, outgoing, incoming = _build_node_index(graph)

    center = by_name.get(node_name.lower()) if node_name else None
    if not center:
        return {'error': f'Node "{node_name}" not found'}

    center_id = center.get('id')
    results = []

    # Outgoing relations (center -> other)
    if direction in ('out', 'both'):
        for rel_type, tgt_id, rel in outgoing.get(center_id, []):
            if relation_type and rel_type.lower() != relation_type.lower():
                continue
            tgt_node = by_id.get(tgt_id)
            if tgt_node:
                results.append({
                    'node': {
                        'id': tgt_node.get('id'),
                        'name': _get_node_name(tgt_node),
                        'type': _get_node_type(tgt_node)
                    },
                    'relation': rel_type,
                    'direction': 'out'
                })

    # Incoming relations (other -> center)
    if direction in ('in', 'both'):
        for rel_type, src_id, rel in incoming.get(center_id, []):
            if relation_type and rel_type.lower() != relation_type.lower():
                continue
            src_node = by_id.get(src_id)
            if src_node:
                results.append({
                    'node': {
                        'id': src_node.get('id'),
                        'name': _get_node_name(src_node),
                        'type': _get_node_type(src_node)
                    },
                    'relation': rel_type,
                    'direction': 'in'
                })

    return {
        'center': node_name,
        'filter': {'relation': relation_type, 'direction': direction},
        'count': len(results),
        'results': results
    }


def get_graph_labels(graph_id='default', base_dir=None):
    """Get all unique node types/labels and relationship types in the graph."""
    graph = load_graph_state(graph_id, base_dir)

    node_types = {}
    for n in graph.get('nodes', []):
        t = _get_node_type(n)
        node_types[t] = node_types.get(t, 0) + 1

    rel_types = {}
    for r in graph.get('relationships', []):
        t = r.get('type') or r.get('label') or 'RELATED_TO'
        rel_types[t] = rel_types.get(t, 0) + 1

    return {
        'node_types': [{'type': k, 'count': v} for k, v in sorted(node_types.items(), key=lambda x: -x[1])],
        'relationship_types': [{'type': k, 'count': v} for k, v in sorted(rel_types.items(), key=lambda x: -x[1])]
    }


def traverse_graph(graph_id='default', start_name=None, direction='out', depth=3,
                   relation_filter=None, base_dir=None):
    """Traverse the graph from a starting node following relationships.

    Args:
        start_name: Name of starting node
        direction: 'in', 'out', or 'both'
        depth: Max traversal depth
        relation_filter: Only follow these relationship types (comma-separated or list)
    """
    graph = load_graph_state(graph_id, base_dir)
    by_id, by_name, outgoing, incoming = _build_node_index(graph)

    start = by_name.get(start_name.lower()) if start_name else None
    if not start:
        return {'error': f'Node "{start_name}" not found'}

    # Parse relation filter
    allowed_rels = None
    if relation_filter:
        if isinstance(relation_filter, str):
            allowed_rels = set(r.strip().lower() for r in relation_filter.split(','))
        else:
            allowed_rels = set(r.lower() for r in relation_filter)

    visited = set()
    paths = []  # List of paths: [(node_name, rel_type, node_name, ...)]

    def dfs(node_id, path, d):
        if d > depth or node_id in visited:
            return
        visited.add(node_id)

        node = by_id.get(node_id)
        if not node:
            return

        node_name = _get_node_name(node)
        current_path = path + [node_name]

        if d > 0:  # Don't record just the start node
            paths.append(current_path)

        if d < depth:
            edges = []
            if direction in ('out', 'both'):
                edges.extend((rel_type, tgt_id, 'out') for rel_type, tgt_id, _ in outgoing.get(node_id, []))
            if direction in ('in', 'both'):
                edges.extend((rel_type, src_id, 'in') for rel_type, src_id, _ in incoming.get(node_id, []))

            for rel_type, next_id, _ in edges:
                if allowed_rels and rel_type.lower() not in allowed_rels:
                    continue
                if next_id not in visited:
                    dfs(next_id, current_path + [f"--[{rel_type}]-->"], d + 1)

    dfs(start.get('id'), [], 0)

    return {
        'start': start_name,
        'direction': direction,
        'depth': depth,
        'relation_filter': relation_filter,
        'path_count': len(paths),
        'paths': paths[:100]  # Limit output
    }
