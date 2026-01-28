"""HTTP request handler with CORS support."""

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

from graphs import (
    GRAPHS_DIR, AGENT_GRAPHS_DIR,
    load_graph_state, save_graph_state, delete_graph,
    merge_into_graph, list_graphs,
    search_nodes, get_node_with_neighbors, get_nodes_by_relation,
    get_graph_labels, traverse_graph
)
from claude_task import (
    CLAUDE_BINARY, active_tasks,
    call_claude, execute_claude_task, start_task_async
)
from thinking_loop import ThinkingLoop

# Global thinking loop instance
thinking_loop = ThinkingLoop()


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

                task_id = str(uuid.uuid4())[:8]
                active_tasks[task_id] = {
                    'id': task_id,
                    'status': 'starting',
                    'prompt': prompt[:200] + '...' if len(prompt) > 200 else prompt,
                    'working_dir': os.path.expanduser(working_dir) if working_dir else os.path.expanduser("~/claude-projects"),
                    'graph_id': task_graph_id,
                    'created_at': time.time(),
                    'last_output': '',
                    'output_lines': 0
                }

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
                save_graph_state(graph, graph_id, AGENT_GRAPHS_DIR)
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
                updated_graph = merge_into_graph(new_data, graph_id, AGENT_GRAPHS_DIR)
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
                result = thinking_loop.start(
                    prompt=req.get('prompt', ''),
                    interval=req.get('interval', 0)
                )
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif path == '/v1/loop/stop':
            result = thinking_loop.stop()
            self._json_response(200, result)

        elif path == '/v1/loop/configure':
            try:
                req = self._read_body()
                result = thinking_loop.configure(
                    prompt=req.get('prompt'),
                    interval=req.get('interval')
                )
                self._json_response(200, result)
            except Exception as e:
                self._json_response(500, {"error": str(e)})

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

        elif path == '/v1/agent/graphs':
            self._json_response(200, {"graphs": list_graphs(AGENT_GRAPHS_DIR)})

        elif path == '/v1/agent/graph':
            self._json_response(200, load_graph_state(graph_id, AGENT_GRAPHS_DIR))

        elif path == '/v1/tasks':
            tasks_summary = [{
                'id': t['id'],
                'status': t['status'],
                'working_dir': t.get('working_dir'),
                'output_lines': t.get('output_lines', 0),
                'created_at': t.get('created_at'),
                'completed_at': t.get('completed_at')
            } for t in active_tasks.values()]
            self._json_response(200, {"tasks": tasks_summary})

        elif path == '/v1/loop/status':
            self._json_response(200, thinking_loop.status())

        elif path == '/v1/loop/actions':
            limit = int(params.get('limit', '50'))
            self._json_response(200, {"actions": thinking_loop.actions[-limit:]})

        elif path == '/v1/loop/stream':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self._set_cors_headers()
            self.end_headers()

            status_msg = f"event: status\ndata: {json.dumps(thinking_loop.status())}\n\n"
            self.wfile.write(status_msg.encode())
            self.wfile.flush()

            with thinking_loop.sse_lock:
                thinking_loop.sse_clients.append(self.wfile)

            try:
                while True:
                    time.sleep(1)
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except Exception:
                pass
            finally:
                with thinking_loop.sse_lock:
                    if self.wfile in thinking_loop.sse_clients:
                        thinking_loop.sse_clients.remove(self.wfile)
            return

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
            deleted = delete_graph(graph_id, AGENT_GRAPHS_DIR)
            self._json_response(200 if deleted else 404, {"deleted": deleted})

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")
