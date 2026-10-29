"""Live registry of model calls, agent tasks and graph writes, so open Gestalt tabs can see who is working on a graph."""

import threading
import time
import uuid

RECENT_LIMIT = 40
LABEL_LIMIT = 140

_lock = threading.Lock()
_running = {}   # activity id -> entry
_recent = []    # finished entries and writes, oldest first
_listeners = []


def subscribe(fn):
    """fn(snapshot) is called after every change."""
    _listeners.append(fn)


def _clip(text):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= LABEL_LIMIT else text[:LABEL_LIMIT - 1] + '…'


def _entry(kind, graph_id, meta, **extra):
    meta = meta or {}
    return {
        'id': uuid.uuid4().hex[:10],
        'kind': kind,
        'graph_id': graph_id or None,
        'source': _clip(meta.get('source')) or None,
        'client_id': _clip(meta.get('client_id')) or None,
        'label': _clip(meta.get('label')) or None,
        **extra,
    }


def snapshot():
    with _lock:
        return {
            'server_time': time.time(),
            'running': sorted((dict(e) for e in _running.values()), key=lambda e: e['started_at']),
            'recent': [dict(e) for e in reversed(_recent)],
        }


def _changed():
    snap = snapshot()
    for fn in list(_listeners):
        try:
            fn(snap)
        except Exception as e:
            print(f"activity listener failed: {e}")


def start(kind, graph_id, meta=None, model=None, effort=None, task_id=None):
    """Register work that has started; returns its id for finish()."""
    entry = _entry(kind, graph_id, meta, model=model, effort=effort, task_id=task_id,
                   started_at=time.time(), status='running')
    with _lock:
        _running[entry['id']] = entry
    _changed()
    return entry['id']


def finish(activity_id, status='done'):
    with _lock:
        entry = _running.pop(activity_id, None)
        if entry is None:
            return
        entry['status'] = status
        entry['ended_at'] = time.time()
        _recent.append(entry)
        del _recent[:-RECENT_LIMIT]
    _changed()


def record(kind, graph_id, meta=None, detail=None):
    """Note an instant event, such as a merge into a graph."""
    now = time.time()
    entry = _entry(kind, graph_id, meta, detail=_clip(detail) or None,
                   started_at=now, ended_at=now, status='done')
    with _lock:
        _recent.append(entry)
        del _recent[:-RECENT_LIMIT]
    _changed()


def request_meta(request, params=None):
    """Who is asking and why, from a JSON body (or, for writes, the query string)."""
    params = params or {}
    return {k: request.get(k) or params.get(k) for k in ('source', 'client_id', 'label')}
