#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
# ]
# ///
"""
Integration test for Scout Transcriber.
Tests the queue-based communication between client and service.
"""

import sys
import time
import msgpack
import numpy as np
from pathlib import Path
from uuid import uuid4

# Import from the library (would normally be via pip in production)
sys.path.insert(0, str(Path(__file__).parent))

def create_test_audio(duration_seconds=2.0, sample_rate=16000):
    """Create a test audio signal."""
    num_samples = int(duration_seconds * sample_rate)
    # Create a simple sine wave
    t = np.linspace(0, duration_seconds, num_samples)
    frequency = 440  # A4 note
    audio = np.sin(2 * np.pi * frequency * t) * 0.5
    return audio.astype(np.float32).tolist()

def submit_audio_to_queue():
    """Submit test audio to the input queue."""
    import sled
    
    # Open the input queue
    input_queue_path = "/tmp/scout-transcriber/input"
    db = sled.open(input_queue_path)
    
    # Create test audio chunk
    audio_chunk = {
        "id": str(uuid4()),
        "audio": create_test_audio(1.0, 16000),
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": int(time.time() * 1000),
    }
    
    # Serialize with MessagePack
    data = msgpack.packb(audio_chunk, use_bin_type=True)
    
    # Generate key with timestamp for ordering
    key = f"{audio_chunk['timestamp']:016x}_{audio_chunk['id']}"
    
    # Insert into queue
    db.insert(key.encode(), data)
    
    print(f"✅ Submitted audio chunk {audio_chunk['id']} to input queue")
    print(f"   Duration: 1.0 seconds")
    print(f"   Sample rate: 16000 Hz")
    print(f"   Queue key: {key}")
    
    return audio_chunk['id']

def check_output_queue(chunk_id, timeout=30):
    """Check the output queue for results."""
    import sled
    
    # Open the output queue
    output_queue_path = "/tmp/scout-transcriber/output"
    db = sled.open(output_queue_path)
    
    start_time = time.time()
    
    print(f"\n⏳ Waiting for transcription result (timeout: {timeout}s)...")
    
    while time.time() - start_time < timeout:
        # Scan the queue for results
        for key, value in db.iter():
            try:
                # Deserialize the result
                result = msgpack.unpackb(value, raw=False)
                
                # Check if it's our result
                if isinstance(result, dict):
                    if result.get("id") == chunk_id or (result.get("Ok", {}).get("id") == chunk_id):
                        # Found our result!
                        db.remove(key)  # Remove from queue
                        
                        if "Ok" in result:
                            transcript = result["Ok"]
                            print(f"\n✅ Transcription received!")
                            print(f"   ID: {transcript['id']}")
                            print(f"   Text: {transcript.get('text', 'N/A')}")
                            print(f"   Confidence: {transcript.get('confidence', 'N/A')}")
                            return True
                        elif "Err" in result:
                            error = result["Err"]
                            print(f"\n❌ Transcription error!")
                            print(f"   ID: {error['id']}")
                            print(f"   Error: {error['message']}")
                            return False
                        else:
                            print(f"\n📦 Result found: {result}")
                            return True
            except Exception as e:
                print(f"Error deserializing result: {e}")
                continue
        
        # Wait a bit before checking again
        time.sleep(0.5)
        sys.stdout.write(".")
        sys.stdout.flush()
    
    print(f"\n⏱️ Timeout: No result received after {timeout} seconds")
    return False

def main():
    """Run the integration test."""
    print("🧪 Scout Transcriber Integration Test")
    print("=" * 40)
    
    # Check if service is running
    print("\n1️⃣ Checking service status...")
    print("   ⚠️  Make sure scout-transcriber is running!")
    print("   Run: ./target/release/scout-transcriber")
    
    # Submit audio
    print("\n2️⃣ Submitting test audio...")
    chunk_id = submit_audio_to_queue()
    
    # Wait for result
    print("\n3️⃣ Checking for transcription result...")
    success = check_output_queue(chunk_id)
    
    # Summary
    print("\n" + "=" * 40)
    if success:
        print("✅ Integration test PASSED!")
    else:
        print("❌ Integration test FAILED!")
        print("\nTroubleshooting:")
        print("1. Check if service is running: ps aux | grep scout-transcriber")
        print("2. Check service logs for errors")
        print("3. Verify Python worker is running: ps aux | grep transcriber.py")
        print("4. Check queue contents: ls -la /tmp/scout-transcriber/")
    
    return 0 if success else 1

if __name__ == "__main__":
    try:
        # Install sled-python if needed
        import sled
    except ImportError:
        print("Installing sled-python...")
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "sled-python"], check=True)
        import sled
    
    sys.exit(main())