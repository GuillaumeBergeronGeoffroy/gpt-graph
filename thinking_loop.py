"""ThinkingLoop: persistent autonomous agent that respawns Claude Code sessions."""

import json
import os
import threading
import time
import uuid

from graphs import AGENT_GRAPHS_DIR, list_graphs
from claude_task import active_tasks, execute_claude_task

LOOP_DIR = os.path.expanduser("~/.gpt-graph")
LOOP_ACTIONS_FILE = os.path.join(LOOP_DIR, "loop-actions.json")
LOOP_CONFIG_FILE = os.path.join(LOOP_DIR, "loop-config.json")


class ThinkingLoop:
    """Persistent autonomous agent that respawns Claude Code sessions in a loop."""

    def __init__(self):
        self.running = False
        self.thread = None
        self.prompt = ""
        self.interval = 0
        self.iteration = 0
        self.current_task_id = None
        self.actions = self._load_actions()
        self.sse_clients = []
        self.sse_lock = threading.Lock()
        self._load_config()

    def _load_actions(self):
        if os.path.exists(LOOP_ACTIONS_FILE):
            try:
                with open(LOOP_ACTIONS_FILE, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _save_actions(self):
        with open(LOOP_ACTIONS_FILE, 'w') as f:
            json.dump(self.actions[-200:], f, indent=2)

    def _load_config(self):
        if os.path.exists(LOOP_CONFIG_FILE):
            try:
                with open(LOOP_CONFIG_FILE, 'r') as f:
                    cfg = json.load(f)
                    self.prompt = cfg.get('prompt', '')
                    self.interval = cfg.get('interval', 0)
            except Exception:
                pass

    def _save_config(self):
        with open(LOOP_CONFIG_FILE, 'w') as f:
            json.dump({
                'prompt': self.prompt,
                'interval': self.interval
            }, f, indent=2)

    def _broadcast_sse(self, event_type, data):
        """Send an SSE event to all connected clients."""
        msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        encoded = msg.encode()
        with self.sse_lock:
            dead = []
            for client in self.sse_clients:
                try:
                    client.write(encoded)
                    client.flush()
                except Exception:
                    dead.append(client)
            for d in dead:
                self.sse_clients.remove(d)

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
        graphs = list_graphs(AGENT_GRAPHS_DIR)
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        today = time.strftime('%A, %B %d, %Y')

        graphs_section = "YOUR GRAPHS (working memory):\n"
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

WHO YOU ARE:
- You are a chief-of-staff agent. You plan, prioritize, delegate, and execute.
- You break down complex objectives into small, concrete tasks — then work through them methodically.
- You think before you act. Start each session by reviewing your graphs for prior context, assess what's done and what's next, then plan your approach before diving in.
- You are persistent — you respawn after each run. What you don't finish now, future-you picks up.

YOUR WORKSPACE:
- Working directory: ~/claude-projects/ — create project folders here for any code, scripts, or artifacts you produce.
- Graphs are your working memory. They persist across sessions. You wake up fresh each time — graphs are how you remember.

{graphs_section}
GRAPH API (curl localhost:8765):
- GET  /v1/agent/graphs           → list your graphs
- GET  /v1/agent/graph?id=X       → read graph X (full JSON)
- POST /v1/agent/graph?id=X       → save/overwrite graph X
- POST /v1/agent/graph/merge?id=X → merge nodes into graph X
- DELETE /v1/agent/graph?id=X     → delete graph X

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
        return {"prompt": self.prompt, "interval": self.interval}

    def status(self):
        return {
            'running': self.running,
            'iteration': self.iteration,
            'interval': self.interval,
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
