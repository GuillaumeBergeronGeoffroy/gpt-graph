# Gestalt

Interactive knowledge graph builder with AI-powered research, synthesis, and orchestration.

Build knowledge graphs from text, web research, or codebase analysis. Use the graph as persistent memory to direct actions on existing or new projects.

## Features

- **Graph Building** - Extract concepts and relationships from text, iteratively expand the graph
- **Chat Interface** - Conversational interaction with routing to different modes
- **Claude Code Integration** - Bidirectional sync with Claude Code for codebase analysis and implementation
- **Epistemic Audit** - Grounding checks that evaluate concepts for testability, mechanism, and rigor
- **Graph Merging** - Select multiple graphs and merge them with AI-powered cross-graph connection discovery
- **Multi-Graph Storage** - IndexedDB-backed storage with unlimited graph capacity
- **Research Modes** - `/research`, `/implement`, `/analyze`, `/web`, `/ground` routing
- **Synthesis** - Find tensions and novel hypotheses across graph concepts
- **Undo/Redo** - Full history tracking for graph state
- **Import/Export** - Download and import graph JSON

## Running

Start the Claude Code API server (uses local Claude account, no API key needed):

```bash
python3 server.py
```

Then open `public/index.html` or serve with any static file server.

## Chat Commands

| Command | Description |
|---------|-------------|
| `/research <topic>` | Research and add to graph |
| `/implement <task>` | Implement features in a codebase |
| `/analyze <path>` | Read-only codebase analysis |
| `/web <query>` | Web search for current information |
| `/ground <path>` | Ground concepts against a codebase |
| `/sync` | Push graph state to server |
| `/pull` | Pull updates from server |

## Architecture

- `public/` - Frontend (vanilla JS, D3.js for graph rendering)
- `server.py` - Local API server proxying to Claude Code CLI
- IndexedDB for client-side graph persistence
- Server-side graph state at `~/.gpt-graph/graph-state.json`

## License

See [LICENSE](LICENSE)
