#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
#   "requests",
# ]
# ///
"""
Test client for Scout Transcriber using HTTP API bridge.

Since Sled doesn't have official Python bindings, this client
communicates through a simple HTTP bridge or direct file operations.
"""

import sys
import time
import json
import msgpack
import numpy as np
import requests
from pathlib import Path
from uuid import uuid4
from typing import Optional, Dict, Any

class TranscriberClient:
    """Client for testing the Scout Transcriber service."""
    
    def __init__(self, mode="file"):
        """
        Initialize the client.
        
        Args:
            mode: "file" for direct file operations, "http" for HTTP API
        """
        self.mode = mode
        self.base_url = "http://localhost:8080"  # For future HTTP mode
        
        # For file mode
        self.input_dir = Path("/tmp/scout-transcriber/input")
        self.output_dir = Path("/tmp/scout-transcriber/output")
        
        # Ensure directories exist
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"✅ Initialized client in {mode} mode")
        if mode == "file":
            print(f"   Input:  {self.input_dir}")
            print(f"   Output: {self.output_dir}")
    
    def create_test_audio(self, text: str = None, duration: float = 2.0, sample_rate: int = 16000) -> np.ndarray:
        """
        Create test audio.
        
        For now, creates a sine wave. In the future, could use TTS.
        """
        num_samples = int(duration * sample_rate)
        t = np.linspace(0, duration, num_samples)
        
        if text:
            # Simulate speech-like patterns based on text length
            # This is just a placeholder - real TTS would be better
            freq_variation = len(text) * 10
            base_freq = 200 + freq_variation
            
            # Create complex waveform
            audio = np.zeros(num_samples)
            audio += 0.3 * np.sin(2 * np.pi * base_freq * t)
            audio += 0.2 * np.sin(2 * np.pi * (base_freq * 2) * t)
            audio += 0.1 * np.sin(2 * np.pi * (base_freq * 4) * t)
            
            # Add envelope
            envelope = np.exp(-t * 0.5) * np.sin(2 * np.pi * 3 * t) * 0.5 + 0.5
            audio *= envelope
        else:
            # Simple tone
            audio = np.sin(2 * np.pi * 440 * t) * 0.3
        
        # Add some noise
        audio += np.random.normal(0, 0.01, num_samples)
        
        return audio.astype(np.float32)
    
    def submit_audio(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        """Submit audio for transcription."""
        chunk_id = str(uuid4())
        timestamp = int(time.time() * 1000)
        
        audio_chunk = {
            "id": chunk_id,
            "audio": audio.tolist(),
            "sample_rate": sample_rate,
            "channels": 1,
            "timestamp": timestamp,
        }
        
        if self.mode == "file":
            # Direct file write (Sled will pick this up)
            # Note: This is a workaround - proper Sled integration would be better
            data = msgpack.packb(audio_chunk, use_bin_type=True)
            
            # Sled uses a specific key format
            # We'll write to a temp file that the Rust service can import
            temp_file = self.input_dir / f"temp_{timestamp}_{chunk_id}.msgpack"
            with open(temp_file, 'wb') as f:
                f.write(data)
            
            print(f"📤 Submitted audio chunk:")
            print(f"   ID: {chunk_id}")
            print(f"   Duration: {len(audio)/sample_rate:.2f}s")
            print(f"   Samples: {len(audio)}")
            print(f"   File: {temp_file.name}")
            
        else:  # HTTP mode (future)
            response = requests.post(
                f"{self.base_url}/transcribe",
                json=audio_chunk
            )
            response.raise_for_status()
            print(f"📤 Submitted via HTTP: {chunk_id}")
        
        return chunk_id
    
    def wait_for_result(self, chunk_id: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
        """Wait for transcription result."""
        print(f"\n⏳ Waiting for result (timeout: {timeout}s)...")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            if self.mode == "file":
                # Check for result files
                for file_path in self.output_dir.glob("*.msgpack"):
                    try:
                        with open(file_path, 'rb') as f:
                            result = msgpack.unpackb(f.read(), raw=False)
                            
                        # Check if this is our result
                        if self._is_our_result(result, chunk_id):
                            print(f"\n✅ Result received!")
                            self._print_result(result)
                            file_path.unlink()  # Clean up
                            return result
                    except Exception:
                        continue
                        
            else:  # HTTP mode
                response = requests.get(f"{self.base_url}/result/{chunk_id}")
                if response.status_code == 200:
                    result = response.json()
                    print(f"\n✅ Result received via HTTP!")
                    self._print_result(result)
                    return result
            
            sys.stdout.write(".")
            sys.stdout.flush()
            time.sleep(0.5)
        
        print(f"\n⏱️ Timeout - no result received")
        return None
    
    def _is_our_result(self, result: Dict, chunk_id: str) -> bool:
        """Check if a result matches our chunk ID."""
        if isinstance(result, dict):
            # Handle different result formats
            if "Ok" in result:
                return result["Ok"].get("id") == chunk_id
            elif "Err" in result:
                return result["Err"].get("id") == chunk_id
            elif "id" in result:
                return result["id"] == chunk_id
        return False
    
    def _print_result(self, result: Dict):
        """Pretty print a result."""
        if "Ok" in result or "text" in result:
            transcript = result.get("Ok", result)
            print(f"   Text: '{transcript.get('text', 'N/A')}'")
            print(f"   Confidence: {transcript.get('confidence', 'N/A')}")
            if 'metadata' in transcript:
                print(f"   Metadata: {transcript['metadata']}")
        elif "Err" in result:
            error = result["Err"]
            print(f"   ❌ Error: {error.get('message', 'Unknown error')}")
            print(f"   Code: {error.get('error_code', 'N/A')}")
    
    def check_status(self):
        """Check service and queue status."""
        print("\n📊 Service Status:")
        
        # Check PID file
        pid_file = Path("/tmp/scout-transcriber.pid")
        if pid_file.exists():
            with open(pid_file) as f:
                pid = f.read().strip()
            print(f"   ✅ Service running (PID: {pid})")
        else:
            print(f"   ⚠️  Service not running (no PID file)")
        
        # Check queues
        input_files = list(self.input_dir.glob("*"))
        output_files = list(self.output_dir.glob("*"))
        
        print(f"\n📊 Queue Status:")
        print(f"   Input:  {len(input_files)} items")
        print(f"   Output: {len(output_files)} items")
        
        # Show recent files
        if input_files:
            print("\n   Recent input files:")
            for f in sorted(input_files)[-3:]:
                print(f"     - {f.name} ({f.stat().st_size} bytes)")
        
        if output_files:
            print("\n   Recent output files:")
            for f in sorted(output_files)[-3:]:
                print(f"     - {f.name} ({f.stat().st_size} bytes)")
    
    def clear_queues(self):
        """Clear all queue files."""
        count = 0
        for f in self.input_dir.glob("*.msgpack"):
            f.unlink()
            count += 1
        print(f"🧹 Cleared {count} files from input queue")
        
        count = 0
        for f in self.output_dir.glob("*.msgpack"):
            f.unlink()
            count += 1
        print(f"🧹 Cleared {count} files from output queue")

def interactive_menu():
    """Interactive testing menu."""
    client = TranscriberClient(mode="file")
    
    while True:
        print("\n" + "=" * 50)
        print("Scout Transcriber Test Client")
        print("=" * 50)
        print("1. Send test tone")
        print("2. Send speech-like audio")
        print("3. Send text-based audio (simulated)")
        print("4. Batch test (multiple chunks)")
        print("5. Check status")
        print("6. Clear queues")
        print("0. Exit")
        
        choice = input("\nChoice: ").strip()
        
        if choice == "0":
            break
            
        elif choice == "1":
            audio = client.create_test_audio(duration=2.0)
            chunk_id = client.submit_audio(audio)
            client.wait_for_result(chunk_id)
            
        elif choice == "2":
            audio = client.create_test_audio(text="Hello world", duration=3.0)
            chunk_id = client.submit_audio(audio)
            client.wait_for_result(chunk_id)
            
        elif choice == "3":
            text = input("Enter text to simulate: ")
            audio = client.create_test_audio(text=text, duration=2.0)
            chunk_id = client.submit_audio(audio)
            client.wait_for_result(chunk_id)
            
        elif choice == "4":
            n = int(input("How many chunks? "))
            chunk_ids = []
            for i in range(n):
                audio = client.create_test_audio(duration=1.0)
                chunk_id = client.submit_audio(audio)
                chunk_ids.append(chunk_id)
                time.sleep(0.1)
            
            for chunk_id in chunk_ids:
                client.wait_for_result(chunk_id, timeout=10)
                
        elif choice == "5":
            client.check_status()
            
        elif choice == "6":
            client.clear_queues()
    
    print("\n👋 Goodbye!")

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Scout Transcriber Test Client")
    parser.add_argument("--mode", choices=["file", "http"], default="file",
                        help="Communication mode")
    parser.add_argument("--quick", action="store_true",
                        help="Run quick test and exit")
    
    args = parser.parse_args()
    
    if args.quick:
        # Quick test
        client = TranscriberClient(mode=args.mode)
        client.check_status()
        
        print("\n🧪 Running quick test...")
        audio = client.create_test_audio(duration=2.0)
        chunk_id = client.submit_audio(audio)
        result = client.wait_for_result(chunk_id)
        
        if result:
            print("✅ Test passed!")
        else:
            print("❌ Test failed!")
            sys.exit(1)
    else:
        # Interactive mode
        interactive_menu()

if __name__ == "__main__":
    main()