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
