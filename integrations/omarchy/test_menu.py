import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BIN = Path(__file__).parent / 'bin'


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), BIN / name)
    if spec is None:
        from importlib.machinery import SourceFileLoader
        spec = importlib.util.spec_from_loader(name, SourceFileLoader(name, str(BIN / name)))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class DesktopMenuTest(unittest.TestCase):
    def test_optional_old_tui_launches_without_new_flags(self):
        launcher = module('scout-hud-tui')
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True), patch.object(launcher.common, 'data_home', return_value=Path(tmp)), patch.object(launcher.common, 'scout_binary', return_value='/installed/public/scout'), patch.object(launcher.shutil, 'which', return_value='/usr/bin/ghostty'), patch.object(launcher.subprocess, 'Popen') as spawn:
            launcher.main()
        command = spawn.call_args.args[0]
        self.assertEqual(command[-2:], ['/installed/public/scout', 'tui'])
        self.assertEqual(spawn.call_args.kwargs['env']['SCOUT_TUI_AMBIENT'], 'shimmer')
    def test_only_positive_kind_specific_progress_counts_as_active(self):
        status = module('scout-menu-status')
        rows = status.work_rows([{'kind': 'invocation', 'state': 'recorded'}, {'kind': 'flight'}, {'kind': 'flight', 'state': 'waking'}, {'kind': 'flight', 'state': 'running'}, {'kind': 'work_item', 'state': 'active'}, {'kind': 'question', 'state': 'open'}, {'kind': 'flight', 'state': 'running', 'blocked': True}])
        self.assertEqual([row['active'] for row in rows], [False, False, False, True, True, False, False])
    def test_budget_reader_starts_web_before_usage_and_uses_selected_cli(self):
        status = module('scout-menu-status')
        events = []
        def run(argv, **kwargs):
            events.append(argv)
            from subprocess import CompletedProcess
            return CompletedProcess(argv, 0, '{"providers":[]}', '')
        with patch.object(status.common, 'scout_binary', return_value='/installed/public/scout'), patch.object(status.common, 'ensure_web', side_effect=lambda: events.append('start-web')), patch.object(status.subprocess, 'run', side_effect=run):
            result = status.read_command(['scout', 'providers', 'usage', '--cached', '--json'])
        self.assertIsNone(result['error'])
        self.assertEqual(events, ['start-web', ['/installed/public/scout', 'providers', 'usage', '--cached', '--json']])

    def test_budget_start_failure_does_not_query_usage(self):
        status = module('scout-menu-status')
        with patch.object(status.common, 'ensure_web', side_effect=ValueError('web unavailable')), patch.object(status.subprocess, 'run') as run:
            result = status.read_command(['scout', 'providers', 'usage', '--cached', '--json'])
        self.assertEqual(result['error'], 'web unavailable')
        run.assert_not_called()

    def test_missing_capacity_is_unknown_and_out_of_range_is_clamped(self):
        status = module('scout-menu-status')
        rows = status.quota_rows({'providers':[{'label':'Fixture','windows':[{'usedPercent':None},{'usedPercent':float('nan')},{'usedPercent':120},{'usedPercent':-4},{'usedPercent':99.9}]}]})
        self.assertEqual([row['used'] for row in rows], [None, None, 100, 0, 99.9])

    def test_receipt_wins_over_path_and_missing_explicit_cli_fails_closed(self):
        common = module('scout-menu-common.py')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / 'public-scout'
            cli.write_text('#!/bin/sh\nexit 0\n')
            cli.chmod(0o755)
            receipt = root / 'openscout/linux-desktop/desktop-install.json'
            receipt.parent.mkdir(parents=True)
            receipt.write_text(json.dumps({'cliBin':str(cli)}))
            with patch.dict(os.environ, {'XDG_DATA_HOME':tmp}, clear=True), patch.object(common.shutil, 'which', return_value='/old/cache/scout'):
                self.assertEqual(common.scout_binary(), str(cli))
                with patch.dict(os.environ, {'SCOUT_CLI_BIN':str(root/'missing')}):
                    with self.assertRaises(ValueError): common.scout_binary()

    def test_open_item_is_encoded_as_one_argument_and_unknown_views_fail(self):
        action = module('scout-menu-action')
        self.assertEqual(action.route_for('work', '../thing; rm -rf /'), '/work/..%2Fthing%3B%20rm%20-rf%20%2F')
        with self.assertRaises(ValueError): action.route_for('unknown')


if __name__ == '__main__': unittest.main()
