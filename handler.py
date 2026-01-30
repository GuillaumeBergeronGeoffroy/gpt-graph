"""HTTP request handler with CORS support."""

import base64
import json
import mimetypes
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

ATTACHMENTS_DIR = os.path.expanduser('~/.gpt-graph/attachments')

from graphs import (
    GRAPHS_DIR, AGENT_GRAPHS_DIR,
    load_graph_state, save_graph_state, delete_graph,
    merge_into_graph, list_graphs,
    search_nodes, get_node_with_neighbors, get_nodes_by_relation,
    get_graph_labels, traverse_graph
)
from claude_task import (
    CLAUDE_BINARY, active_tasks, create_task, get_tasks_for_workspace,
    call_claude, execute_claude_task, start_task_async
)
from thinking_loop import (
    ThinkingLoop, get_workspace_dir, list_workspaces,
    create_workspace, delete_workspace
)

# ── Multi-loop registry ──────────────────────────────────────────────────
thinking_loops = {}
_loops_lock = threading.Lock()

# ── Shared SSE broadcast ─────────────────────────────────────────────────
_sse_clients = []
_sse_lock = threading.Lock()


def broadcast_sse(event_type, data):
    """Send an SSE event to all connected clients."""
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    encoded = msg.encode()
    with _sse_lock:
        dead = []
        for client in _sse_clients:
            try:
                client.write(encoded)
                client.flush()
            except Exception:
                dead.append(client)
        for d in dead:
            _sse_clients.remove(d)


def get_loop(workspace='default'):
    """Get or create a ThinkingLoop for the given workspace."""
    if workspace not in thinking_loops:
        with _loops_lock:
            if workspace not in thinking_loops:
                thinking_loops[workspace] = ThinkingLoop(
                    workspace=workspace, broadcast_fn=broadcast_sse
                )
    return thinking_loops[workspace]


def _all_loop_statuses():
    """Return status dict for all known loops."""
    statuses = {}
    for ws, loop in thinking_loops.items():
        statuses[ws] = loop.status()
    return statuses


class CORSRequestHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def _parse_path(self):
        parsed = urlparse(self.path)
        params = {}
        if parsed.query:
            for part in parsed.query.split('&'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    params[k] = unquote(v)  # Decode URL-encoded values
        return parsed.path, params

    def _graph_id(self, params):
        return params.get('id', 'default')

    def _workspace_dir(self, params):
        """Get the workspace directory from params."""
        workspace = params.get('workspace', 'default')
        return get_workspace_dir(workspace)

    def _json_response(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        content_length = int(self.headers['Content-Length'])
        return json.loads(self.rfile.read(content_length).decode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        path, params = self._parse_path()
        graph_id = self._graph_id(params)

        if path in ('/v1/completions', '/v1/chat/completions'):
            try:
                request = self._read_body()
                prompt = request.get('prompt', '')
                if 'messages' in request:
                    messages = request['messages']
                    prompt = '\n'.join([m.get('content', '') for m in messages])

                model = request.get('model', 'claude-sonnet-4-20250514')
                if 'gpt' in model or 'davinci' in model:
                    model = 'claude-opus-4-5-20251101'

                print(f"Calling Claude with prompt length: {len(prompt)}")
                response_text = call_claude(prompt, model)

                self._json_response(200, {
                    "id": "claude-response",
                    "object": "text_completion",
                    "choices": [{
                        "text": response_text,
                        "index": 0,
                        "finish_reason": "stop"
                    }]
                })
            except Exception as e:
                print(f"Error: {e}")
                self._json_response(500, {"error": {"message": str(e)}})

        elif path == '/v1/execute':
            try:
                request = self._read_body()
                prompt = request.get('prompt', '')
                working_dir = request.get('working_dir', None)
                model = request.get('model', 'claude-opus-4-5-20251101')
                async_mode = request.get('async', True)
                task_graph_id = request.get('graph_id', graph_id)
                task_workspace = request.get('workspace', params.get('workspace', 'default'))

                task_id = str(uuid.uuid4())[:8]
                create_task(task_id, {
                    'id': task_id,
                    'status': 'starting',
                    'prompt': prompt[:200] + '...' if len(prompt) > 200 else prompt,
                    'working_dir': os.path.expanduser(working_dir) if working_dir else os.path.expanduser("~/claude-projects"),
                    'graph_id': task_graph_id,
                    'workspace': task_workspace,
                    'created_at': time.time(),
                    'last_output': '',
                    'output_lines': 0
                })

                print(f"Starting task {task_id} (graph: {task_graph_id}) with prompt length: {len(prompt)}")

                if async_mode:
                    start_task_async(prompt, working_dir, model, task_id)
                    self._json_response(202, {
                        "task_id": task_id,
                        "status": "starting",
                        "message": f"Task started. Poll /v1/tasks/{task_id} for status."
                    })
                else:
                    result = execute_claude_task(prompt, working_dir, model, task_id)
                    self._json_response(200, result)

            except Exception as e:
                print(f"Execute error: {e}")
                code = 504 if 'TimeoutExpired' in type(e).__name__ else 500
                self._json_response(code, {"error": {"message": str(e)}})

        elif path == '/v1/graph':
            try:
                graph = self._read_body()
                save_graph_state(graph, graph_id)
                self._json_response(200, {
                    "status": "saved",
                    "node_count": len(graph.get('nodes', [])),
                    "relationship_count": len(graph.get('relationships', []))
                })
            except Exception as e:
                print(f"Graph save error: {e}")
                self._json_response(500, {"error": {"message": str(e)}})

        elif path == '/v1/graph/merge':
            try:
                new_data = self._read_body()
                updated_graph = merge_into_graph(new_data, graph_id)
                self._json_response(200, {
                    "status": "merged",
                    "node_count": len(updated_graph.get('nodes', [])),
                    "relationship_count": len(updated_graph.get('relationships', [])),
                    "added_nodes": len(new_data.get('nodes', []))
                })
            except Exception as e:
                print(f"Graph merge error: {e}")
                self._json_response(500, {"error": {"message": str(e)}})

        elif path == '/v1/agent/graph':
            try:
                graph = self._read_body()
                workspace_dir = self._workspace_dir(params)
                save_graph_state(graph, graph_id, workspace_dir)
                # Broadcast graph update to connected clients
                broadcast_sse('graph_update', {
                    'action': 'save',
                    'graph_id': graph_id,
                    'workspace': params.get('workspace', 'default'),
                    'node_count': len(graph.get('nodes', [])),
                    'relationship_count': len(graph.get('relationships', []))
                })
                self._json_response(200, {
                    "status": "saved",
                    "node_count": len(graph.get('nodes', [])),
                    "relationship_count": len(graph.get('relationships', []))
                })
            except Exception as e:
                self._json_response(500, {"error": {"message": str(e)}})

        elif path == '/v1/agent/graph/merge':
            try:
                new_data = self._read_body()
                workspace_dir = self._workspace_dir(params)
                updated_graph = merge_into_graph(new_data, graph_id, workspace_dir)
                # Broadcast graph update to connected clients
                broadcast_sse('graph_update', {
                    'action': 'merge',
                    'graph_id': graph_id,
                    'workspace': params.get('workspace', 'default'),
                    'node_count': len(updated_graph.get('nodes', [])),
                    'relationship_count': len(updated_graph.get('relationships', [])),
                    'added_nodes': len(new_data.get('nodes', []))
                })
                self._json_response(200, {
                    "status": "merged",
                    "node_count": len(updated_graph.get('nodes', [])),
                    "relationship_count": len(updated_graph.get('relationships', []))
                })
            except Exception as e:
                self._json_response(500, {"error": {"message": str(e)}})

        elif path == '/v1/loop/start':
            try:
                req = self._read_body()
                workspace = req.get('workspace', 'default')
                loop = get_loop(workspace)
                result = loop.start(
                    prompt=req.get('prompt', ''),
                    interval=req.get('interval', 0)
                )
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif path == '/v1/loop/stop':
            try:
                req = self._read_body()
                workspace = req.get('workspace', 'default')
                loop = get_loop(workspace)
                result = loop.stop()
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif path == '/v1/loop/configure':
            try:
                req = self._read_body()
                workspace = req.get('workspace', 'default')
                loop = get_loop(workspace)
                result = loop.configure(
                    prompt=req.get('prompt'),
                    interval=req.get('interval')
                )
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif path == '/v1/workspaces':
            try:
                req = self._read_body()
                workspace_name = req.get('name', '').strip()
                if not workspace_name:
                    self._json_response(400, {"error": "Workspace name required"})
                    return
                result = create_workspace(workspace_name)
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif path == '/v1/upload':
            try:
                req = self._read_body()
                filename = req.get('filename', 'file')
                data_b64 = req.get('data', '')

                # Sanitize filename
                safe_name = os.path.basename(filename)
                unique_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"

                os.makedirs(ATTACHMENTS_DIR, exist_ok=True)
                dest = os.path.join(ATTACHMENTS_DIR, unique_name)

                file_bytes = base64.b64decode(data_b64)
                with open(dest, 'wb') as f:
                    f.write(file_bytes)

                # Determine type from extension
                ext = os.path.splitext(safe_name)[1].lower()
                image_exts = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'}
                pdf_exts = {'.pdf'}
                if ext in image_exts:
                    file_type = 'image'
                elif ext in pdf_exts:
                    file_type = 'pdf'
                else:
                    file_type = 'file'

                self._json_response(200, {
                    "path": dest,
                    "filename": safe_name,
                    "type": file_type,
                    "size": len(file_bytes),
                    "url": f"/v1/attachments/{unique_name}"
                })
            except Exception as e:
                print(f"Upload error: {e}")
                self._json_response(500, {"error": {"message": str(e)}})

        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        path, params = self._parse_path()
        graph_id = self._graph_id(params)

        if path == '/health':
            self._json_response(200, {"status": "ok", "claude_binary": CLAUDE_BINARY})

        elif path == '/v1/graphs':
            self._json_response(200, {"graphs": list_graphs()})

        elif path == '/v1/graph':
            self._json_response(200, load_graph_state(graph_id))

        elif path == '/v1/graph/summary':
            graph = load_graph_state(graph_id)
            summary = {
                "node_count": len(graph.get('nodes', [])),
                "relationship_count": len(graph.get('relationships', [])),
                "nodes": [
                    {
                        "name": n.get('name', n.get('properties', {}).get('name', '')),
                        "type": n.get('type', n.get('labels', ['Unknown'])[0] if isinstance(n.get('labels'), list) else 'Unknown')
                    }
                    for n in graph.get('nodes', [])
                ]
            }
            self._json_response(200, summary)

        # ============ GRANULAR GRAPH QUERY ENDPOINTS ============

        elif path == '/v1/graph/search':
            # Search nodes by name: GET /v1/graph/search?id=X&q=query&limit=50
            query = params.get('q', '')
            limit = int(params.get('limit', '50'))
            results = search_nodes(graph_id, query, limit)
            self._json_response(200, {"query": query, "count": len(results), "nodes": results})

        elif path == '/v1/graph/node':
            # Get node with neighbors: GET /v1/graph/node?id=X&name=Y&depth=2
            node_name = params.get('name', '')
            node_id = params.get('node_id')
            if node_id:
                node_id = int(node_id)
            depth = int(params.get('depth', '1'))
            result = get_node_with_neighbors(graph_id, node_id, node_name, depth)
            if result:
                self._json_response(200, result)
            else:
                self._json_response(404, {"error": "Node not found"})

        elif path == '/v1/graph/relations':
            # Get nodes by relation: GET /v1/graph/relations?id=X&node=Y&relation=Z&direction=both
            node_name = params.get('node', '')
            relation = params.get('relation')
            direction = params.get('direction', 'both')
            result = get_nodes_by_relation(graph_id, node_name, relation, direction)
            if 'error' in result:
                self._json_response(404, result)
            else:
                self._json_response(200, result)

        elif path == '/v1/graph/labels':
            # Get all labels/types: GET /v1/graph/labels?id=X
            result = get_graph_labels(graph_id)
            self._json_response(200, result)

        elif path == '/v1/graph/traverse':
            # Traverse from node: GET /v1/graph/traverse?id=X&start=Y&direction=out&depth=3&relation=Z
            start_name = params.get('start', '')
            direction = params.get('direction', 'out')
            depth = int(params.get('depth', '3'))
            relation_filter = params.get('relation')
            result = traverse_graph(graph_id, start_name, direction, depth, relation_filter)
            if 'error' in result:
                self._json_response(404, result)
            else:
                self._json_response(200, result)

        elif path == '/v1/workspaces':
            self._json_response(200, {"workspaces": list_workspaces()})

        elif path == '/v1/agent/graphs':
            workspace_dir = self._workspace_dir(params)
            self._json_response(200, {"graphs": list_graphs(workspace_dir)})

        elif path == '/v1/agent/graph':
            workspace_dir = self._workspace_dir(params)
            self._json_response(200, load_graph_state(graph_id, workspace_dir))

        elif path == '/v1/tasks':
            workspace = params.get('workspace')
            if workspace:
                tasks = get_tasks_for_workspace(workspace)
            else:
                tasks = active_tasks
            tasks_summary = [{
                'id': t['id'],
                'status': t['status'],
                'workspace': t.get('workspace', 'default'),
                'working_dir': t.get('working_dir'),
                'output_lines': t.get('output_lines', 0),
                'created_at': t.get('created_at'),
                'completed_at': t.get('completed_at')
            } for t in tasks.values()]
            # Sort by created_at descending
            tasks_summary.sort(key=lambda x: x.get('created_at', 0), reverse=True)
            self._json_response(200, {"tasks": tasks_summary})

        elif path == '/v1/loop/status':
            workspace = params.get('workspace')
            if workspace:
                # Single workspace status
                loop = get_loop(workspace)
                self._json_response(200, loop.status())
            else:
                # All loops status
                self._json_response(200, {"loops": _all_loop_statuses()})

        elif path == '/v1/loop/actions':
            workspace = params.get('workspace', 'default')
            loop = get_loop(workspace)
            limit = int(params.get('limit', '50'))
            self._json_response(200, {"actions": loop.actions[-limit:]})

        elif path == '/v1/loop/stream':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self._set_cors_headers()
            self.end_headers()

            # Send initial all_status event with all loop statuses
            all_status = _all_loop_statuses()
            init_msg = f"event: all_status\ndata: {json.dumps(all_status)}\n\n"
            self.wfile.write(init_msg.encode())
            self.wfile.flush()

            with _sse_lock:
                _sse_clients.append(self.wfile)

            try:
                while True:
                    time.sleep(1)
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                with _sse_lock:
                    if self.wfile in _sse_clients:
                        _sse_clients.remove(self.wfile)
            return

        elif path.startswith('/v1/attachments/'):
            filename = path.split('/v1/attachments/', 1)[1]
            safe_name = os.path.basename(filename)
            filepath = os.path.join(ATTACHMENTS_DIR, safe_name)
            if os.path.isfile(filepath):
                mime_type = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', mime_type)
                self._set_cors_headers()
                self.end_headers()
                with open(filepath, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self._json_response(404, {"error": "File not found"})

        elif path.startswith('/v1/tasks/'):
            task_id = path.split('/')[-1]

            if '/log' in path:
                task_id = path.split('/')[3]
                task = active_tasks.get(task_id)
                if task and task.get('log_file') and os.path.exists(task['log_file']):
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain')
                    self._set_cors_headers()
                    self.end_headers()
                    with open(task['log_file'], 'r') as f:
                        self.wfile.write(f.read().encode())
                else:
                    self._json_response(404, {"error": "Log not found"})
                return

            task = active_tasks.get(task_id)
            if task:
                response_data = {
                    'id': task['id'],
                    'status': task['status'],
                    'working_dir': task.get('working_dir'),
                    'output_lines': task.get('output_lines', 0),
                    'last_output': task.get('last_output', ''),
                    'files': task.get('files', []),
                    'created_at': task.get('created_at'),
                    'completed_at': task.get('completed_at'),
                    'error': task.get('error')
                }
                if task['status'] == 'completed' and 'result' in task:
                    response_data['result'] = task['result']
                self._json_response(200, response_data)
            else:
                self._json_response(404, {"error": "Task not found"})

        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        path, params = self._parse_path()
        graph_id = self._graph_id(params)

        if path == '/v1/graph':
            deleted = delete_graph(graph_id)
            self._json_response(200 if deleted else 404, {"deleted": deleted, "id": graph_id})

        elif path == '/v1/agent/graph':
            workspace_dir = self._workspace_dir(params)
            deleted = delete_graph(graph_id, workspace_dir)
            self._json_response(200 if deleted else 404, {"deleted": deleted, "workspace": params.get('workspace', 'default')})

        elif path == '/v1/workspaces':
            workspace_name = params.get('name', '')
            if not workspace_name:
                self._json_response(400, {"error": "Workspace name required"})
                return
            # Stop the loop if running and remove from registry
            with _loops_lock:
                if workspace_name in thinking_loops:
                    loop = thinking_loops[workspace_name]
                    if loop.running:
                        loop.stop()
                    del thinking_loops[workspace_name]
            result = delete_workspace(workspace_name)
            if 'error' in result:
                self._json_response(400, result)
            else:
                self._json_response(200, result)

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")
