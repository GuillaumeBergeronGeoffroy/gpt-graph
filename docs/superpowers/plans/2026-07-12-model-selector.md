# Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings modal that lets the user pick the Claude model (Opus 4.8 / Fable 5 / Sonnet 5 / Sonnet 4.6) used by every Claude call in gpt-graph, including the background thinking loop.

**Architecture:** The app shells out to the Claude Code CLI (`claude -p ... --model X`). The backend (`handler.py`) already accepts a per-request `model` field; the frontend hardcodes `claude-opus-4-6`. We add a localStorage-backed selector (`public/settings.js` + a ⚙ modal in `index.html`), swap the hardcoded frontend model strings for `getSelectedModel()`, and persist the model into the per-workspace thinking-loop config so the server-side loop follows it.

**Tech Stack:** Vanilla JS frontend (no framework, global functions across `<script>` tags), Python stdlib HTTP server backend. No test suite exists — each task ends with syntax checks and concrete manual/CLI verification.

## Global Constraints

- Model IDs, exactly: `claude-opus-4-8` (default), `claude-fable-5`, `claude-sonnet-5`, `claude-sonnet-4-6`.
- Default model everywhere: `claude-opus-4-8`.
- localStorage key: `gptgraph-model`.
- No new dependencies; follow existing code style (global functions, existing modal CSS patterns).
- Server runs on `http://localhost:8765`.

---

### Task 1: Backend default model bump

**Files:**
- Modify: `claude_task.py:129` and `claude_task.py:158`
- Modify: `handler.py:127-129` and `handler.py:152`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: backend defaults of `claude-opus-4-8` when a request omits `model`. No signature changes — `call_claude(prompt, model)`, `execute_claude_task(prompt, working_dir, model, task_id)` keep their shapes.

- [ ] **Step 1: Update `claude_task.py` defaults**

Change line 129:

```python
def call_claude(prompt: str, model: str = "claude-opus-4-8") -> str:
```

Change line 158:

```python
def execute_claude_task(prompt: str, working_dir: str = None, model: str = "claude-opus-4-8", task_id: str = None) -> dict:
```

- [ ] **Step 2: Update `handler.py` chat + execute defaults**

Change lines 127–129 (in the `/v1/completions` branch):

```python
                model = request.get('model', 'claude-opus-4-8')
                if 'gpt' in model or 'davinci' in model:
                    model = 'claude-opus-4-8'
```

Change line 152 (in the `/v1/execute` branch):

```python
                model = request.get('model', 'claude-opus-4-8')
```

- [ ] **Step 3: Verify syntax and that no old defaults remain in these two files**

Run: `python3 -m py_compile claude_task.py handler.py && grep -n "claude-opus-4-6\|claude-sonnet-4-20250514" claude_task.py handler.py; echo "exit: $?"`
Expected: no grep matches in these two files (`exit: 1` from grep is the success signal), no compile errors.

- [ ] **Step 4: Commit**

```bash
git add claude_task.py handler.py
git commit -m "Bump backend default Claude model to claude-opus-4-8"
```

---

### Task 2: Thinking loop model config

**Files:**
- Modify: `thinking_loop.py` (`__init__` ~line 113, `_load_config` ~line 138, `_save_config` ~line 149, `configure` ~line 365, `execute_claude_task` call ~line 412)
- Modify: `handler.py:281-292` (`/v1/loop/configure`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ThinkingLoop.configure(prompt=None, interval=None, model=None)` — `model` is a model-ID string or `None` (leave unchanged); the returned dict gains a `"model"` key. `POST /v1/loop/configure` accepts optional `"model"` in the JSON body (Task 3's save handler calls this).

- [ ] **Step 1: Add `self.model` to `ThinkingLoop.__init__`**

After `self.prompt = ""` (line 113), add:

```python
        self.model = "claude-opus-4-8"
```

- [ ] **Step 2: Load and save the model in the config file**

In `_load_config`, after `self.interval = cfg.get('interval', 0)`:

```python
                    self.model = cfg.get('model', 'claude-opus-4-8')
```

In `_save_config`, the dumped dict becomes:

```python
            json.dump({
                'prompt': self.prompt,
                'interval': self.interval,
                'model': self.model,
                'workspace': self.workspace
            }, f, indent=2)
```

- [ ] **Step 3: Accept `model` in `configure()`**

Replace lines 365–371 with:

```python
    def configure(self, prompt=None, interval=None, model=None):
        if prompt is not None:
            self.prompt = prompt
        if interval is not None:
            self.interval = interval
        if model is not None:
            self.model = model
        self._save_config()
        return {"prompt": self.prompt, "interval": self.interval, "model": self.model, "workspace": self.workspace}
```

- [ ] **Step 4: Use the configured model in the loop's task execution**

At lines 412–417, replace the hardcoded string:

```python
                result = execute_claude_task(
                    full_prompt,
                    working_dir=None,
                    model=self.model,
                    task_id=task_id
                )
```

- [ ] **Step 5: Pass `model` through `/v1/loop/configure` in `handler.py`**

Replace the `loop.configure(...)` call (lines 286–289) with:

```python
                result = loop.configure(
                    prompt=req.get('prompt'),
                    interval=req.get('interval'),
                    model=req.get('model')
                )
```

- [ ] **Step 6: Verify syntax and no stragglers**

Run: `python3 -m py_compile thinking_loop.py handler.py && grep -n "claude-opus-4-6" thinking_loop.py; echo "exit: $?"`
Expected: compiles clean; grep finds nothing (`exit: 1`).

- [ ] **Step 7: Runtime check of the configure endpoint**

Run (server must be running; start with `python3 server.py &` if not):

```bash
curl -s -X POST http://localhost:8765/v1/loop/configure \
  -H 'Content-Type: application/json' \
  -d '{"workspace": "default", "model": "claude-sonnet-4-6"}'
cat ~/.gpt-graph/loops/default-config.json
```

Expected: response JSON contains `"model": "claude-sonnet-4-6"`, and the config file on disk contains the same. Then reset: re-run the curl with `"model": "claude-opus-4-8"`.

- [ ] **Step 8: Commit**

```bash
git add thinking_loop.py handler.py
git commit -m "Add per-workspace model to thinking loop config"
```

---

### Task 3: Settings module and modal UI

**Files:**
- Create: `public/settings.js`
- Modify: `public/index.html` (⚙ button ~line 132, modal markup after the graph-selector modal ~line 215, script tag ~line 218)
- Modify: `public/css/index.css` (append settings-modal styles at end of file)

**Interfaces:**
- Consumes: `POST /v1/loop/configure` with `{workspace, model}` (Task 2). `brainWorkspace` — a top-level `let` in `brain.js` holding the active workspace; may be undefined if brain.js changes, so guard with `typeof`.
- Produces: `getSelectedModel(): string` — the model ID from localStorage, falling back to `'claude-opus-4-8'` for unset/unknown values. Also `setSelectedModel(id)`, `openSettingsModal()`, `closeSettingsModal()`, `saveSettings()` as globals. Task 4 depends on `getSelectedModel()`.

- [ ] **Step 1: Create `public/settings.js`**

```javascript
// Settings: Claude model selection, persisted in localStorage.

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8 (default)' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
];
const DEFAULT_MODEL = 'claude-opus-4-8';
const MODEL_STORAGE_KEY = 'gptgraph-model';

function getSelectedModel() {
  const stored = localStorage.getItem(MODEL_STORAGE_KEY);
  return MODELS.some(m => m.id === stored) ? stored : DEFAULT_MODEL;
}

function setSelectedModel(id) {
  localStorage.setItem(MODEL_STORAGE_KEY, id);
}

function openSettingsModal() {
  const select = document.getElementById('model-select');
  select.innerHTML = '';
  MODELS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    select.appendChild(opt);
  });
  select.value = getSelectedModel();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const model = document.getElementById('model-select').value;
  setSelectedModel(model);
  // Keep the server-side thinking loop on the same model.
  const workspace = (typeof brainWorkspace !== 'undefined') ? brainWorkspace : 'default';
  try {
    await fetch('http://localhost:8765/v1/loop/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, model }),
    });
  } catch (e) {
    console.error('Failed to update thinking loop model:', e);
  }
  closeSettingsModal();
}
```

- [ ] **Step 2: Add the ⚙ button to `public/index.html`**

Immediately before `<div id="clear-button" ...>` (line 132), add:

```html
    <div id="settings-button" class="buttons" onclick="openSettingsModal()" title="Settings">⚙</div>
```

- [ ] **Step 3: Add the settings modal markup**

After the closing `</div>` of the graph-selector modal (the `<div id="graph-selector-modal">...` block ending ~line 215), add:

```html
  <!-- Settings Modal -->
  <div id="settings-modal" class="hidden">
    <div class="selector-content">
      <div class="selector-header">
        <span>Settings</span>
        <span class="selector-close" onclick="closeSettingsModal()">&times;</span>
      </div>
      <div class="settings-body">
        <label for="model-select">Claude model</label>
        <select id="model-select"></select>
        <button class="settings-save-btn" onclick="saveSettings()">Save</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Include the script before `prompt.js`**

Change the script block (lines 217–225) so `settings.js` loads after `storage.js` and before `prompt.js`:

```html
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="storage.js"></script>
  <script src="settings.js"></script>
  <script src="prompt.js"></script>
```

(The remaining script tags stay unchanged.)

- [ ] **Step 5: Append modal styles to `public/css/index.css`**

The settings modal reuses `.selector-content` / `.selector-header` / `.selector-close`; only the overlay and body need new rules. Append at the end of the file:

```css
    #settings-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #settings-modal.hidden {
      display: none;
    }
    .settings-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 20px;
    }
    .settings-body label {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
    }
    .settings-body select {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
    }
    .settings-save-btn {
      background: linear-gradient(135deg, rgba(63, 81, 181, 0.9), rgba(103, 58, 183, 0.8));
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 0;
      font-size: 14px;
      cursor: pointer;
    }
    .settings-save-btn:hover {
      filter: brightness(1.15);
    }
```

- [ ] **Step 6: Syntax-check the new JS**

Run: `node --check public/settings.js`
Expected: no output (clean parse).

- [ ] **Step 7: Manual UI check**

Start the server (`python3 server.py &`), open `http://localhost:8765`, click ⚙. Expected: modal opens with the 4 models, "Opus 4.8 (default)" preselected. Pick "Fable 5", Save. In DevTools console: `localStorage.getItem('gptgraph-model')` → `"claude-fable-5"`, and `cat ~/.gpt-graph/loops/default-config.json` shows `"model": "claude-fable-5"`. Reset to Opus 4.8 via the modal.

- [ ] **Step 8: Commit**

```bash
git add public/settings.js public/index.html public/css/index.css
git commit -m "Add settings modal with Claude model selector"
```

---

### Task 4: Route all frontend Claude calls through the selector

**Files:**
- Modify: `public/prompt.js` lines 799, 1011, 1350, 1519, 2090, 2224, 2300, 3925

**Interfaces:**
- Consumes: `getSelectedModel()` from Task 3 (global, loaded before `prompt.js`).
- Produces: every Claude request body in `prompt.js` carries the selected model.

- [ ] **Step 1: Replace all 8 hardcoded model strings**

Every occurrence in `public/prompt.js` is the identical property line inside a request body:

```javascript
      model: "claude-opus-4-6",
```

Replace each (lines 799, 1011, 1350, 1519, 2090, 2224, 2300, 3925 — indentation varies) with:

```javascript
      model: getSelectedModel(),
```

- [ ] **Step 2: Verify no hardcoded models remain in the frontend**

Run: `node --check public/prompt.js && grep -rn "claude-opus-4-6" public/; echo "exit: $?"`
Expected: clean parse; grep finds nothing (`exit: 1`).

- [ ] **Step 3: Manual smoke test**

With the server running and model set to Sonnet 4.6 in the modal, send a chat message from the UI. Expected: server stdout shows the CLI invocation and the task/chat runs with `--model claude-sonnet-4-6` (the `call_claude` banner prints the prompt; the `cmd` includes the model — confirm via the printed `Using Claude binary` process or by checking `ps aux | grep "claude"` during the call, or simply confirm the response arrives and no error). Reset model to Opus 4.8.

- [ ] **Step 4: Commit**

```bash
git add public/prompt.js
git commit -m "Use selected model for all frontend Claude calls"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full flow check**

1. Restart the server so all Python changes load: kill any running `server.py`, then `python3 server.py &`.
2. Hard-reload the UI (Cmd+Shift+R) so new JS/CSS load.
3. ⚙ → select each of the 4 models in turn → Save → confirm `localStorage.getItem('gptgraph-model')` matches each time.
4. With "Sonnet 4.6" selected: send a chat message; confirm a normal response and no 500.
5. Confirm `~/.gpt-graph/loops/default-config.json` contains the last saved model.
6. Reload the page; ⚙ shows the persisted selection.
7. Set final selection to "Opus 4.8 (default)".

Expected: all steps pass with no console or server errors.

- [ ] **Step 2: Verify clean tree and log**

Run: `git status --short && git log --oneline -5`
Expected: clean tree; four implementation commits atop the spec commit.
