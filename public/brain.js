// Brain Dashboard - Thinking Loop frontend
// SSE connection + controls for autonomous agent loop

let brainSSE = null;
let brainOpen = false;
let brainWorkspace = 'default';

function openBrainDashboard() {
  const modal = document.getElementById('brain-modal');
  modal.classList.remove('hidden');
  brainOpen = true;
  connectBrainSSE();
  refreshBrainStatus();
}

function closeBrainDashboard() {
  document.getElementById('brain-modal').classList.add('hidden');
  brainOpen = false;
  if (brainSSE) {
    brainSSE.close();
    brainSSE = null;
  }
}

function connectBrainSSE() {
  if (brainSSE) brainSSE.close();

  brainSSE = new EventSource('http://localhost:8765/v1/loop/stream');

  brainSSE.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    updateBrainStatus(data);
  });

  brainSSE.addEventListener('action', (e) => {
    const data = JSON.parse(e.data);
    appendBrainAction(data);
  });

  brainSSE.addEventListener('iteration_complete', (e) => {
    const data = JSON.parse(e.data);
    appendBrainAction({
      type: 'iteration_complete',
      detail: `Iteration ${data.iteration} done (exit ${data.exit_code}, ${data.response_length} chars)`,
      timestamp: Date.now() / 1000,
      iteration: data.iteration
    });
  });

  brainSSE.addEventListener('error', (e) => {
    const data = e.data ? JSON.parse(e.data) : {};
    appendBrainAction({
      type: 'error',
      detail: data.error || 'Connection error',
      timestamp: Date.now() / 1000,
      iteration: data.iteration || 0
    });
  });

  brainSSE.onerror = () => {
    // SSE reconnects automatically, update indicator
    const indicator = document.getElementById('brain-connection');
    if (indicator) indicator.className = 'brain-dot disconnected';
    setTimeout(() => {
      if (indicator) indicator.className = 'brain-dot connected';
    }, 2000);
  };
}

function updateBrainStatus(data) {
  const statusEl = document.getElementById('brain-status-text');
  const iterEl = document.getElementById('brain-iteration');
  const startBtn = document.getElementById('brain-start-btn');
  const stopBtn = document.getElementById('brain-stop-btn');
  const indicator = document.getElementById('brain-indicator');

  if (statusEl) {
    if (data.running) {
      const phase = data.phase || 'running';
      statusEl.textContent = phase === 'waiting'
        ? `Waiting (next in ${data.next_in}s)`
        : 'Running';
      statusEl.className = 'brain-status active';
    } else {
      statusEl.textContent = 'Stopped';
      statusEl.className = 'brain-status stopped';
    }
  }

  if (iterEl) iterEl.textContent = data.iteration || 0;
  if (startBtn) startBtn.disabled = data.running;
  if (stopBtn) stopBtn.disabled = !data.running;
  if (indicator) indicator.className = data.running ? 'brain-indicator active' : 'brain-indicator';
}

async function refreshBrainStatus() {
  try {
    const res = await fetch('http://localhost:8765/v1/loop/status');
    const data = await res.json();
    updateBrainStatus(data);

    // Sync workspace from server
    if (data.workspace) {
      brainWorkspace = data.workspace;
      const wsSelect = document.getElementById('brain-workspace');
      if (wsSelect) wsSelect.value = brainWorkspace;
    }

    // Also load prompt into editor if present
    if (data.prompt) {
      const editor = document.getElementById('brain-prompt');
      if (editor && !editor.value) editor.value = data.prompt;
    }

    // Load actions
    const actRes = await fetch('http://localhost:8765/v1/loop/actions?limit=50');
    const actData = await actRes.json();
    const feed = document.getElementById('brain-feed');
    if (feed) {
      feed.innerHTML = '';
      (actData.actions || []).forEach(a => appendBrainAction(a));
    }

    // Load workspaces and graphs
    await refreshBrainWorkspaces();
    await refreshBrainGraphs();
  } catch (e) {
    console.error('Brain status error:', e);
  }
}

async function refreshBrainWorkspaces() {
  try {
    const res = await fetch('http://localhost:8765/v1/workspaces');
    const data = await res.json();
    const select = document.getElementById('brain-workspace');
    if (!select) return;

    select.innerHTML = '';
    (data.workspaces || []).forEach(ws => {
      const opt = document.createElement('option');
      opt.value = ws.id;
      opt.textContent = `${ws.id} (${ws.graph_count} graphs)`;
      if (ws.id === brainWorkspace) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('Failed to load workspaces:', e);
  }
}

async function switchBrainWorkspace(workspace) {
  brainWorkspace = workspace;
  try {
    await fetch('http://localhost:8765/v1/loop/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace })
    });
  } catch (e) {
    console.error('Failed to switch workspace:', e);
  }
  await refreshBrainGraphs();
}

async function createBrainWorkspace() {
  const name = prompt('Enter new workspace name:');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('http://localhost:8765/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    if (res.ok) {
      await refreshBrainWorkspaces();
      const select = document.getElementById('brain-workspace');
      if (select) {
        select.value = name.trim();
        switchBrainWorkspace(name.trim());
      }
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to create workspace');
    }
  } catch (e) {
    alert('Failed to create workspace: ' + e.message);
  }
}

async function deleteBrainWorkspace() {
  if (brainWorkspace === 'default') {
    alert('Cannot delete the default workspace');
    return;
  }
  if (!confirm(`Delete workspace "${brainWorkspace}" and ALL its graphs? This cannot be undone.`)) return;
  try {
    const res = await fetch(`http://localhost:8765/v1/workspaces?name=${encodeURIComponent(brainWorkspace)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      brainWorkspace = 'default';
      await refreshBrainWorkspaces();
      const select = document.getElementById('brain-workspace');
      if (select) select.value = 'default';
      await refreshBrainGraphs();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to delete workspace');
    }
  } catch (e) {
    alert('Failed to delete workspace: ' + e.message);
  }
}

async function refreshBrainGraphs() {
  try {
    const res = await fetch(`http://localhost:8765/v1/agent/graphs?workspace=${encodeURIComponent(brainWorkspace)}`);
    const data = await res.json();
    const list = document.getElementById('brain-graphs');
    if (!list) return;

    list.innerHTML = '';
    (data.graphs || []).forEach(g => {
      const div = document.createElement('div');
      div.className = 'brain-graph-item';
      const mod = new Date(g.modified_at * 1000).toLocaleString();
      div.innerHTML = `
        <span class="brain-graph-name">${g.title || g.id}</span>
        <span class="brain-graph-meta">${g.node_count}n / ${g.relationship_count}r</span>
        <span class="brain-graph-time">${mod}</span>
        <button class="brain-graph-delete" onclick="deleteBrainGraph('${g.id}', event)" title="Delete">&times;</button>
      `;
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Brain graphs error:', e);
  }
}

async function deleteBrainGraph(graphId, event) {
  event.stopPropagation();
  if (!confirm(`Delete graph "${graphId}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`http://localhost:8765/v1/agent/graph?workspace=${encodeURIComponent(brainWorkspace)}&id=${encodeURIComponent(graphId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      console.log('Deleted graph:', graphId);
      refreshBrainGraphs();
    } else {
      alert('Failed to delete graph');
    }
  } catch (e) {
    console.error('Delete error:', e);
    alert('Failed to delete: ' + e.message);
  }
}

function appendBrainAction(action) {
  const feed = document.getElementById('brain-feed');
  if (!feed) return;

  const div = document.createElement('div');
  div.className = `brain-action brain-action-${action.type}`;

  const ts = new Date(action.timestamp * 1000).toLocaleTimeString();
  const typeLabel = action.type.replace(/_/g, ' ');

  div.innerHTML = `
    <span class="brain-action-time">${ts}</span>
    <span class="brain-action-iter">#${action.iteration}</span>
    <span class="brain-action-type">${typeLabel}</span>
    <span class="brain-action-detail">${typeof action.detail === 'string' ? action.detail : JSON.stringify(action.detail)}</span>
  `;

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

async function startBrainLoop() {
  const prompt = document.getElementById('brain-prompt').value.trim();
  if (!prompt) {
    alert('Enter a goal/prompt for the agent');
    return;
  }

  const intervalInput = document.getElementById('brain-interval');
  const interval = intervalInput ? parseFloat(intervalInput.value) || 0 : 0;

  try {
    const res = await fetch('http://localhost:8765/v1/loop/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, interval })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    }
  } catch (e) {
    alert('Failed to start loop: ' + e.message);
  }
}

async function stopBrainLoop() {
  try {
    await fetch('http://localhost:8765/v1/loop/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (e) {
    alert('Failed to stop loop: ' + e.message);
  }
}

async function configureBrainLoop() {
  const prompt = document.getElementById('brain-prompt').value.trim();
  const intervalInput = document.getElementById('brain-interval');
  const interval = intervalInput ? parseFloat(intervalInput.value) || 0 : 0;

  try {
    await fetch('http://localhost:8765/v1/loop/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, interval })
    });
  } catch (e) {
    console.error('Configure error:', e);
  }
}
