#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
# ]
# ///
"""
Test script for the transcription worker.
"""

import sys
import struct
import msgpack
import numpy as np
import time


def send_message(message):
    """Send a message to stdout."""
    data = msgpack.packb(message, use_bin_type=True)
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    # Test heartbeat
    heartbeat_msg = {
        'type': 'Heartbeat',
        'data': {}
    }
    send_message(heartbeat_msg)
    
    # Test audio chunk
    audio_chunk_msg = {
        'type': 'AudioChunk',
        'data': {
            'id': 'test-123',
            'audio': np.random.randn(16000).tolist(),  # 1 second of audio at 16kHz
            'sample_rate': 16000,
            'channels': 1,
            'timestamp': int(time.time() * 1000)
        }
    }
    send_message(audio_chunk_msg)
    
    # Test shutdown
    shutdown_msg = {
        'type': 'Control',
        'data': {'command': 'shutdown'}
    }
    send_message(shutdown_msg)


if __name__ == '__main__':
    main()