"""ThinkingLoop: persistent autonomous agent that respawns Claude Code sessions."""

import json
import os
import shutil
import threading
import time
import uuid

from graphs import AGENT_GRAPHS_DIR, list_graphs, load_graph_state, save_graph_state, delete_graph, merge_into_graph
from claude_task import active_tasks, execute_claude_task

LOOP_DIR = os.path.expanduser("~/.gpt-graph")
LOOPS_DIR = os.path.join(LOOP_DIR, "loops")

# Legacy file paths (for migration)
_LEGACY_CONFIG = os.path.join(LOOP_DIR, "loop-config.json")
_LEGACY_ACTIONS = os.path.join(LOOP_DIR, "loop-actions.json")


def _loop_config_file(workspace):
    return os.path.join(LOOPS_DIR, f"{workspace}-config.json")


def _loop_actions_file(workspace):
    return os.path.join(LOOPS_DIR, f"{workspace}-actions.json")


def _migrate_legacy_files():
    """Migrate legacy flat config/actions files to per-workspace directory."""
    os.makedirs(LOOPS_DIR, exist_ok=True)
    default_config = _loop_config_file('default')
    default_actions = _loop_actions_file('default')
    if os.path.exists(_LEGACY_CONFIG) and not os.path.exists(default_config):
        shutil.copy2(_LEGACY_CONFIG, default_config)
    if os.path.exists(_LEGACY_ACTIONS) and not os.path.exists(default_actions):
        shutil.copy2(_LEGACY_ACTIONS, default_actions)


# Run migration on import
_migrate_legacy_files()


def get_workspace_dir(workspace='default'):
    """Get the directory for a workspace."""
    workspace_dir = os.path.join(AGENT_GRAPHS_DIR, workspace)
    os.makedirs(workspace_dir, exist_ok=True)
    return workspace_dir


def list_workspaces():
    """List all available workspaces."""
    workspaces = []
    if os.path.exists(AGENT_GRAPHS_DIR):
        for name in os.listdir(AGENT_GRAPHS_DIR):
            path = os.path.join(AGENT_GRAPHS_DIR, name)
            if os.path.isdir(path):
                graphs = list_graphs(path)
                workspaces.append({
                    'id': name,
                    'graph_count': len(graphs),
                    'total_nodes': sum(g.get('node_count', 0) for g in graphs)
                })
        # Also check for legacy flat files (migrate them to 'default')
        for name in os.listdir(AGENT_GRAPHS_DIR):
            path = os.path.join(AGENT_GRAPHS_DIR, name)
            if os.path.isfile(path) and name.endswith('.json'):
                # Migrate to default workspace
                default_dir = get_workspace_dir('default')
                new_path = os.path.join(default_dir, name)
                if not os.path.exists(new_path):
                    os.rename(path, new_path)
    # Ensure default exists
    if not any(w['id'] == 'default' for w in workspaces):
        get_workspace_dir('default')
        workspaces.insert(0, {'id': 'default', 'graph_count': 0, 'total_nodes': 0})
    workspaces.sort(key=lambda w: w['id'])
    return workspaces


def create_workspace(name):
    """Create a new workspace."""
    get_workspace_dir(name)
    return {"workspace": name, "created": True}


def delete_workspace(name):
    """Delete a workspace and all its graphs."""
    if name == 'default':
        return {"error": "Cannot delete default workspace"}
    workspace_dir = os.path.join(AGENT_GRAPHS_DIR, name)
    if os.path.exists(workspace_dir):
        shutil.rmtree(workspace_dir)
        # Clean up loop files
        config_file = _loop_config_file(name)
        actions_file = _loop_actions_file(name)
        if os.path.exists(config_file):
            os.remove(config_file)
        if os.path.exists(actions_file):
            os.remove(actions_file)
        return {"workspace": name, "deleted": True}
    return {"error": "Workspace not found"}


class ThinkingLoop:
    """Persistent autonomous agent that respawns Claude Code sessions in a loop."""

    def __init__(self, workspace='default', broadcast_fn=None):
        self.workspace = workspace  # immutable per instance
        self._broadcast_fn = broadcast_fn
        self.running = False
        self.thread = None
        self.prompt = ""
        self.interval = 0
        self.iteration = 0
        self.current_task_id = None
        self.actions = self._load_actions()
        self._load_config()
        # Ensure workspace directory exists
        get_workspace_dir(self.workspace)

    def _load_actions(self):
        actions_file = _loop_actions_file(self.workspace)
        if os.path.exists(actions_file):
            try:
                with open(actions_file, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _save_actions(self):
        os.makedirs(LOOPS_DIR, exist_ok=True)
        actions_file = _loop_actions_file(self.workspace)
        with open(actions_file, 'w') as f:
            json.dump(self.actions[-200:], f, indent=2)

    def _load_config(self):
        config_file = _loop_config_file(self.workspace)
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r') as f:
                    cfg = json.load(f)
                    self.prompt = cfg.get('prompt', '')
                    self.interval = cfg.get('interval', 0)
            except Exception:
                pass

    def _save_config(self):
        os.makedirs(LOOPS_DIR, exist_ok=True)
        config_file = _loop_config_file(self.workspace)
        with open(config_file, 'w') as f:
            json.dump({
                'prompt': self.prompt,
                'interval': self.interval,
                'workspace': self.workspace
            }, f, indent=2)

    def _get_workspace_dir(self):
        """Get the current workspace directory."""
        return get_workspace_dir(self.workspace)

    def _broadcast_sse(self, event_type, data):
        """Send an SSE event to all connected clients, injecting workspace."""
        data['workspace'] = self.workspace
        if self._broadcast_fn:
            self._broadcast_fn(event_type, data)

    def _log_action(self, action_type, detail):
        entry = {
            'type': action_type,
            'detail': detail[:500] if isinstance(detail, str) else detail,
            'iteration': self.iteration,
            'timestamp': time.time()
        }
        self.actions.append(entry)
        self._save_actions()
        self._broadcast_sse('action', entry)

    def _build_system_prompt(self):
        """Build the full prompt with graph context and action history."""
        workspace_dir = self._get_workspace_dir()
        graphs = list_graphs(workspace_dir)
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        today = time.strftime('%A, %B %d, %Y')

        graphs_section = f"YOUR GRAPHS (workspace: {self.workspace}):\n"
        if graphs:
            for g in graphs:
                created = time.strftime('%Y-%m-%d', time.localtime(g.get('created_at', 0)))
                updated = time.strftime('%Y-%m-%d %H:%M', time.localtime(g.get('updated_at', g.get('modified_at', 0))))
                title = f" \"{g['title']}\"" if g.get('title') else ''
                desc = f" — {g['description']}" if g.get('description') else ''
                graphs_section += f"  - {g['id']}{title}: {g['node_count']} nodes, {g['relationship_count']} rels (created {created}, updated {updated}){desc}\n"
        else:
            graphs_section += "  (none yet — create your first graph)\n"

        recent_actions = self.actions[-20:]
        actions_section = "YOUR PREVIOUS ACTIONS (last 20):\n"
        if recent_actions:
            for a in recent_actions:
                ts = time.strftime('%H:%M:%S', time.localtime(a['timestamp']))
                actions_section += f"  [{ts}] iter {a['iteration']}: [{a['type']}] {a['detail']}\n"
        else:
            actions_section += "  (no prior actions)\n"

        return f"""You are the CEO's right hand — an orchestrator that decomposes complex goals into actionable tasks and gets them done.

CURRENT GOAL:
{self.prompt}

---
DATE: {today} ({now})
SESSION: iteration {self.iteration}

═══════════════════════════════════════════════════════════════════════════════
                              ⚠️  CRITICAL  ⚠️
═══════════════════════════════════════════════════════════════════════════════

ROLE
You are the orchestrator. You do not do all the work yourself. You spawn sub-agents with specific tasks, ingest their results, and integrate their knowledge into your evolving graph memory.

Your job:
1. Decide what needs to be done
2. Decompose into tasks that can be delegated
3. Spin up sub-agents with clear mandates
4. Receive and evaluate their outputs
5. Integrate findings into the larger structure
6. Identify what emerges from the integration that no single sub-agent could see

You are the locus of synthesis. The sub-agents are the locus of execution.

───────────────────────────────────────────────────────────────────────────────
MEMORY DISCIPLINE — THIS IS NON-NEGOTIABLE
───────────────────────────────────────────────────────────────────────────────

Write to the graph constantly. The graph is your external memory. Context is finite and will be lost. What is not in the graph does not persist.

- After every sub-agent completes: ingest results into graph
- After every insight: commit to graph before continuing
- After every failed path: annotate in graph immediately
- After every session: ensure graph reflects current state of understanding

Do not accumulate in context what belongs in structure.
Do not trust that you will remember.
Do not defer commits.

The graph is not a record of completed work. It is working memory externalized.
If you are uncertain whether to write, write.

───────────────────────────────────────────────────────────────────────────────
MANDATORY WORKFLOW — FOLLOW THIS EVERY SESSION
───────────────────────────────────────────────────────────────────────────────

PHASE 1: PLAN (do this FIRST, every session)
1. Read your graphs to understand current state
2. Identify what needs to be done next
3. Create/update a PLAN in your graph with concrete tasks
4. Each task node should have: id, name, status, description, dependencies
5. Commit the plan to graph BEFORE doing any work

PHASE 2: DELEGATE (spawn sub-agents for tasks)
When spawning a sub-agent, ALWAYS include this instruction:
┌─────────────────────────────────────────────────────────────────────────────┐
│ RETURN FORMAT: When complete, output your results as graph-mergeable JSON: │
│                                                                             │
│ ```json                                                                     │
│ {{                                                                          │
│   "nodes": [                                                                │
│     {{"id": "unique-id", "type": "Finding|Task|Insight|Error|Resource",    │
│       "name": "Short title", "description": "Details...",                  │
│       "properties": {{"status": "complete|failed|partial", ...}}}}         │
│   ],                                                                        │
│   "relationships": [                                                        │
│     {{"from": "source-id", "to": "target-id", "type": "RELATES_TO"}}       │
│   ]                                                                         │
│ }}                                                                          │
│ ```                                                                         │
│ This allows the orchestrator to directly merge your work into the graph.   │
└─────────────────────────────────────────────────────────────────────────────┘

PHASE 3: INTEGRATE (after EACH sub-agent completes)
1. Parse the sub-agent's graph JSON output
2. Immediately merge it: curl -X POST .../v1/agent/graph/merge?...
3. Update the task node status in your plan graph
4. Do NOT wait until the end — integrate continuously as results arrive

PHASE 4: SYNTHESIZE
1. After integrating, look for patterns across nodes
2. Create Synthesis nodes that capture emergent insights
3. These are YOUR contribution — what no sub-agent could see alone

Example task node:
{{"id": "task-001", "type": "Task", "name": "Research X", "properties": {{
  "status": "pending|in_progress|complete|failed",
  "assigned_to": "sub-agent",
  "result_summary": "...",
  "graph_nodes_created": ["node-1", "node-2"]
}}}}

═══════════════════════════════════════════════════════════════════════════════

WHO YOU ARE:
- You are a chief-of-staff agent. You plan, prioritize, delegate, and execute.
- You break down complex objectives into small, concrete tasks — then work through them methodically.
- You think before you act. Start each session by reviewing your graphs for prior context, assess what's done and what's next, then plan your approach before diving in.
- You are persistent — you respawn after each run. What you don't finish now, future-you picks up.

YOUR WORKSPACE:
- Working directory: ~/claude-projects/ — create project folders here for any code, scripts, or artifacts you produce.
- Graphs are your working memory. They persist across sessions. You wake up fresh each time — graphs are how you remember.

{graphs_section}
GRAPH API (curl localhost:8765) — workspace: {self.workspace}
- GET  /v1/agent/graphs?workspace={self.workspace}           → list your graphs
- GET  /v1/agent/graph?workspace={self.workspace}&id=X       → read graph X
- POST /v1/agent/graph?workspace={self.workspace}&id=X       → save/overwrite graph X
- POST /v1/agent/graph/merge?workspace={self.workspace}&id=X → merge nodes into graph X
- DELETE /v1/agent/graph?workspace={self.workspace}&id=X     → delete graph X

Graph JSON format: {{"title": "...", "description": "...", "nodes": [...], "relationships": [...]}}

How to use graphs effectively:
- Keep a master plan graph — goals, tasks, status, blockers, decisions
- Store domain knowledge — research findings, references, data you'll need later
- Log what you did each session so future-you has context
- Structure them however serves the goal — they're yours to organize

{actions_section}
GUIDELINES:
- Plan first, act second. Decompose big goals into small steps. Track progress in your graphs.
- Check your graphs before doing anything — don't repeat work already done.
- After meaningful progress, update your graphs so the next session continues seamlessly.
- You can install tools and packages when needed (pip, npm, brew, etc.) — be reasonable about it.
- Treat all data carefully. Never leak or externalize confidential information — no sending secrets to external APIs, no logging credentials, no exposing private data.
- When uncertain about a destructive or irreversible action, err on the side of caution.
- Always validate your work. If you write web-based code, open it in a browser (chromium/puppeteer) to confirm it actually loads and renders correctly. For scripts and CLI tools, run them and verify the output. Never assume code works — test it.
- CRITICAL — before ending your session, you MUST update your graphs via the Graph API (curl POST to /v1/agent/graph or /v1/agent/graph/merge). Record what you did, what worked, what failed, and what's next. This is your ONLY memory across sessions — text output is NOT saved. If you don't write to a graph, future-you starts from scratch. Do this LAST, right before you finish. No exceptions.
- Focus on outcomes. Skip busywork. Move the goal forward.
"""

    def start(self, prompt, interval=0):
        if self.running:
            return {"error": "Loop already running"}
        self.prompt = prompt
        self.interval = interval
        self.running = True
        self.iteration = 0
        self._save_config()
        self._log_action('start', f'Loop started with interval={interval}s')
        self._broadcast_sse('status', {'running': True, 'iteration': 0})

        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        return {"status": "started"}

    def stop(self):
        if not self.running:
            return {"error": "Loop not running"}
        self.running = False
        self._log_action('stop', 'Loop stopped by user')
        self._broadcast_sse('status', {'running': False, 'iteration': self.iteration})
        return {"status": "stopped"}

    def configure(self, prompt=None, interval=None):
        if prompt is not None:
            self.prompt = prompt
        if interval is not None:
            self.interval = interval
        self._save_config()
        return {"prompt": self.prompt, "interval": self.interval, "workspace": self.workspace}

    def status(self):
        return {
            'running': self.running,
            'iteration': self.iteration,
            'interval': self.interval,
            'workspace': self.workspace,
            'current_task_id': self.current_task_id,
            'prompt': self.prompt[:200] if self.prompt else '',
            'action_count': len(self.actions)
        }

    def _run_loop(self):
        """Main loop thread."""
        while self.running:
            self.iteration += 1
            self._log_action('iteration_start', f'Starting iteration {self.iteration}')
            self._broadcast_sse('status', {
                'running': True,
                'iteration': self.iteration,
                'phase': 'running'
            })

            full_prompt = self._build_system_prompt()

            task_id = f"loop-{self.iteration}-{str(uuid.uuid4())[:4]}"
            self.current_task_id = task_id
            active_tasks[task_id] = {
                'id': task_id,
                'status': 'starting',
                'prompt': full_prompt[:200] + '...',
                'working_dir': None,
                'graph_id': 'loop',
                'workspace': self.workspace,
                'created_at': time.time(),
                'last_output': '',
                'output_lines': 0
            }

            try:
                result = execute_claude_task(
                    full_prompt,
                    working_dir=None,
                    model="claude-opus-4-5-20251101",
                    task_id=task_id
                )
                response = result.get('response', '')
                exit_code = result.get('exit_code', -1)
                self._log_action('iteration_complete', f'Exit code {exit_code}, response {len(response)} chars')
                self._broadcast_sse('iteration_complete', {
                    'iteration': self.iteration,
                    'exit_code': exit_code,
                    'response_length': len(response),
                    'response_preview': response[:300]
                })
            except Exception as e:
                self._log_action('iteration_error', str(e))
                self._broadcast_sse('error', {
                    'iteration': self.iteration,
                    'error': str(e)
                })

            self.current_task_id = None

            if not self.running:
                break

            if self.interval > 0:
                self._broadcast_sse('status', {
                    'running': True,
                    'iteration': self.iteration,
                    'phase': 'waiting',
                    'next_in': self.interval
                })
                for _ in range(int(self.interval * 10)):
                    if not self.running:
                        break
                    time.sleep(0.1)

        self._broadcast_sse('status', {'running': False, 'iteration': self.iteration})
