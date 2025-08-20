#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
# ]
# ///
"""Test UUID serialization formats for Rust compatibility."""

import zmq
import msgpack
import uuid
import time
from datetime import datetime, timezone

def test_uuid_formats():
    context = zmq.Context()
    socket = context.socket(zmq.PUSH)
    socket.connect("tcp://127.0.0.1:5555")
    
    # Test different UUID serialization approaches
    test_uuid = uuid.uuid4()
    
    # Format 1: UUID as raw bytes (16 bytes) - what Rust expects
    audio_chunk_bytes = {
        "id": test_uuid.bytes,  # Raw 16-byte UUID
        "audio": [0.1, 0.2, 0.3],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "2025-08-19T12:00:00Z",
        "metadata": None,
    }
    
    queue_item_bytes = {
        "id": uuid.uuid4().bytes,  # Queue item ID as bytes too
        "data": audio_chunk_bytes,
        "timestamp": int(time.time()),
    }
    
    # Format 2: Using MessagePack extension type for UUID
    # Custom packer that handles UUIDs specially
    def default(obj):
        if isinstance(obj, uuid.UUID):
            return msgpack.ExtType(37, obj.bytes)  # 37 is arbitrary type code for UUID
        raise TypeError(f"Unknown type: {obj}")
    
    # Format 3: Convert UUID to bytes dict that matches Rust's serde
    def uuid_to_rust_format(u):
        # Rust's UUID serde format expects raw bytes
        return u.bytes
    
    audio_chunk_rust = {
        "id": uuid_to_rust_format(test_uuid),
        "audio": [0.1, 0.2, 0.3],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": "2025-08-19T12:00:00Z",
        "metadata": None,
    }
    
    queue_item_rust = {
        "id": uuid_to_rust_format(uuid.uuid4()),
        "data": audio_chunk_rust,
        "timestamp": int(time.time()),
    }
    
    tests = [
        ("Raw bytes UUID", queue_item_bytes),
        ("Rust format UUID", queue_item_rust),
    ]
    
    for name, data in tests:
        try:
            message = msgpack.packb(data, use_bin_type=True)
            print(f"\n{name}:")
            print(f"  Size: {len(message)} bytes")
            print(f"  First 80 bytes (hex): {message[:80].hex()}")
            
            socket.send(message)
            print(f"  ✅ Sent!")
            
            time.sleep(0.5)
        except Exception as e:
            print(f"  ❌ Error: {e}")
    
    # Wait and check logs
    print("\nWaiting for processing...")
    time.sleep(2)
    
    socket.close()
    context.term()
    print("\n✅ Done!")

if __name__ == "__main__":
    test_uuid_formats()