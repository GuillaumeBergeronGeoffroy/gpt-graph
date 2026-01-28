#!/usr/bin/env python3
"""
Claude Code API server for gpt-graph.
Uses local Claude account (no API key needed - uses `claude login` credentials).
"""

from http.server import HTTPServer
from socketserver import ThreadingMixIn

from graphs import GRAPHS_DIR
from handler import CORSRequestHandler


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def run_server(port=8765):
    server = ThreadedHTTPServer(('localhost', port), CORSRequestHandler)
    print(f"Claude Code API server running on http://localhost:{port}")
    print("Using local Claude account (no API key needed)")
    print("\nEndpoints (all graph endpoints accept ?id=<graph_id>):")
    print(f"  POST http://localhost:{port}/v1/completions      - Text completions")
    print(f"  POST http://localhost:{port}/v1/chat/completions - Chat completions")
    print(f"  POST http://localhost:{port}/v1/execute          - Agentic task execution")
    print(f"  GET  http://localhost:{port}/v1/graphs           - List all graphs")
    print(f"  GET  http://localhost:{port}/v1/graph?id=ID      - Get full graph state")
    print(f"  GET  http://localhost:{port}/v1/graph/summary    - Get graph summary (node/rel counts)")
    print(f"  GET  http://localhost:{port}/v1/graph/search?q=  - Search nodes by name")
    print(f"  GET  http://localhost:{port}/v1/graph/node?name= - Get node + neighbors (depth=N)")
    print(f"  GET  http://localhost:{port}/v1/graph/relations  - Get nodes by relation to node")
    print(f"  GET  http://localhost:{port}/v1/graph/labels     - List all node/relation types")
    print(f"  GET  http://localhost:{port}/v1/graph/traverse   - Traverse from node")
    print(f"  POST http://localhost:{port}/v1/graph?id=ID      - Save graph state")
    print(f"  POST http://localhost:{port}/v1/graph/merge      - Merge new nodes")
    print(f"  GET  http://localhost:{port}/v1/agent/graphs     - List agent graphs")
    print(f"  GET  http://localhost:{port}/v1/agent/graph      - Get agent graph")
    print(f"  POST http://localhost:{port}/v1/agent/graph      - Save agent graph")
    print(f"  POST http://localhost:{port}/v1/agent/graph/merge - Merge agent graph")
    print(f"  DELETE http://localhost:{port}/v1/agent/graph    - Delete agent graph")
    print(f"  POST http://localhost:{port}/v1/loop/start       - Start thinking loop")
    print(f"  POST http://localhost:{port}/v1/loop/stop        - Stop thinking loop")
    print(f"  POST http://localhost:{port}/v1/loop/configure   - Configure loop")
    print(f"  GET  http://localhost:{port}/v1/loop/status      - Loop status")
    print(f"  GET  http://localhost:{port}/v1/loop/actions     - Loop action history")
    print(f"  GET  http://localhost:{port}/v1/loop/stream      - SSE activity stream")
    print(f"  GET  http://localhost:{port}/health")
    print(f"\nGraph storage: {GRAPHS_DIR}")
    print(f"Project directory: ~/claude-projects/")
    print("\nPress Ctrl+C to stop")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
