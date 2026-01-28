# Gestalt

Interactive knowledge graph builder with AI-powered research, synthesis, and orchestration.

Build knowledge graphs from text, web research, or codebase analysis. Use the graph as persistent memory to direct actions on existing or new projects.

## Features

- **Graph Building** - Extract concepts and relationships from text, iteratively expand the graph
- **Chat Interface** - Conversational interaction with routing to different modes
- **Claude Code Integration** - Bidirectional sync with Claude Code for codebase analysis and implementation
- **Thinking Loop** - Autonomous background agent that continuously analyzes and evolves the graph
- **Granular Graph Queries** - Search, traverse, and explore graphs without loading everything into context
- **Epistemic Audit** - Grounding checks that evaluate concepts for testability, mechanism, and rigor
- **Graph Merging** - Select multiple graphs and merge them with AI-powered cross-graph connection discovery
- **Multi-Graph Storage** - IndexedDB-backed client storage + per-graph server files with unlimited capacity
- **Research Modes** - `/research`, `/implement`, `/analyze`, `/web`, `/ground`, `/claude` routing
- **Synthesis** - Find tensions and novel hypotheses across graph concepts
- **Undo/Redo** - Full history tracking for graph state
- **Import/Export** - Download and import graph JSON

## Running

Start the server (uses local Claude account via `claude` CLI, no API key needed):

```bash
python3 server.py
```

Then open `public/index.html` or serve with any static file server.

The server runs on `http://localhost:8765` by default.

## Chat Commands

| Command | Description |
|---------|-------------|
| `/research <topic>` | Research and add to graph |
| `/implement <task>` | Implement features in a codebase |
| `/analyze <path>` | Read-only codebase analysis |
| `/web <query>` | Web search for current information |
| `/ground <path>` | Ground concepts against a codebase |
| `/claude <task>` | Execute agentic task with Claude Code |
| `/sync` | Push graph state to server |
| `/pull` | Pull updates from server |

## API Reference

All graph endpoints accept `?id=<graph_id>` to target a specific graph (defaults to `default`).

### Graph Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/graphs` | List all available graphs |
| GET | `/v1/graph?id=X` | Get full graph state |
| POST | `/v1/graph?id=X` | Save/replace graph state |
| POST | `/v1/graph/merge?id=X` | Merge new nodes into graph |
| DELETE | `/v1/graph?id=X` | Delete a graph |

### Granular Graph Queries

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/graph/summary?id=X` | Get node/relationship counts and node list |
| GET | `/v1/graph/search?id=X&q=query&limit=50` | Search nodes by name (substring match) |
| GET | `/v1/graph/node?id=X&name=Y&depth=N` | Get node + N levels of connected neighbors |
| GET | `/v1/graph/relations?id=X&node=Y&relation=Z&direction=both` | Get nodes with specific relation to/from a node |
| GET | `/v1/graph/labels?id=X` | List all node types and relationship types with counts |
| GET | `/v1/graph/traverse?id=X&start=Y&depth=N&direction=out` | Traverse paths from a starting node |

**Examples:**

```bash
# Search for nodes containing "product"
curl "http://localhost:8765/v1/graph/search?q=product&limit=10"

# Get a node with 2 levels of neighbors
curl "http://localhost:8765/v1/graph/node?name=Authentication&depth=2"

# Find all nodes that CONNECTS_TO a specific node
curl "http://localhost:8765/v1/graph/relations?node=UserService&relation=CONNECTS_TO&direction=in"

# Traverse outward from a node
curl "http://localhost:8765/v1/graph/traverse?start=API%20Gateway&depth=3&direction=out"
```

### Task Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/execute` | Execute agentic task with Claude Code |
| GET | `/v1/tasks` | List all active tasks |
| GET | `/v1/tasks/{id}` | Get task status and result |
| GET | `/v1/tasks/{id}/log` | Get task execution log |

**Execute request body:**
```json
{
  "prompt": "Analyze the authentication flow",
  "working_dir": "~/my-project",
  "model": "claude-sonnet-4-20250514",
  "async": true,
  "graph_id": "my-graph"
}
```

### Thinking Loop

Autonomous background agent that continuously analyzes the graph and takes actions.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/loop/start` | Start the thinking loop |
| POST | `/v1/loop/stop` | Stop the thinking loop |
| POST | `/v1/loop/configure` | Update loop settings |
| GET | `/v1/loop/status` | Get loop status (running, paused, idle) |
| GET | `/v1/loop/actions` | Get history of loop actions |
| GET | `/v1/loop/stream` | SSE stream of loop activity |

**Start request body:**
```json
{
  "prompt": "Focus on identifying security vulnerabilities",
  "interval": 30
}
```

### Agent Graphs

Separate graph workspace for agent-only state (not synced to client).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/agent/graphs` | List agent graphs |
| GET | `/v1/agent/graph?id=X` | Get agent graph |
| POST | `/v1/agent/graph?id=X` | Save agent graph |
| POST | `/v1/agent/graph/merge?id=X` | Merge into agent graph |
| DELETE | `/v1/agent/graph?id=X` | Delete agent graph |

### Completions (OpenAI-compatible)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/completions` | Text completion |
| POST | `/v1/chat/completions` | Chat completion |

## Architecture

```
gpt-graph/
├── public/                  # Frontend (vanilla JS, D3.js)
│   ├── index.html          # Main UI
│   ├── prompt.js           # Chat routing, task delegation, prompts
│   ├── storage.js          # IndexedDB + server sync
│   ├── renderGraph.js      # D3.js graph visualization
│   └── ...
├── server.py               # HTTP server entry point
├── handler.py              # Request handler with all endpoints
├── graphs.py               # Graph storage and query functions
├── claude_task.py          # Claude Code task execution
└── thinking_loop.py        # Autonomous thinking loop
```

**Storage locations:**
- Graphs: `~/.gpt-graph/graphs/{graph_id}.json` (server is single source of truth)
- Agent graphs: `~/.gpt-graph/agent-graphs/{graph_id}.json`
- Chat history: IndexedDB `gestalt-chats` (per-graph, can be large)
- Current graph ID: localStorage (`gestalt-currentGraphId`)
- Task logs: `~/claude-projects/.logs/{task_id}.log`
- Task prompts: `~/claude-projects/.logs/{task_id}-prompt.txt`

## Claude Code Integration

When executing tasks via `/claude` or `/implement`, the agent has access to:

1. **Graph API** - Read, search, traverse, and write to the knowledge graph
2. **File system** - Read and write files in the working directory
3. **Web search** - Research current information
4. **Code execution** - Run commands, tests, builds

Tasks automatically sync graph changes back to the client on completion.

## Requirements

- Python 3.8+
- Claude CLI installed and authenticated (`claude login`)
- Modern browser with IndexedDB support

## License

See [LICENSE](LICENSE)
