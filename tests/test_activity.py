"""Tests for the live activity registry and the routes that feed it. Run: python3 -m unittest discover tests"""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import activity


def reset_activity():
    activity._running.clear()
    activity._recent.clear()


class RegistryTest(unittest.TestCase):
    def setUp(self):
        reset_activity()
        self.snapshots = []
        activity.subscribe(self.snapshots.append)
        self.addCleanup(activity._listeners.remove, self.snapshots.append)

    def test_start_then_finish_moves_entry_to_recent(self):
        aid = activity.start('call', 'g', {'source': 'council:improvement', 'label': 'synth: x'}, model='m', effort='max')
        running = self.snapshots[-1]['running']
        self.assertEqual([(e['id'], e['graph_id'], e['source'], e['status']) for e in running],
                         [(aid, 'g', 'council:improvement', 'running')])

        activity.finish(aid, 'failed')
        snap = self.snapshots[-1]
        self.assertEqual(snap['running'], [])
        self.assertEqual(snap['recent'][0]['status'], 'failed')
        self.assertGreaterEqual(snap['recent'][0]['ended_at'], snap['recent'][0]['started_at'])

    def test_finish_twice_is_harmless(self):
        aid = activity.start('task', 'g')
        activity.finish(aid)
        activity.finish(aid)
        self.assertEqual(len(activity.snapshot()['recent']), 1)

    def test_recent_is_newest_first_and_bounded(self):
        for i in range(activity.RECENT_LIMIT + 5):
            activity.record('write', 'g', {'label': f'merge {i}'})
        recent = activity.snapshot()['recent']
        self.assertEqual(len(recent), activity.RECENT_LIMIT)
        self.assertEqual(recent[0]['label'], f'merge {activity.RECENT_LIMIT + 4}')

    def test_labels_are_flattened_and_clipped(self):
        activity.record('write', 'g', {'label': 'line one\nline two  ' + 'x' * 500})
        label = activity.snapshot()['recent'][0]['label']
        self.assertTrue(label.startswith('line one line two x'))
        self.assertEqual(len(label), activity.LABEL_LIMIT)

    def test_a_failing_listener_does_not_break_others(self):
        def broken(snap):
            raise RuntimeError('boom')
        activity._listeners.insert(0, broken)
        self.addCleanup(activity._listeners.remove, broken)
        activity.record('write', 'g')
        self.assertEqual(len(self.snapshots), 1)


class ActivityRoutesTest(unittest.TestCase):
    """A real server on a free port, with the model calls stubbed out."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        import graphs, claude_task
        cls.patches = [mock.patch.object(graphs, 'GRAPHS_DIR', cls.tmp.name),
                       mock.patch.object(claude_task, 'TASKS_DIR', cls.tmp.name)]
        for p in cls.patches:
            p.start()
        import handler
        from server import ThreadedHTTPServer
        cls.handler = handler
        cls.server = ThreadedHTTPServer(('127.0.0.1', 0), handler.CORSRequestHandler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def setUp(self):
        reset_activity()

    def call(self, method, path, body=None):
        req = urllib.request.Request(self.url + path, method=method, headers={'Content-Type': 'application/json'},
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())

    def wait_for(self, predicate, timeout=5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            snap = self.call('GET', '/v1/activity')
            if predicate(snap):
                return snap
            time.sleep(0.05)
        self.fail(f'activity never matched: {snap}')

    def test_completion_is_visible_while_it_runs(self):
        release = threading.Event()
        def slow_claude(prompt, model, effort):
            release.wait(5)
            return 'ok'
        with mock.patch.object(self.handler, 'call_claude', slow_claude):
            body = {'prompt': 'hi', 'model': 'claude-opus-5-5', 'effort': 'max', 'graph_id': 'g1',
                    'source': 'council:exploration', 'label': 'synth: random'}
            worker = threading.Thread(target=self.call, args=('POST', '/v1/completions', body))
            worker.start()
            snap = self.wait_for(lambda s: s['running'])
            entry = snap['running'][0]
            self.assertEqual((entry['kind'], entry['graph_id'], entry['source'], entry['label'], entry['effort']),
                             ('call', 'g1', 'council:exploration', 'synth: random', 'max'))
            release.set()
            worker.join(5)
        snap = self.wait_for(lambda s: not s['running'])
        self.assertEqual(snap['recent'][0]['status'], 'done')

    def test_failed_completion_is_marked_failed(self):
        def broken_claude(prompt, model, effort):
            raise RuntimeError('cli exploded')
        with mock.patch.object(self.handler, 'call_claude', broken_claude):
            with self.assertRaises(urllib.error.HTTPError):
                self.call('POST', '/v1/completions', {'prompt': 'hi', 'graph_id': 'g1'})
        self.assertEqual(self.call('GET', '/v1/activity')['recent'][0]['status'], 'failed')

    def test_async_task_ends_when_its_thread_ends(self):
        import claude_task
        release = threading.Event()
        def slow_task(*args, **kwargs):
            release.wait(5)
            return {'response': 'done'}
        with mock.patch.object(claude_task, 'execute_claude_task', slow_task):
            res = self.call('POST', '/v1/execute', {'prompt': 'refresh', 'graph_id': 'g2', 'async': True,
                                                    'source': 'council:improvement', 'label': 'refresh part 1/6'})
            snap = self.wait_for(lambda s: s['running'])
            self.assertEqual((snap['running'][0]['task_id'], snap['running'][0]['kind']), (res['task_id'], 'task'))
            release.set()
            snap = self.wait_for(lambda s: not s['running'])
        self.assertEqual((snap['recent'][0]['status'], snap['recent'][0]['label']), ('done', 'refresh part 1/6'))

    def test_merge_is_recorded_with_its_writer(self):
        self.call('POST', '/v1/graph/merge?id=g3&source=council%3Aimprovement&label=set%20X%3A%20status%3Dtesting',
                  {'nodes': [{'name': 'X', 'labels': ['Proposal']}], 'relationships': []})
        entry = self.call('GET', '/v1/activity')['recent'][0]
        self.assertEqual((entry['kind'], entry['graph_id'], entry['source'], entry['label'], entry['detail']),
                         ('write', 'g3', 'council:improvement', 'set X: status=testing', '+1 nodes'))

    def test_open_tabs_get_activity_events(self):
        stream = urllib.request.urlopen(self.url + '/v1/loop/stream', timeout=5)
        self.addCleanup(stream.close)
        stream.readline()  # the initial all_status event
        self.call('POST', '/v1/graph/merge?id=g4', {'nodes': [{'name': 'Y'}], 'relationships': []})
        deadline = time.time() + 5
        while time.time() < deadline:
            line = stream.readline().decode()
            if line.startswith('event: activity'):
                data = json.loads(stream.readline().decode().split('data: ', 1)[1])
                self.assertEqual(data['recent'][0]['graph_id'], 'g4')
                return
        self.fail('no activity event reached the stream')

    def test_health_advertises_activity(self):
        self.assertIn('activity', self.call('GET', '/health')['features'])


if __name__ == '__main__':
    unittest.main()
