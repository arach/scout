#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
# ]
# ///
"""
Test the Scout Transcriber pipeline with audio data.
"""

import sys
import time
import msgpack
import numpy as np
from pathlib import Path
from uuid import uuid4
import sled

class TranscriberClient:
    def __init__(self, input_queue="/tmp/scout-transcriber/input", output_queue="/tmp/scout-transcriber/output"):
        """Initialize client for the transcriber service."""
        self.input_db = sled.open(input_queue)
        self.output_db = sled.open(output_queue)
        print(f"✅ Connected to queues:")
        print(f"   Input:  {input_queue}")
        print(f"   Output: {output_queue}")
    
    def create_test_audio(self, duration=2.0, sample_rate=16000, frequency=440):
        """Create test audio (sine wave)."""
        num_samples = int(duration * sample_rate)
        t = np.linspace(0, duration, num_samples)
        # Create a sine wave with some variation
        audio = np.sin(2 * np.pi * frequency * t) * 0.3
        # Add a bit of noise to make it more realistic
        audio += np.random.normal(0, 0.01, num_samples)
        return audio.astype(np.float32)
    
    def create_speech_like_audio(self, duration=2.0, sample_rate=16000):
        """Create audio that resembles speech patterns."""
        num_samples = int(duration * sample_rate)
        t = np.linspace(0, duration, num_samples)
        
        # Mix of frequencies common in speech
        audio = np.zeros(num_samples)
        audio += 0.3 * np.sin(2 * np.pi * 200 * t)  # Low frequency
        audio += 0.2 * np.sin(2 * np.pi * 800 * t)  # Mid frequency
        audio += 0.1 * np.sin(2 * np.pi * 2000 * t) # High frequency
        
        # Add envelope to simulate speech rhythm
        envelope = np.sin(2 * np.pi * 2 * t) * 0.5 + 0.5
        audio *= envelope
        
        return audio.astype(np.float32)
    
    def submit_audio(self, audio_data, sample_rate=16000):
        """Submit audio to the transcription queue."""
        chunk_id = str(uuid4())
        
        # Create audio chunk message
        audio_chunk = {
            "id": chunk_id,
            "audio": audio_data.tolist(),
            "sample_rate": sample_rate,
            "channels": 1,
            "timestamp": int(time.time() * 1000),
        }
        
        # Serialize with MessagePack
        data = msgpack.packb(audio_chunk, use_bin_type=True)
        
        # Create ordered key
        key = f"{audio_chunk['timestamp']:016x}_{chunk_id}"
        
        # Insert into queue
        self.input_db.insert(key.encode(), data)
        
        print(f"📤 Submitted audio chunk:")
        print(f"   ID: {chunk_id}")
        print(f"   Duration: {len(audio_data)/sample_rate:.2f}s")
        print(f"   Samples: {len(audio_data)}")
        
        return chunk_id
    
    def wait_for_result(self, chunk_id, timeout=30):
        """Wait for transcription result."""
        print(f"\n⏳ Waiting for result (timeout: {timeout}s)...")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            # Check output queue
            for key, value in self.output_db.iter():
                try:
                    result = msgpack.unpackb(value, raw=False)
                    
                    # Check if this is our result
                    result_id = None
                    if isinstance(result, dict):
                        if "Ok" in result:
                            result_id = result["Ok"].get("id")
                        elif "Err" in result:
                            result_id = result["Err"].get("id")
                        elif "id" in result:
                            result_id = result["id"]
                    
                    if result_id == chunk_id:
                        # Found our result!
                        self.output_db.remove(key)
                        
                        if "Ok" in result or "text" in result:
                            transcript = result.get("Ok", result)
                            print(f"\n✅ Transcription received!")
                            print(f"   Text: '{transcript.get('text', 'N/A')}'")
                            print(f"   Confidence: {transcript.get('confidence', 'N/A')}")
                            return transcript
                        elif "Err" in result:
                            error = result["Err"]
                            print(f"\n❌ Error: {error.get('message', 'Unknown error')}")
                            return None
                            
                except Exception as e:
                    # Skip malformed messages
                    continue
            
            # Show progress
            sys.stdout.write(".")
            sys.stdout.flush()
            time.sleep(0.5)
        
        print(f"\n⏱️ Timeout - no result received")
        return None
    
    def clear_queues(self):
        """Clear all messages from queues."""
        count = 0
        for key, _ in self.input_db.iter():
            self.input_db.remove(key)
            count += 1
        print(f"🧹 Cleared {count} messages from input queue")
        
        count = 0
        for key, _ in self.output_db.iter():
            self.output_db.remove(key)
            count += 1
        print(f"🧹 Cleared {count} messages from output queue")

def main():
    print("🧪 Scout Transcriber Pipeline Test")
    print("=" * 50)
    
    # Create client
    client = TranscriberClient()
    
    # Menu
    while True:
        print("\n" + "=" * 50)
        print("Choose an option:")
        print("1. Send test tone (sine wave)")
        print("2. Send speech-like audio")
        print("3. Send multiple audio chunks")
        print("4. Clear queues")
        print("5. Check queue status")
        print("0. Exit")
        
        choice = input("\nEnter choice (0-5): ").strip()
        
        if choice == "0":
            break
        elif choice == "1":
            print("\n📊 Sending test tone...")
            audio = client.create_test_audio(duration=2.0, frequency=440)
            chunk_id = client.submit_audio(audio)
            client.wait_for_result(chunk_id)
            
        elif choice == "2":
            print("\n🎤 Sending speech-like audio...")
            audio = client.create_speech_like_audio(duration=3.0)
            chunk_id = client.submit_audio(audio)
            client.wait_for_result(chunk_id)
            
        elif choice == "3":
            n = int(input("How many chunks? "))
            print(f"\n📦 Sending {n} audio chunks...")
            chunk_ids = []
            for i in range(n):
                audio = client.create_test_audio(duration=1.0, frequency=440 + i*50)
                chunk_id = client.submit_audio(audio)
                chunk_ids.append(chunk_id)
                time.sleep(0.1)
            
            print(f"\n⏳ Waiting for {n} results...")
            for chunk_id in chunk_ids:
                client.wait_for_result(chunk_id, timeout=10)
                
        elif choice == "4":
            client.clear_queues()
            
        elif choice == "5":
            # Check queue sizes
            input_count = sum(1 for _ in client.input_db.iter())
            output_count = sum(1 for _ in client.output_db.iter())
            print(f"\n📊 Queue Status:")
            print(f"   Input queue:  {input_count} messages")
            print(f"   Output queue: {output_count} messages")
        
        else:
            print("Invalid choice")
    
    print("\n👋 Goodbye!")

if __name__ == "__main__":
    main()