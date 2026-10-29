"""Tests for graph merging. Run: python3 -m unittest discover tests"""

import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from graphs import StaleGraphError, load_graph_state, merge_into_graph, save_graph_state


def node(id, name, label='Agent', **props):
    return {'id': id, 'labels': [label], 'properties': {'name': name, **props}}


class MergeIntoGraphTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = self.tmp.name
        save_graph_state({
            'nodes': [node(1, 'Floor Orchestrator'), node(2, 'Risk Agent')],
            'relationships': [{'id': 1, 'startNodeId': 1, 'endNodeId': 2, 'type': 'DISPATCHES_TO', 'properties': {}}],
        }, 'g', self.base)

    def tearDown(self):
        self.tmp.cleanup()

    def merge(self, data):
        graph, stats = merge_into_graph(data, 'g', self.base)
        return graph, stats

    def names(self, graph):
        return {n['id']: n['properties']['name'] for n in graph['nodes']}

    def edges(self, graph):
        names = self.names(graph)
        return {(names[r['startNodeId']], r['type'], names[r['endNodeId']]) for r in graph['relationships']}

    def test_dedupes_by_name_and_updates_properties(self):
        graph, stats = self.merge({'nodes': [node('x', 'floor orchestrator', status='live')]})
        self.assertEqual(len(graph['nodes']), 2)
        orchestrator = next(n for n in graph['nodes'] if n['id'] == 1)
        self.assertEqual(orchestrator['properties']['status'], 'live')
        self.assertEqual(orchestrator['properties']['name'], 'Floor Orchestrator')
        self.assertEqual((stats['added_nodes'], stats['updated_nodes']), (0, 1))

    def test_string_ids_are_remapped_and_edges_follow(self):
        graph, _ = self.merge({
            'nodes': [node('orch', 'Floor Orchestrator'), node('exec', 'Execution Agent')],
            'relationships': [{'startNodeId': 'orch', 'endNodeId': 'exec', 'type': 'DISPATCHES_TO'}],
        })
        self.assertIn(('Floor Orchestrator', 'DISPATCHES_TO', 'Execution Agent'), self.edges(graph))
        self.assertTrue(all(isinstance(n['id'], int) for n in graph['nodes']))

    def test_colliding_int_ids_get_new_ids_and_edges_follow_payload_node(self):
        graph, _ = self.merge({
            'nodes': [node(1, 'Shared Order Book', label='Proposal')],
            'relationships': [{'startNodeId': 1, 'endNodeId': 2, 'type': 'PROPOSES_CHANGE_TO'}],
        })
        self.assertEqual(len(graph['nodes']), 3)
        self.assertEqual(len({n['id'] for n in graph['nodes']}), 3)
        self.assertIn(('Shared Order Book', 'PROPOSES_CHANGE_TO', 'Risk Agent'), self.edges(graph))
        self.assertNotIn(('Floor Orchestrator', 'PROPOSES_CHANGE_TO', 'Risk Agent'), self.edges(graph))

    def test_relationships_by_name_with_from_to(self):
        graph, _ = self.merge({
            'nodes': [{'name': 'Price Feed', 'type': 'Channel', 'description': 'Websocket ticks'}],
            'relationships': [
                {'from': 'Price Feed', 'to': 'risk agent', 'type': 'PUBLISHES_TO', 'evidence': 'lib/feed.js:12'},
            ],
        })
        self.assertIn(('Price Feed', 'PUBLISHES_TO', 'Risk Agent'), self.edges(graph))
        rel = next(r for r in graph['relationships'] if r['type'] == 'PUBLISHES_TO')
        self.assertEqual(rel['properties']['evidence'], 'lib/feed.js:12')

    def test_top_level_fields_become_properties(self):
        graph, _ = self.merge({'nodes': [
            {'id': 'feed', 'name': 'Price Feed', 'type': 'Channel', 'description': 'Ticks', 'evidence': 'lib/feed.js:3'},
        ]})
        feed = next(n for n in graph['nodes'] if n['properties'].get('name') == 'Price Feed')
        self.assertEqual(feed['labels'], ['Channel'])
        self.assertEqual(feed['properties']['description'], 'Ticks')
        self.assertEqual(feed['properties']['evidence'], 'lib/feed.js:3')
        self.assertNotIn('evidence', feed)

    def test_dangling_relationships_are_skipped_and_reported(self):
        graph, stats = self.merge({
            'relationships': [{'from': 'Floor Orchestrator', 'to': 'Nowhere', 'type': 'CALLS'}],
        })
        self.assertEqual(len(graph['relationships']), 1)
        self.assertEqual(stats['skipped_relationships'], [{'from': 'Floor Orchestrator', 'to': 'Nowhere', 'type': 'CALLS'}])

    def test_duplicate_relationships_are_skipped(self):
        graph, stats = self.merge({
            'relationships': [{'from': 'Floor Orchestrator', 'to': 'Risk Agent', 'type': 'DISPATCHES_TO'}],
        })
        self.assertEqual(len(graph['relationships']), 1)
        self.assertEqual(stats['added_relationships'], 0)

    def test_existing_edges_with_rendered_source_objects_count_as_duplicates(self):
        state = load_graph_state('g', self.base)
        state['relationships'] = [{'id': 1, 'source': state['nodes'][0], 'target': state['nodes'][1], 'type': 'DISPATCHES_TO'}]
        save_graph_state(state, 'g', self.base)
        _, stats = self.merge({
            'relationships': [{'from': 'Floor Orchestrator', 'to': 'Risk Agent', 'type': 'DISPATCHES_TO'}],
        })
        self.assertEqual(stats['added_relationships'], 0)

    def test_merge_is_persisted(self):
        self.merge({'nodes': [node('n', 'Execution Agent')]})
        self.assertIn('Execution Agent', self.names(load_graph_state('g', self.base)).values())


class SaveConflictTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = self.tmp.name
        self.first = save_graph_state({'nodes': [node(1, 'Floor')], 'relationships': []}, 'g', self.base)

    def tearDown(self):
        self.tmp.cleanup()

    def test_save_from_the_current_copy_succeeds(self):
        saved = save_graph_state({'nodes': [node(1, 'Floor')], 'relationships': []}, 'g', self.base,
                                 base_updated_at=self.first['updated_at'])
        self.assertGreaterEqual(saved['updated_at'], self.first['updated_at'])

    def test_save_from_a_stale_copy_is_refused_and_keeps_the_newer_graph(self):
        stale = self.first['updated_at']
        merge_into_graph({'nodes': [{'name': 'Seat Proposal', 'labels': ['Proposal']}]}, 'g', self.base)
        with self.assertRaises(StaleGraphError):
            save_graph_state({'nodes': [node(1, 'Floor')], 'relationships': []}, 'g', self.base,
                             base_updated_at=stale - 1)
        names = [n['properties']['name'] for n in load_graph_state('g', self.base)['nodes']]
        self.assertIn('Seat Proposal', names)

    def test_save_without_a_base_still_overwrites(self):
        save_graph_state({'nodes': [], 'relationships': []}, 'g', self.base)
        self.assertEqual(load_graph_state('g', self.base)['nodes'], [])
        self.assertFalse(any(f.endswith('.tmp') for f in os.listdir(self.base)))

    def test_concurrent_merges_lose_nothing(self):
        def add(prefix):
            for i in range(20):
                merge_into_graph({'nodes': [{'name': f'{prefix}{i}'}]}, 'g', self.base)
        threads = [threading.Thread(target=add, args=(p,)) for p in ('a', 'b', 'c')]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(load_graph_state('g', self.base)['nodes']), 61)


class RefreshSupportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = self.tmp.name
        save_graph_state({
            'nodes': [node(1, 'Floor'), node(2, 'Real Desk')],
            'relationships': [{'id': 1, 'startNodeId': 1, 'endNodeId': 2, 'type': 'CALLS',
                               'properties': {'evidence': 'floor.js:10'}}],
        }, 'g', self.base)

    def tearDown(self):
        self.tmp.cleanup()

    def test_meta_records_the_commit_the_graph_describes(self):
        merge_into_graph({'meta': {'analyzed_commit': 'abc'}}, 'g', self.base)
        merge_into_graph({'meta': {'analyzed_at': 'now'}}, 'g', self.base)
        self.assertEqual(load_graph_state('g', self.base)['meta'], {'analyzed_commit': 'abc', 'analyzed_at': 'now'})

    def test_a_full_save_without_meta_keeps_it(self):
        merge_into_graph({'meta': {'analyzed_commit': 'abc'}}, 'g', self.base)
        ui_copy = {k: v for k, v in load_graph_state('g', self.base).items() if k != 'meta'}
        save_graph_state(ui_copy, 'g', self.base)
        self.assertEqual(load_graph_state('g', self.base)['meta'], {'analyzed_commit': 'abc'})

    def test_an_existing_edge_gets_its_properties_updated_not_duplicated(self):
        graph, stats = merge_into_graph({'relationships': [
            {'from': 'Floor', 'to': 'Real Desk', 'type': 'CALLS', 'removed_in': '#103', 'evidence': 'floor.js:99'}]},
            'g', self.base)
        self.assertEqual(len(graph['relationships']), 1)
        self.assertEqual(stats['updated_relationships'], 1)
        self.assertEqual(graph['relationships'][0]['properties'], {'evidence': 'floor.js:99', 'removed_in': '#103'})


class PermissionArgsTest(unittest.TestCase):
    def test_a_no_write_job_cannot_post_to_the_graph(self):
        from claude_task import permission_args
        allowed = lambda args: args[args.index('--allowedTools') + 1]
        self.assertIn('-X POST', allowed(permission_args(True)))
        self.assertNotIn('-X POST', allowed(permission_args(True, graph_writes=False)))
        self.assertIn('curl -s http://localhost:8765/*', allowed(permission_args(True, graph_writes=False)))


if __name__ == '__main__':
    unittest.main()
