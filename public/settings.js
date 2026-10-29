// Settings: Claude model and effort selection, persisted in localStorage.

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (default)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
];
const DEFAULT_MODEL = 'claude-opus-5-5';
const MODEL_STORAGE_KEY = 'gptgraph-model';

// '' means no --effort flag: the CLI picks the model's own default.
const EFFORTS = [
  { id: '', label: 'Model default' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];
const DEFAULT_EFFORT = '';
const EFFORT_STORAGE_KEY = 'gptgraph-effort';

function getSelectedModel() {
  const stored = localStorage.getItem(MODEL_STORAGE_KEY);
  return MODELS.some(m => m.id === stored) ? stored : DEFAULT_MODEL;
}

function setSelectedModel(id) {
  localStorage.setItem(MODEL_STORAGE_KEY, id);
}

function getSelectedEffort() {
  const stored = localStorage.getItem(EFFORT_STORAGE_KEY);
  return EFFORTS.some(e => e.id === stored) ? stored : DEFAULT_EFFORT;
}

function setSelectedEffort(id) {
  localStorage.setItem(EFFORT_STORAGE_KEY, id);
}

function fillSelect(select, options, value) {
  select.innerHTML = '';
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    select.appendChild(opt);
  });
  select.value = value;
}

function openSettingsModal() {
  fillSelect(document.getElementById('model-select'), MODELS, getSelectedModel());
  fillSelect(document.getElementById('effort-select'), EFFORTS, getSelectedEffort());
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const model = document.getElementById('model-select').value;
  const effort = document.getElementById('effort-select').value;
  setSelectedModel(model);
  setSelectedEffort(effort);
  // Keep the server-side thinking loop on the same model and effort.
  const workspace = (typeof brainWorkspace !== 'undefined') ? brainWorkspace : 'default';
  try {
    await fetch('http://localhost:8765/v1/loop/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, model, effort }),
    });
  } catch (e) {
    console.error('Failed to update thinking loop settings:', e);
  }
  closeSettingsModal();
}
