#!/usr/bin/env python3
"""
Simple Claude Code API server for gpt-graph.
Uses local Claude account (no API key needed - uses `claude login` credentials).
"""

import asyncio
import json
import shutil
import os
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import subprocess
import threading
import pty
import select

# Track active tasks
active_tasks = {}  # task_id -> task info

# Graph state file (shared between browser and Claude Code)
GRAPH_STATE_FILE = os.path.expanduser("~/.gpt-graph/graph-state.json")
os.makedirs(os.path.dirname(GRAPH_STATE_FILE), exist_ok=True)


def load_graph_state():
    """Load current graph state from file."""
    if os.path.exists(GRAPH_STATE_FILE):
        with open(GRAPH_STATE_FILE, 'r') as f:
            return json.load(f)
    return {"nodes": [], "relationships": []}


def save_graph_state(state):
    """Save graph state to file."""
    with open(GRAPH_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)
    return state


def merge_into_graph(new_data):
    """Merge new nodes/relationships into existing graph."""
    current = load_graph_state()

    # Get existing node names for dedup
    existing_names = {n.get('name', n.get('properties', {}).get('name', '')) for n in current.get('nodes', [])}

    # Add new nodes that don't already exist
    new_nodes = new_data.get('nodes', [])
    for node in new_nodes:
        name = node.get('name', node.get('properties', {}).get('name', ''))
        if name and name not in existing_names:
            # Assign new ID
            max_id = max([n.get('id', 0) for n in current['nodes']] + [0])
            node['id'] = max_id + 1
            current['nodes'].append(node)
            existing_names.add(name)

    # Add new relationships
    new_rels = new_data.get('relationships', [])
    current['relationships'] = current.get('relationships', []) + new_rels

    save_graph_state(current)
    return current


def find_claude_binary() -> str:
    """Find Claude binary path automatically."""
    # Check environment variable first
    if 'CLAUDE_BINARY_PATH' in os.environ:
        claude_path = os.environ['CLAUDE_BINARY_PATH']
        if os.path.exists(claude_path):
            return claude_path

    # Try to find claude in PATH
    claude_path = shutil.which("claude")
    if claude_path:
        return claude_path

    raise RuntimeError("Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code")


CLAUDE_BINARY = find_claude_binary()
print(f"Using Claude binary: {CLAUDE_BINARY}")


def call_claude(prompt: str, model: str = "claude-opus-4-5-20251101") -> str:
    """Call Claude Code CLI and return the response."""

    # Log the prompt (truncated)
    print(f"\n{'='*60}")
    print(f"PROMPT ({len(prompt)} chars):")
    print(f"{prompt[:500]}{'...' if len(prompt) > 500 else ''}")
    print(f"{'='*60}")

    cmd = [
        CLAUDE_BINARY,
        "-p", prompt,
        "--model", model,
        "--output-format", "text",
        "--dangerously-skip-permissions"
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=os.getcwd()
    )

    if result.returncode != 0:
        print(f"ERROR: {result.stderr}")
        raise RuntimeError(f"Claude CLI error: {result.stderr}")

    response = result.stdout.strip()

    # Log the response (truncated)
    print(f"\nRESPONSE ({len(response)} chars):")
    print(f"{response[:1000]}{'...' if len(response) > 1000 else ''}")
    print(f"{'='*60}\n")

    return response


def execute_claude_task(prompt: str, working_dir: str = None, model: str = "claude-opus-4-5-20251101", task_id: str = None) -> dict:
    """Execute a Claude Code task that can create files and run commands."""

    # Use provided working dir or default to ~/claude-projects
    if working_dir:
        cwd = os.path.expanduser(working_dir)
    else:
        cwd = os.path.expanduser("~/claude-projects")

    # Create working directory if it doesn't exist
    os.makedirs(cwd, exist_ok=True)

    # Create log file for this task
    log_dir = os.path.expanduser("~/claude-projects/.logs")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, f"{task_id or 'task'}.log")

    print(f"\n{'='*60}")
    print(f"EXECUTING TASK {task_id} in {cwd}")
    print(f"Log file: {log_file}")
    print(f"PROMPT ({len(prompt)} chars):")
    print(f"{prompt[:800]}{'...' if len(prompt) > 800 else ''}")
    print(f"{'='*60}")

    # Update task status
    if task_id and task_id in active_tasks:
        active_tasks[task_id]['status'] = 'running'
        active_tasks[task_id]['working_dir'] = cwd
        active_tasks[task_id]['log_file'] = log_file
        active_tasks[task_id]['started_at'] = time.time()

    cmd = [
        CLAUDE_BINARY,
        "-p", prompt,
        "--model", model,
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions"
    ]

    # Run with stream-json for real-time output
    with open(log_file, 'w') as log:
        log.write(f"=== Task started at {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        log.write(f"Working directory: {cwd}\n")
        log.write(f"{'='*60}\n\n")
        log.flush()

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            bufsize=1
        )

        output_texts = []
        exit_code = None
        buffer = ""

        try:
            # Read stdout line by line (stream-json outputs newline-delimited JSON)
            while True:
                line = process.stdout.readline()
                if not line:
                    break

                line_str = line.decode('utf-8', errors='replace').strip()
                if not line_str:
                    continue

                # Parse the JSON chunk
                try:
                    chunk = json.loads(line_str)
                    chunk_type = chunk.get('type', '')

                    # Log raw chunk for debugging
                    log.write(f"[{chunk_type}] ")

                    # Extract text content based on message type
                    if chunk_type == 'assistant':
                        # Assistant message with content blocks
                        message = chunk.get('message', {})
                        for block in message.get('content', []):
                            if block.get('type') == 'text':
                                text = block.get('text', '')
                                output_texts.append(text)
                                log.write(text)
                            elif block.get('type') == 'tool_use':
                                tool_name = block.get('name', 'unknown')
                                log.write(f"\n[Tool: {tool_name}]\n")

                    elif chunk_type == 'content_block_delta':
                        # Streaming text delta
                        delta = chunk.get('delta', {})
                        if delta.get('type') == 'text_delta':
                            text = delta.get('text', '')
                            output_texts.append(text)
                            log.write(text)

                    elif chunk_type == 'result':
                        # Final result
                        result_text = chunk.get('result', '')
                        if result_text and result_text not in ''.join(output_texts):
                            output_texts.append(result_text)
                            log.write(f"\n\n{result_text}")

                    log.flush()

                    # Update task progress
                    if task_id and task_id in active_tasks:
                        full_output = ''.join(output_texts)
                        lines = full_output.split('\n')
                        active_tasks[task_id]['last_output'] = '\n'.join(lines[-20:])
                        active_tasks[task_id]['output_lines'] = len(lines)

                except json.JSONDecodeError:
                    # Not JSON, just log it directly
                    log.write(line_str + '\n')
                    log.flush()

            process.wait(timeout=600)
            exit_code = process.returncode

        except subprocess.TimeoutExpired:
            process.kill()
            log.write("\n\n=== TASK TIMED OUT ===\n")
            raise

        log.write(f"\n{'='*60}\n")
        log.write(f"=== Task completed with exit code {exit_code} ===\n")

    response = ''.join(output_texts).strip()

    # Log response summary
    print(f"\nTASK RESPONSE ({len(response)} chars):")
    print(f"{response[:1500]}{'...' if len(response) > 1500 else ''}")
    print(f"{'='*60}\n")

    # List files in working directory to report what was created
    files_created = []
    try:
        for root, dirs, files in os.walk(cwd):
            # Skip hidden directories
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if not f.startswith('.'):
                    rel_path = os.path.relpath(os.path.join(root, f), cwd)
                    files_created.append(rel_path)
    except Exception as e:
        print(f"Error listing files: {e}")

    # Update task as completed
    if task_id and task_id in active_tasks:
        active_tasks[task_id]['status'] = 'completed'
        active_tasks[task_id]['completed_at'] = time.time()
        active_tasks[task_id]['files'] = files_created[:50]

    return {
        "response": response,
        "working_dir": cwd,
        "files": files_created[:50],  # Limit to 50 files
        "exit_code": exit_code,
        "log_file": log_file,
        "task_id": task_id
    }


def start_task_async(prompt: str, working_dir: str, model: str, task_id: str):
    """Start a task in a background thread."""
    def run():
        try:
            result = execute_claude_task(prompt, working_dir, model, task_id)
            active_tasks[task_id]['result'] = result
            active_tasks[task_id]['status'] = 'completed'
        except Exception as e:
            active_tasks[task_id]['status'] = 'failed'
            active_tasks[task_id]['error'] = str(e)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


class CORSRequestHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path == '/v1/completions' or self.path == '/v1/chat/completions':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                request = json.loads(post_data.decode('utf-8'))
                prompt = request.get('prompt', '')

                # Handle chat completions format
                if 'messages' in request:
                    messages = request['messages']
                    prompt = '\n'.join([m.get('content', '') for m in messages])

                model = request.get('model', 'claude-sonnet-4-20250514')

                # Map OpenAI models to Claude models
                if 'gpt' in model or 'davinci' in model:
                    model = 'claude-opus-4-5-20251101'

                print(f"Calling Claude with prompt length: {len(prompt)}")
                response_text = call_claude(prompt, model)

                # Return in OpenAI-compatible format
                response = {
                    "id": "claude-response",
                    "object": "text_completion",
                    "choices": [{
                        "text": response_text,
                        "index": 0,
                        "finish_reason": "stop"
                    }]
                }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())

            except Exception as e:
                print(f"Error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode())

        elif self.path == '/v1/execute':
            # Agentic task execution endpoint (async)
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                request = json.loads(post_data.decode('utf-8'))
                prompt = request.get('prompt', '')
                working_dir = request.get('working_dir', None)
                model = request.get('model', 'claude-opus-4-5-20251101')
                async_mode = request.get('async', True)  # Default to async

                task_id = str(uuid.uuid4())[:8]

                # Register the task
                active_tasks[task_id] = {
                    'id': task_id,
                    'status': 'starting',
                    'prompt': prompt[:200] + '...' if len(prompt) > 200 else prompt,
                    'working_dir': os.path.expanduser(working_dir) if working_dir else os.path.expanduser("~/claude-projects"),
                    'created_at': time.time(),
                    'last_output': '',
                    'output_lines': 0
                }

                print(f"Starting task {task_id} with prompt length: {len(prompt)}")

                if async_mode:
                    # Start async and return immediately
                    start_task_async(prompt, working_dir, model, task_id)

                    self.send_response(202)  # Accepted
                    self.send_header('Content-Type', 'application/json')
                    self._set_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "task_id": task_id,
                        "status": "starting",
                        "message": "Task started. Poll /v1/tasks/{task_id} for status."
                    }).encode())
                else:
                    # Synchronous execution (wait for completion)
                    result = execute_claude_task(prompt, working_dir, model, task_id)

                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self._set_cors_headers()
                    self.end_headers()
                    self.wfile.write(json.dumps(result).encode())

            except subprocess.TimeoutExpired:
                self.send_response(504)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": "Task timed out after 10 minutes"}}).encode())

            except Exception as e:
                print(f"Execute error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode())

        elif self.path == '/v1/graph':
            # Save full graph state (browser syncs to server)
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                graph = json.loads(post_data.decode('utf-8'))
                save_graph_state(graph)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "saved",
                    "node_count": len(graph.get('nodes', [])),
                    "relationship_count": len(graph.get('relationships', []))
                }).encode())

            except Exception as e:
                print(f"Graph save error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode())

        elif self.path == '/v1/graph/merge':
            # Merge new nodes/relationships into graph (Claude Code adds to graph)
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                new_data = json.loads(post_data.decode('utf-8'))
                updated_graph = merge_into_graph(new_data)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "merged",
                    "node_count": len(updated_graph.get('nodes', [])),
                    "relationship_count": len(updated_graph.get('relationships', [])),
                    "added_nodes": len(new_data.get('nodes', []))
                }).encode())

            except Exception as e:
                print(f"Graph merge error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": str(e)}}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "claude_binary": CLAUDE_BINARY}).encode())

        elif self.path == '/v1/graph':
            # Return current graph state (for Claude Code to read)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            graph = load_graph_state()
            self.wfile.write(json.dumps(graph).encode())

        elif self.path == '/v1/graph/summary':
            # Return condensed graph summary (node names + types only)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            graph = load_graph_state()
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
            self.wfile.write(json.dumps(summary).encode())

        elif self.path == '/v1/tasks':
            # List all active tasks
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            tasks_summary = [{
                'id': t['id'],
                'status': t['status'],
                'working_dir': t.get('working_dir'),
                'output_lines': t.get('output_lines', 0),
                'created_at': t.get('created_at'),
                'completed_at': t.get('completed_at')
            } for t in active_tasks.values()]
            self.wfile.write(json.dumps({"tasks": tasks_summary}).encode())

        elif self.path.startswith('/v1/tasks/'):
            # Get specific task status
            task_id = self.path.split('/')[-1]

            # Check for log request
            if '/log' in self.path:
                task_id = self.path.split('/')[3]
                task = active_tasks.get(task_id)
                if task and task.get('log_file') and os.path.exists(task['log_file']):
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain')
                    self._set_cors_headers()
                    self.end_headers()
                    with open(task['log_file'], 'r') as f:
                        # Read last 100 lines for live view
                        lines = f.readlines()
                        self.wfile.write(''.join(lines[-100:]).encode())
                else:
                    self.send_response(404)
                    self._set_cors_headers()
                    self.end_headers()
                return

            task = active_tasks.get(task_id)
            if task:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()

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

                # Include full result if completed
                if task['status'] == 'completed' and 'result' in task:
                    response_data['result'] = task['result']

                self.wfile.write(json.dumps(response_data).encode())
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Task not found"}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


def run_server(port=8765):
    server = HTTPServer(('localhost', port), CORSRequestHandler)
    print(f"Claude Code API server running on http://localhost:{port}")
    print("Using local Claude account (no API key needed)")
    print("\nEndpoints:")
    print(f"  POST http://localhost:{port}/v1/completions      - Text completions")
    print(f"  POST http://localhost:{port}/v1/chat/completions - Chat completions")
    print(f"  POST http://localhost:{port}/v1/execute          - Agentic task execution")
    print(f"  GET  http://localhost:{port}/v1/graph            - Get graph state")
    print(f"  GET  http://localhost:{port}/v1/graph/summary    - Get graph summary")
    print(f"  POST http://localhost:{port}/v1/graph            - Save graph state")
    print(f"  POST http://localhost:{port}/v1/graph/merge      - Merge new nodes")
    print(f"  GET  http://localhost:{port}/health")
    print(f"\nGraph state: {GRAPH_STATE_FILE}")
    print(f"Project directory: ~/claude-projects/")
    print("\nPress Ctrl+C to stop")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
