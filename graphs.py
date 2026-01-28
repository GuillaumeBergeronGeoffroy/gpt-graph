"""Graph storage: load, save, delete, merge, list."""

import json
import os
import shutil
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


def save_graph_state(state, graph_id='default', base_dir=None):
    """Save graph state to file."""
    now = time.time()
    if 'created_at' not in state:
        # Preserve existing created_at from disk, or set now
        path = _graph_file(graph_id, base_dir)
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    existing = json.load(f)
                state['created_at'] = existing.get('created_at', now)
            except Exception:
                state['created_at'] = now
        else:
            state['created_at'] = now
    state['updated_at'] = now
    path = _graph_file(graph_id, base_dir)
    with open(path, 'w') as f:
        json.dump(state, f, indent=2)
    return state


def delete_graph(graph_id, base_dir=None):
    """Delete a graph file."""
    path = _graph_file(graph_id, base_dir)
    if os.path.exists(path):
        os.unlink(path)
        return True
    return False


def merge_into_graph(new_data, graph_id='default', base_dir=None):
    """Merge new nodes/relationships into existing graph."""
    current = load_graph_state(graph_id, base_dir)

    # Get existing node names for dedup
    existing_names = {n.get('name', n.get('properties', {}).get('name', '')) for n in current.get('nodes', [])}

    # Add new nodes that don't already exist
    new_nodes = new_data.get('nodes', [])
    for node in new_nodes:
        name = node.get('name', node.get('properties', {}).get('name', ''))
        if name and name not in existing_names:
            max_id = max([n.get('id', 0) for n in current['nodes']] + [0])
            node['id'] = max_id + 1
            current['nodes'].append(node)
            existing_names.add(name)

    # Preserve metadata
    for key in ('title', 'description'):
        if key in new_data:
            current[key] = new_data[key]

    # Add new relationships
    new_rels = new_data.get('relationships', [])
    current['relationships'] = current.get('relationships', []) + new_rels

    save_graph_state(current, graph_id, base_dir)
    return current


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
