#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""
ZeroMQ test client for Scout Transcriber.
Sends audio data through ZeroMQ for transcription.
"""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, Optional

class ZmqTranscriberClient:
    """ZeroMQ client for the Scout Transcriber service."""
    
    def __init__(self, 
                 push_endpoint: str = "tcp://127.0.0.1:5555",
                 pull_endpoint: str = "tcp://127.0.0.1:5556"):
        """
        Initialize the ZeroMQ client.
        
        Args:
            push_endpoint: Endpoint to push audio chunks to
            pull_endpoint: Endpoint to pull results from
        """
        self.context = zmq.Context()
        
        # Create PUSH socket for sending audio
        self.push_socket = self.context.socket(zmq.PUSH)
        self.push_socket.connect(push_endpoint)
        
        # Create PULL socket for receiving results
        self.pull_socket = self.context.socket(zmq.PULL)
        self.pull_socket.connect(pull_endpoint)
        
        # Set receive timeout to avoid blocking forever
        self.pull_socket.setsockopt(zmq.RCVTIMEO, 1000)  # 1 second timeout
        
        print(f"✅ Connected to ZeroMQ endpoints:")
        print(f"   Push (audio): {push_endpoint}")
        print(f"   Pull (results): {pull_endpoint}")
    
    def create_test_audio(self, 
                         duration: float = 2.0, 
                         sample_rate: int = 16000,
                         frequency: float = 440.0) -> np.ndarray:
        """
        Create test audio (sine wave).
        
        Args:
            duration: Duration in seconds
            sample_rate: Sample rate in Hz
            frequency: Frequency of the sine wave
            
        Returns:
            Audio samples as numpy array
        """
        num_samples = int(duration * sample_rate)
        t = np.linspace(0, duration, num_samples)
        
        # Create sine wave
        audio = np.sin(2 * np.pi * frequency * t) * 0.3
        
        # Add some harmonics to make it more interesting
        audio += np.sin(2 * np.pi * frequency * 2 * t) * 0.1
        audio += np.sin(2 * np.pi * frequency * 3 * t) * 0.05
        
        # Add a bit of noise
        audio += np.random.normal(0, 0.01, num_samples)
        
        return audio.astype(np.float32)
    
    def create_speech_like_audio(self, 
                                 text: str,
                                 duration: float = 2.0,
                                 sample_rate: int = 16000) -> np.ndarray:
        """
        Create audio that simulates speech patterns based on text.
        
        This is a placeholder - in production you'd use TTS.
        """
        num_samples = int(duration * sample_rate)
        t = np.linspace(0, duration, num_samples)
        
        # Simulate formants based on text length
        base_freq = 100 + len(text) * 5
        
        audio = np.zeros(num_samples)
        # F0 (fundamental)
        audio += 0.4 * np.sin(2 * np.pi * base_freq * t)
        # F1 (first formant)
        audio += 0.3 * np.sin(2 * np.pi * (base_freq * 3) * t)
        # F2 (second formant)
        audio += 0.2 * np.sin(2 * np.pi * (base_freq * 5) * t)
        # F3 (third formant)
        audio += 0.1 * np.sin(2 * np.pi * (base_freq * 8) * t)
        
        # Apply envelope to simulate speech rhythm
        words = text.split()
        word_duration = duration / max(len(words), 1)
        envelope = np.ones(num_samples)
        
        for i, word in enumerate(words):
            start_idx = int(i * word_duration * sample_rate)
            end_idx = min(int((i + 1) * word_duration * sample_rate), num_samples)
            word_len = end_idx - start_idx
            
            # Create attack-decay envelope for each word
            if word_len > 0:
                attack = np.linspace(0, 1, word_len // 4)
                sustain = np.ones(word_len // 2)
                decay = np.linspace(1, 0.3, word_len - len(attack) - len(sustain))
                word_envelope = np.concatenate([attack, sustain, decay])
                envelope[start_idx:end_idx] = word_envelope[:word_len]
        
        audio *= envelope
        
        return audio.astype(np.float32)
    
    def send_audio(self, 
                   audio: np.ndarray,
                   sample_rate: int = 16000,
                   channels: int = 1) -> str:
        """
        Send audio chunk for transcription.
        
        Args:
            audio: Audio samples
            sample_rate: Sample rate in Hz
            channels: Number of channels
            
        Returns:
            Chunk ID
        """
        chunk_id = uuid.uuid4()
        
        # Create audio chunk message matching Rust's AudioChunk struct
        # IMPORTANT: UUIDs must be raw bytes for Rust deserialization
        audio_chunk = {
            "id": chunk_id.bytes,  # Raw 16-byte UUID, not string!
            "audio": audio.tolist(),  # Convert numpy array to list
            "sample_rate": sample_rate,
            "channels": channels,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": None,
        }
        
        # Wrap in QueueItem to match Rust's expected format
        queue_item = {
            "id": uuid.uuid4().bytes,  # Queue item ID as bytes too
            "data": audio_chunk,       # The actual AudioChunk goes in data field
            "timestamp": int(time.time()),  # Unix timestamp in seconds
        }
        
        # Serialize with MessagePack
        message = msgpack.packb(queue_item, use_bin_type=True)
        
        # Send via ZeroMQ
        self.push_socket.send(message)
        
        print(f"📤 Sent audio chunk:")
        print(f"   ID: {chunk_id}")
        print(f"   Duration: {len(audio)/sample_rate:.2f}s")
        print(f"   Size: {len(message)} bytes")
        
        return str(chunk_id)  # Return as string for display/comparison
    
    def receive_result(self, timeout: int = 30) -> Optional[Dict[str, Any]]:
        """
        Receive a transcription result.
        
        Args:
            timeout: Timeout in seconds
            
        Returns:
            Transcription result or None if timeout
        """
        print(f"⏳ Waiting for result (timeout: {timeout}s)...")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                # Try to receive a message
                message = self.pull_socket.recv()
                result = msgpack.unpackb(message, raw=False)
                
                print(f"✅ Result received!")
                return result
                
            except zmq.Again:
                # Timeout on receive, continue waiting
                sys.stdout.write(".")
                sys.stdout.flush()
                continue
            except Exception as e:
                print(f"\n❌ Error receiving result: {e}")
                return None
        
        print(f"\n⏱️ Timeout - no result received")
        return None
    
    def wait_for_result(self, chunk_id: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
        """
        Wait for a specific result by chunk ID.
        
        Args:
            chunk_id: The chunk ID to wait for
            timeout: Timeout in seconds
            
        Returns:
            Transcription result or None if timeout
        """
        print(f"⏳ Waiting for result {chunk_id[:8]}... (timeout: {timeout}s)")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            result = self.receive_result(timeout=1)
            if result:
                # Check if this is our result
                if isinstance(result, dict):
                    result_id = result.get("id")
                    if not result_id and "Ok" in result:
                        result_id = result["Ok"].get("id")
                    elif not result_id and "Err" in result:
                        result_id = result["Err"].get("id")
                    
                    if result_id == chunk_id:
                        self._print_result(result)
                        return result
                    else:
                        print(f"   (Received result for different chunk: {result_id[:8]}...)")
        
        print(f"⏱️ Timeout - result for {chunk_id[:8]}... not received")
        return None
    
    def _print_result(self, result: Dict[str, Any]):
        """Pretty print a transcription result."""
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
        else:
            print(f"   Result: {result}")
    
    def close(self):
        """Close ZeroMQ sockets and context."""
        self.push_socket.close()
        self.pull_socket.close()
        self.context.term()
        print("👋 ZeroMQ connections closed")

def interactive_menu():
    """Interactive test menu."""
    client = ZmqTranscriberClient()
    
    try:
        while True:
            print("\n" + "=" * 50)
            print("ZeroMQ Scout Transcriber Test Client")
            print("=" * 50)
            print("1. Send test tone (440 Hz)")
            print("2. Send frequency sweep")
            print("3. Send speech-like audio")
            print("4. Send multiple chunks (batch test)")
            print("5. Custom frequency tone")
            print("0. Exit")
            
            choice = input("\nChoice: ").strip()
            
            if choice == "0":
                break
            
            elif choice == "1":
                audio = client.create_test_audio(duration=2.0, frequency=440)
                chunk_id = client.send_audio(audio)
                client.wait_for_result(chunk_id)
            
            elif choice == "2":
                # Frequency sweep
                duration = 3.0
                sample_rate = 16000
                t = np.linspace(0, duration, int(duration * sample_rate))
                # Sweep from 200 Hz to 2000 Hz
                freq_sweep = 200 + (2000 - 200) * t / duration
                audio = np.sin(2 * np.pi * freq_sweep * t) * 0.3
                audio = audio.astype(np.float32)
                
                print("🎵 Sending frequency sweep (200-2000 Hz)...")
                chunk_id = client.send_audio(audio, sample_rate)
                client.wait_for_result(chunk_id)
            
            elif choice == "3":
                text = input("Enter text to simulate: ") or "Hello world, this is a test"
                audio = client.create_speech_like_audio(text, duration=3.0)
                chunk_id = client.send_audio(audio)
                client.wait_for_result(chunk_id)
            
            elif choice == "4":
                n = int(input("How many chunks? ") or "3")
                chunk_ids = []
                
                print(f"\n📦 Sending {n} audio chunks...")
                for i in range(n):
                    freq = 300 + i * 100  # Different frequency for each chunk
                    audio = client.create_test_audio(duration=1.0, frequency=freq)
                    chunk_id = client.send_audio(audio)
                    chunk_ids.append(chunk_id)
                    time.sleep(0.1)
                
                print(f"\n⏳ Waiting for {n} results...")
                for chunk_id in chunk_ids:
                    client.wait_for_result(chunk_id, timeout=10)
            
            elif choice == "5":
                freq = float(input("Enter frequency (Hz): ") or "440")
                duration = float(input("Enter duration (seconds): ") or "2.0")
                audio = client.create_test_audio(duration=duration, frequency=freq)
                chunk_id = client.send_audio(audio)
                client.wait_for_result(chunk_id)
    
    finally:
        client.close()

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="ZeroMQ Scout Transcriber Test Client")
    parser.add_argument("--push", default="tcp://127.0.0.1:5555",
                       help="Push endpoint for audio")
    parser.add_argument("--pull", default="tcp://127.0.0.1:5556",
                       help="Pull endpoint for results")
    parser.add_argument("--quick", action="store_true",
                       help="Run quick test and exit")
    
    args = parser.parse_args()
    
    if args.quick:
        # Quick test
        client = ZmqTranscriberClient(args.push, args.pull)
        
        try:
            print("\n🧪 Running quick test...")
            audio = client.create_test_audio(duration=2.0, frequency=440)
            chunk_id = client.send_audio(audio)
            result = client.wait_for_result(chunk_id)
            
            if result:
                print("✅ Test passed!")
            else:
                print("❌ Test failed - no result received")
                sys.exit(1)
        finally:
            client.close()
    else:
        # Interactive mode
        interactive_menu()

if __name__ == "__main__":
    main()