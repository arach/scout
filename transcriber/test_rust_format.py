#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
# ]
# ///
"""Test with exact Rust-compatible MessagePack format."""

import zmq
import msgpack
import uuid
import struct
from datetime import datetime, timezone

def uuid_to_msgpack_ext(u):
    """Convert UUID to MessagePack extension type that Rust might expect."""
    # Try as raw bytes (16 bytes)
    return u.bytes

def test_formats():
    context = zmq.Context()
    socket = context.socket(zmq.PUSH)
    socket.connect("tcp://127.0.0.1:5555")
    
    # Test 1: UUID as hyphenated string
    chunk_uuid = uuid.uuid4()
    chunk_id_str = str(chunk_uuid)
    
    audio_chunk1 = {
        "id": chunk_id_str,
        "audio": [0.1, 0.2, 0.3],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "2025-08-19T12:00:00Z",
        "metadata": None,
    }
    
    queue_item1 = {
        "id": str(uuid.uuid4()),
        "data": audio_chunk1,
        "timestamp": 1729361000,
    }
    
    # Test 2: UUID as hex string (no hyphens)
    audio_chunk2 = {
        "id": chunk_uuid.hex,
        "audio": [0.1, 0.2, 0.3],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "2025-08-19T12:00:00Z",
        "metadata": None,
    }
    
    queue_item2 = {
        "id": uuid.uuid4().hex,
        "data": audio_chunk2,
        "timestamp": 1729361000,
    }
    
    # Test 3: Just send the data field directly (not wrapped)
    # Maybe the issue is we're double-wrapping?
    
    tests = [
        ("Hyphenated UUID", queue_item1),
        ("Hex UUID", queue_item2),
        ("Direct AudioChunk", audio_chunk1),  # Try without QueueItem wrapper
    ]
    
    for name, data in tests:
        message = msgpack.packb(data, use_bin_type=True)
        print(f"\nTesting {name}:")
        print(f"  Size: {len(message)} bytes")
        print(f"  First 50 bytes (hex): {message[:50].hex()}")
        
        socket.send(message)
        print(f"  ✅ Sent!")
        
        import time
        time.sleep(0.5)  # Give service time to process
    
    # Check log for errors
    print("\nWaiting 2 seconds then checking logs...")
    import time
    time.sleep(2)
    
    socket.close()
    context.term()

if __name__ == "__main__":
    test_formats()