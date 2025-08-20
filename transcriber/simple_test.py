#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
# ]
# ///
"""
Simple test for Scout Transcriber - direct file access to queues.
"""

import os
import sys
import time
import msgpack
import numpy as np
from pathlib import Path
from uuid import uuid4

def create_test_audio(duration=2.0, sample_rate=16000):
    """Create test audio (sine wave)."""
    num_samples = int(duration * sample_rate)
    t = np.linspace(0, duration, num_samples)
    # Create a simple tone
    audio = np.sin(2 * np.pi * 440 * t) * 0.3
    return audio.astype(np.float32)

def submit_audio_direct(audio_data, sample_rate=16000):
    """Submit audio directly to queue directory."""
    chunk_id = str(uuid4())
    timestamp = int(time.time() * 1000)
    
    # Create audio chunk
    audio_chunk = {
        "id": chunk_id,
        "audio": audio_data.tolist(),
        "sample_rate": sample_rate,
        "channels": 1,
        "timestamp": timestamp,
    }
    
    # Serialize with MessagePack
    data = msgpack.packb(audio_chunk, use_bin_type=True)
    
    # Write to a file in the input queue directory
    # This is a simplified approach - normally sled would handle this
    queue_dir = Path("/tmp/scout-transcriber/input")
    queue_dir.mkdir(parents=True, exist_ok=True)
    
    # Create a unique filename
    filename = f"{timestamp:016x}_{chunk_id}.msgpack"
    file_path = queue_dir / filename
    
    with open(file_path, 'wb') as f:
        f.write(data)
    
    print(f"📤 Submitted audio chunk:")
    print(f"   ID: {chunk_id}")
    print(f"   Duration: {len(audio_data)/sample_rate:.2f}s")
    print(f"   File: {file_path.name}")
    
    return chunk_id, file_path

def check_output_simple(chunk_id, timeout=30):
    """Check output directory for results."""
    output_dir = Path("/tmp/scout-transcriber/output")
    start_time = time.time()
    
    print(f"\n⏳ Waiting for result (timeout: {timeout}s)...")
    
    while time.time() - start_time < timeout:
        if output_dir.exists():
            for file_path in output_dir.glob("*.msgpack"):
                try:
                    with open(file_path, 'rb') as f:
                        data = f.read()
                        result = msgpack.unpackb(data, raw=False)
                        
                        # Check if this is our result
                        result_id = None
                        if isinstance(result, dict):
                            if "id" in result and result["id"] == chunk_id:
                                print(f"\n✅ Found result!")
                                print(f"   File: {file_path.name}")
                                print(f"   Content: {result}")
                                # Clean up
                                file_path.unlink()
                                return result
                except Exception as e:
                    # Skip bad files
                    continue
        
        sys.stdout.write(".")
        sys.stdout.flush()
        time.sleep(0.5)
    
    print(f"\n⏱️ Timeout - no result found")
    return None

def check_queues():
    """Check queue directories."""
    input_dir = Path("/tmp/scout-transcriber/input")
    output_dir = Path("/tmp/scout-transcriber/output")
    
    input_files = list(input_dir.glob("*")) if input_dir.exists() else []
    output_files = list(output_dir.glob("*")) if output_dir.exists() else []
    
    print(f"\n📊 Queue Status:")
    print(f"   Input queue:  {len(input_files)} files")
    print(f"   Output queue: {len(output_files)} files")
    
    if input_files:
        print(f"\n   Input files:")
        for f in input_files[:5]:  # Show first 5
            print(f"     - {f.name}")
    
    if output_files:
        print(f"\n   Output files:")
        for f in output_files[:5]:  # Show first 5
            print(f"     - {f.name}")

def main():
    print("🧪 Simple Scout Transcriber Test")
    print("=" * 50)
    
    # Check if service is likely running
    pid_file = Path("/tmp/scout-transcriber.pid")
    if pid_file.exists():
        print("✅ Service appears to be running")
    else:
        print("⚠️  Service may not be running (no PID file)")
        print("   Run: ./transcriber start")
    
    # Check current queue status
    check_queues()
    
    # Create and submit test audio
    print("\n📊 Creating test audio...")
    audio = create_test_audio(duration=2.0)
    
    print("\n📤 Submitting to queue...")
    chunk_id, file_path = submit_audio_direct(audio)
    
    # Wait for result
    result = check_output_simple(chunk_id)
    
    if result:
        print("\n✅ Test successful!")
    else:
        print("\n❌ Test failed - no result received")
        print("\nDebug info:")
        print("1. Check if service is running: ./transcriber status")
        print("2. Check logs: ./transcriber logs")
        print("3. Check input file exists:", file_path.exists())
    
    # Final queue status
    check_queues()

if __name__ == "__main__":
    main()