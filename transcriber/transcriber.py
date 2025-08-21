#!/usr/bin/env python3
"""
Scout Transcriber Service Manager
Cross-platform service management with proper PID handling
"""

import os
import sys
import time
import signal
import psutil
import subprocess
import argparse
import json
from pathlib import Path
from typing import Optional
import atexit

class TranscriberService:
    def __init__(self):
        self.pid_file = Path("/tmp/transcriber.pid")
        self.log_file = Path("/tmp/transcriber.log")
        self.config_file = Path.home() / ".config/transcriber/config.json"
        self.binary = Path(__file__).parent / "target/release/transcriber"
        
    def get_pid(self) -> Optional[int]:
        """Get PID from file if it exists"""
        if self.pid_file.exists():
            try:
                return int(self.pid_file.read_text().strip())
            except (ValueError, IOError):
                return None
        return None
    
    def is_running(self) -> bool:
        """Check if service is running"""
        pid = self.get_pid()
        if pid:
            try:
                process = psutil.Process(pid)
                return process.is_running() and "transcriber" in process.name()
            except psutil.NoSuchProcess:
                return False
        return False
    
    def start(self, model="whisper", workers=2, zeromq=False, daemon=False):
        """Start the transcriber service"""
        if self.is_running():
            print(f"✗ Service already running (PID: {self.get_pid()})")
            return False
        
        # Clean stale PID file
        if self.pid_file.exists():
            self.pid_file.unlink()
        
        # Build command
        cmd = [str(self.binary), "--model", model, "--workers", str(workers)]
        if zeromq:
            cmd.extend(["--use-zeromq", "--python-args", "run python/zmq_server_worker.py"])
            if workers > 1:
                print("⚠ ZeroMQ mode only supports 1 worker, adjusting...")
                cmd[4] = "1"  # Update workers argument
        
        # Start process
        if daemon:
            with open(self.log_file, 'a') as log:
                process = subprocess.Popen(
                    cmd,
                    stdout=log,
                    stderr=log,
                    start_new_session=True
                )
            
            # Save PID
            self.pid_file.write_text(str(process.pid))
            
            # Verify it started
            time.sleep(2)
            if self.is_running():
                print(f"✓ Service started (PID: {process.pid})")
                return True
            else:
                print("✗ Service failed to start")
                if self.log_file.exists():
                    print("Recent logs:")
                    print(self.log_file.read_text().split('\n')[-10:])
                return False
        else:
            # Run in foreground
            try:
                subprocess.run(cmd)
            except KeyboardInterrupt:
                print("\n✓ Service stopped")
            return True
    
    def stop(self):
        """Stop the transcriber service"""
        pid = self.get_pid()
        if not pid:
            print("⚠ No PID file found")
            # Try to find and kill anyway
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                if 'transcriber' in str(proc.info.get('cmdline', [])):
                    proc.terminate()
                    print(f"✓ Stopped process {proc.pid}")
            return True
        
        try:
            process = psutil.Process(pid)
            process.terminate()
            
            # Wait for graceful shutdown
            try:
                process.wait(timeout=10)
            except psutil.TimeoutExpired:
                print("⚠ Process didn't stop gracefully, forcing...")
                process.kill()
            
            print(f"✓ Service stopped (PID: {pid})")
            
        except psutil.NoSuchProcess:
            print(f"⚠ Process {pid} not found")
        finally:
            if self.pid_file.exists():
                self.pid_file.unlink()
        
        # Clean up ports
        self._cleanup_ports()
        return True
    
    def restart(self, **kwargs):
        """Restart the service"""
        print("Restarting service...")
        self.stop()
        time.sleep(2)
        return self.start(**kwargs)
    
    def status(self):
        """Check service status"""
        if self.is_running():
            pid = self.get_pid()
            try:
                process = psutil.Process(pid)
                print(f"✓ Service RUNNING (PID: {pid})")
                print(f"  Memory: {process.memory_info().rss / 1024 / 1024:.1f} MB")
                print(f"  CPU: {process.cpu_percent()}%")
                print(f"  Threads: {process.num_threads()}")
                
                # Check ports
                connections = process.connections()
                if connections:
                    print("  Ports:")
                    for conn in connections:
                        if conn.status == 'LISTEN':
                            print(f"    {conn.laddr.port}: LISTENING")
                
            except psutil.NoSuchProcess:
                pass
        else:
            print("✗ Service NOT RUNNING")
            
            # Show last error from log
            if self.log_file.exists():
                logs = self.log_file.read_text().split('\n')
                errors = [l for l in logs if 'ERROR' in l or 'FATAL' in l]
                if errors:
                    print(f"Last error: {errors[-1]}")
    
    def _cleanup_ports(self):
        """Clean up ZeroMQ ports"""
        for port in [5555, 5556, 5557]:
            for conn in psutil.net_connections():
                if conn.laddr.port == port and conn.status == 'LISTEN':
                    try:
                        process = psutil.Process(conn.pid)
                        process.terminate()
                        print(f"  Cleaned up port {port}")
                    except:
                        pass

def main():
    parser = argparse.ArgumentParser(description='Scout Transcriber Service Manager')
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Start command
    start_parser = subparsers.add_parser('start', help='Start service')
    start_parser.add_argument('-m', '--model', default='whisper', 
                            choices=['whisper', 'parakeet', 'wav2vec2'])
    start_parser.add_argument('-w', '--workers', type=int, default=2)
    start_parser.add_argument('-z', '--zeromq', action='store_true')
    start_parser.add_argument('-d', '--daemon', action='store_true')
    
    # Other commands
    subparsers.add_parser('stop', help='Stop service')
    subparsers.add_parser('restart', help='Restart service')
    subparsers.add_parser('status', help='Check status')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    service = TranscriberService()
    
    if args.command == 'start':
        service.start(args.model, args.workers, args.zeromq, args.daemon)
    elif args.command == 'stop':
        service.stop()
    elif args.command == 'restart':
        service.restart()
    elif args.command == 'status':
        service.status()

if __name__ == '__main__':
    main()