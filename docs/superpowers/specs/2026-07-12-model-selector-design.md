# Model Selector — Design

**Date:** 2026-07-12
**Status:** Approved

## Goal

Let the user switch the Claude model used by gpt-graph (chat, suggestions, tasks, grounding, merge, and the background thinking loop) instead of the hardcoded `claude-opus-4-6`. Models are passed to the Claude Code CLI via `--model`; no API/SDK work is involved.

## Models

Offered in the settings dropdown, in this order:

| Label | ID |
|---|---|
| Opus 4.8 (default) | `claude-opus-4-8` |
| Fable 5 | `claude-fable-5` |
| Sonnet 5 | `claude-sonnet-5` |
| Sonnet 4.6 | `claude-sonnet-4-6` |

Default everywhere: `claude-opus-4-8`.

## Frontend

- **New `public/settings.js`:**
  - `MODELS` constant (list above).
  - `getSelectedModel()` — reads `localStorage["gptgraph-model"]`; returns `claude-opus-4-8` if unset or not in `MODELS`.
  - `setSelectedModel(id)` — writes localStorage.
  - Settings modal open/close + save handlers. On save: persist to localStorage and POST `/v1/loop/configure` with `{workspace: currentWorkspace, model}` so the brain loop follows.
- **`public/index.html`:** ⚙ button in the header; settings modal markup (dropdown + Save), styled like existing modals; `<script src="settings.js">` before `prompt.js`.
- **`public/prompt.js`:** replace all 8 hardcoded `model: "claude-opus-4-6"` occurrences with `model: getSelectedModel()`.

## Backend

- **`thinking_loop.py`:** add `self.model` (default `claude-opus-4-8`) to per-workspace loop config — initialized in `__init__`, read in `_load_config`, written in `_save_config`, settable via `configure(model=...)`. Use `self.model` in the `execute_claude_task(...)` call (line ~415) instead of the hardcoded string.
- **`handler.py`:**
  - `/v1/loop/configure` passes `model` through to `loop.configure()`.
  - Replace stale defaults: `claude-sonnet-4-20250514` (deprecated) and `claude-opus-4-6` fallbacks → `claude-opus-4-8`.
- **`claude_task.py`:** default `model=` parameters on `call_claude` and `execute_claude_task` → `claude-opus-4-8`.

## Error handling

The model string becomes a CLI `--model` flag; an invalid value fails via the existing non-zero-returncode path with the CLI's stderr surfaced. Unknown localStorage values fall back to the default in `getSelectedModel()`.

## Testing

Manual verification:
1. Start the server, open the UI, open settings, pick each model, save.
2. Send a chat message; confirm the server log shows the CLI invoked with the chosen `--model`.
3. Confirm `~/.gpt-graph/loops/<workspace>-config.json` contains the chosen `model` after save and the thinking loop uses it.
4. Reload the page; confirm the selection persists.

## Notes

- Fable 5 runs through the Claude Code CLI, so no API changes are needed, but turns can run longer and cyber/bio-adjacent prompts may be refused — relevant for the unattended thinking loop.
