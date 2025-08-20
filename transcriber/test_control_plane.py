#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Test client for control plane monitoring."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    """Send test audio to ZeroMQ queue."""
    context = zmq.Context()
    
    # Connect to the push socket
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    # Connect to pull socket for results
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 5000)  # 5 second timeout
    
    logger.info("Connected to ZeroMQ endpoints")
    
    # Create test audio
    sample_rate = 16000
    duration = 3  # seconds
    audio = np.random.randn(sample_rate * duration).astype(np.float32) * 0.1
    
    # Create audio chunk with UUID as bytes
    chunk_id = uuid.uuid4()
    audio_chunk = {
        "id": chunk_id.bytes,  # Send as raw 16-byte array
        "audio": audio.tolist(),
        "sample_rate": sample_rate,
        "timestamp": time.time(),
    }
    
    # Wrap in QueueItem
    queue_item = {
        "data": audio_chunk,
        "priority": 0,
        "timestamp": time.time(),
    }
    
    # Send message
    message = msgpack.packb(queue_item, use_bin_type=True)
    push_socket.send(message)
    logger.info(f"Sent audio chunk {chunk_id} ({len(message)} bytes)")
    
    # Wait for result
    logger.info("Waiting for transcription result...")
    try:
        result_msg = pull_socket.recv()
        result = msgpack.unpackb(result_msg, raw=False)
        
        if "Ok" in result:
            transcript = result["Ok"]
            logger.info(f"Received transcript: '{transcript['text']}'")
            logger.info(f"  Confidence: {transcript['confidence']}")
            logger.info(f"  Processing time: {transcript['metadata']['processing_time_ms']}ms")
            logger.info(f"  Worker: {transcript['metadata']['worker_id']}")
        else:
            logger.error(f"Received error: {result['Err']}")
            
    except zmq.Again:
        logger.error("Timeout waiting for result")
    
    # Clean up
    push_socket.close()
    pull_socket.close()
    context.term()
    logger.info("Done")

if __name__ == "__main__":
    main()