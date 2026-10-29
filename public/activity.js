// Live view of who else is working on the open graph: model calls, agent tasks and merges,
// from this tab, other tabs, council seats and refresh jobs

const ACTIVITY_TAB_ID = Math.random().toString(36).slice(2, 10);
const ACTIVITY_RECENT_MS = 30 * 60 * 1000;

let activityState = { running: [], recent: [] };
let activityClockOffset = 0; // server clock minus this clock, in ms

// Fields every Claude request from this tab carries, so other tabs (and this one) can see it in flight
function activityMeta(label) {
    return { graph_id: currentGraphId || 'default', source: 'ui', client_id: ACTIVITY_TAB_ID, label };
}

function watchActivity(source) {
    const panel = document.getElementById('activity');
    if (!panel) return;
    try {
        panel.classList.toggle('open', localStorage.getItem('gestalt-activity-open') === '1');
    } catch (e) { /* storage unavailable: start closed */ }

    source.addEventListener('activity', (e) => applyActivity(JSON.parse(e.data)));
    // EventSource reconnects by itself; catch up on whatever started or ended while it was away
    source.addEventListener('open', fetchActivity);
    fetchActivity();
    setInterval(renderActivity, 1000);
}

async function fetchActivity() {
    try {
        const response = await fetch(`${SERVER_URL}/v1/activity`);
        if (response.ok) applyActivity(await response.json());
    } catch (e) { /* server down: keep the last view */ }
}

function applyActivity(snapshot) {
    activityClockOffset = snapshot.server_time * 1000 - Date.now();
    activityState = { running: snapshot.running || [], recent: snapshot.recent || [] };
    renderActivity();
}

function toggleActivity() {
    const panel = document.getElementById('activity');
    panel.classList.toggle('open');
    try {
        localStorage.setItem('gestalt-activity-open', panel.classList.contains('open') ? '1' : '0');
    } catch (e) { /* not remembered */ }
}

function activityWho(entry) {
    if (entry.source === 'ui') return entry.client_id === ACTIVITY_TAB_ID ? 'this tab' : 'another tab';
    if (entry.source?.startsWith('council:')) return entry.source.slice('council:'.length) + ' seat';
    return entry.source || (entry.kind === 'write' ? 'API' : 'unknown');
}

function activityDuration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function activityAgo(seconds) {
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
}

function escapeActivity(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function activityRow(entry, now) {
    const who = activityWho(entry);
    const what = entry.label || (entry.kind === 'task' ? `agent task ${entry.task_id || ''}` : 'model call');
    const meta = [];
    if (entry.model) meta.push(entry.model.replace(/^claude-/, '') + (entry.effort ? ` · ${entry.effort}` : ''));
    if (entry.status === 'running') {
        meta.push(activityDuration(now - entry.started_at));
        if (!entry.graph_id) meta.push('graph not given');
    } else if (entry.kind === 'write') {
        meta.push(entry.detail || 'merged', activityAgo(now - entry.ended_at));
    } else {
        meta.push(`${entry.status === 'failed' ? 'failed after' : 'took'} ${activityDuration(entry.ended_at - entry.started_at)}`,
                  activityAgo(now - entry.ended_at));
    }
    const mark = entry.status === 'running' ? '' : entry.status === 'failed' ? '✗ ' : entry.kind === 'write' ? '✎ ' : '✓ ';
    return `<div class="activity-row ${entry.status}">
        <div class="activity-what">${mark}${escapeActivity(what)}</div>
        <div class="activity-meta"><span class="activity-who ${who === 'this tab' ? 'mine' : ''}">${escapeActivity(who)}</span>
        ${meta.map(m => `<span>${escapeActivity(m)}</span>`).join('')}</div>
    </div>`;
}

function renderActivity() {
    const panel = document.getElementById('activity');
    if (!panel) return;
    const now = (Date.now() + activityClockOffset) / 1000;
    const onGraph = (e) => e.graph_id === (currentGraphId || 'default');

    // Calls that did not say which graph they are on could be on this one, so show them too
    const running = activityState.running.filter(e => onGraph(e) || !e.graph_id);
    const elsewhere = activityState.running.length - running.length;
    const recent = activityState.recent.filter(e => onGraph(e) && (now - e.ended_at) * 1000 < ACTIVITY_RECENT_MS);
    const mine = running.filter(e => e.source === 'ui' && e.client_id === ACTIVITY_TAB_ID).length;

    panel.classList.toggle('busy', running.length > 0);
    let summary = running.length ? `${running.length} running` : 'idle';
    if (mine) summary += mine === running.length ? ' (this tab)' : ` (${mine} from this tab)`;
    if (elsewhere) summary += ` · ${elsewhere} on other graphs`;
    document.getElementById('activity-summary').textContent = summary;

    document.getElementById('activity-panel').innerHTML =
        `<div class="activity-heading">In flight on this graph</div>` +
        (running.length ? running.map(e => activityRow(e, now)).join('') : '<div class="activity-empty">Nothing running</div>') +
        `<div class="activity-heading">Last 30 minutes</div>` +
        (recent.length ? recent.map(e => activityRow(e, now)).join('') : '<div class="activity-empty">Nothing yet</div>');
}
