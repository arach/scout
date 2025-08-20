#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
# ]
# ///
"""Test MessagePack format for AudioChunk."""

import msgpack
import uuid
import time
from datetime import datetime, timezone

# Test different message formats
def test_formats():
    chunk_id = str(uuid.uuid4())
    
    # Format 1: Raw AudioChunk (what originally failed)
    raw_chunk = {
        "id": chunk_id,
        "audio": [0.1, 0.2, 0.3],  # Small test data
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": None,
    }
    
    # Format 2: Wrapped in QueueItem
    queue_item = {
        "id": str(uuid.uuid4()),
        "data": raw_chunk,
        "timestamp": int(time.time()),
    }
    
    # Format 3: Using proper UUID format for Rust
    # Rust UUID expects specific format
    rust_uuid_bytes = uuid.uuid4().bytes
    rust_chunk = {
        "id": chunk_id,  # Try string first
        "audio": [0.1, 0.2, 0.3],
        "sample_rate": 16000,
        "channels": 1,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": None,
    }
    
    print("Testing MessagePack formats:")
    print("-" * 50)
    
    # Test each format
    for name, data in [("Raw", raw_chunk), ("Queue", queue_item), ("Rust", rust_chunk)]:
        packed = msgpack.packb(data, use_bin_type=True)
        print(f"{name} format:")
        print(f"  Size: {len(packed)} bytes")
        print(f"  Hex (first 50): {packed[:50].hex()}")
        unpacked = msgpack.unpackb(packed, raw=False)
        print(f"  Roundtrip OK: {unpacked == data}")
        print()

if __name__ == "__main__":
    test_formats()