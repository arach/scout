#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
# ]
# ///
"""Direct test sending raw bytes to debug format issues."""

import zmq
import msgpack
import uuid
import time
from datetime import datetime, timezone

def test_send():
    context = zmq.Context()
    socket = context.socket(zmq.PUSH)
    socket.connect("tcp://127.0.0.1:5555")
    
    # Create exact format matching Rust structs
    chunk_id = str(uuid.uuid4())
    
    # AudioChunk matching Rust struct exactly
    audio_chunk = {
        "id": chunk_id,
        "audio": [0.1] * 100,  # 100 samples
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "2025-08-19T12:00:00.000000000Z",  # RFC3339 format
        "metadata": None,
    }
    
    # Wrap in QueueItem as Rust expects
    queue_item = {
        "id": str(uuid.uuid4()),
        "data": audio_chunk,
        "timestamp": int(time.time()),
    }
    
    # Pack and send
    message = msgpack.packb(queue_item, use_bin_type=True)
    
    print(f"Sending message:")
    print(f"  Queue ID: {queue_item['id']}")
    print(f"  Chunk ID: {chunk_id}")
    print(f"  Size: {len(message)} bytes")
    print(f"  First 100 bytes (hex): {message[:100].hex()}")
    
    socket.send(message)
    print("✅ Message sent!")
    
    # Clean up
    socket.close()
    context.term()

if __name__ == "__main__":
    test_send()