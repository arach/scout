"""Resolve the installed public Scout CLI without depending on a source checkout."""
import json
import os
from pathlib import Path
import shutil
import subprocess


def data_home():
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local/share')


def config_home():
    return Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')


def scout_binary():
    override = os.environ.get('SCOUT_CLI_BIN')
    if override:
        selected = override
    else:
        receipt = data_home() / 'openscout/linux-desktop/desktop-install.json'
        selected = json.loads(receipt.read_text()).get('cliBin') if receipt.exists() else shutil.which('scout')
    if not selected or not Path(selected).is_file() or not os.access(selected, os.X_OK):
        raise ValueError('Public Scout CLI is unavailable. Reinstall this integration or set SCOUT_CLI_BIN.')
    return selected


def run_scout(args, timeout=25):
    return subprocess.run([scout_binary(), *args], capture_output=True, text=True, timeout=timeout)


def ensure_web():
    # Budget reads are served by this broker-owned child, not by the broker itself.
    result = run_scout(['server', 'start'], timeout=20)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or 'Scout web service could not start')
    return result.stdout
