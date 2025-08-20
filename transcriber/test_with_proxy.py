#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Test the complete pipeline with proxy."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging
from threading import Thread

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def start_worker(worker_id):
    """Start a test worker that connects to proxy backend."""
    context = zmq.Context()
    
    # Connect to proxy backend ports
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5559")  # Backend OUT
    
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5558")  # Backend IN
    
    # Control plane
    control_socket = context.socket(zmq.PUSH)
    control_socket.connect("tcp://127.0.0.1:5557")
    
    logger.info(f"Worker {worker_id} started")
    
    # Send started status
    status = {
        "worker_id": worker_id,
        "status": {"type": "Started"},
        "timestamp": time.time(),
        "metadata": None
    }
    control_socket.send(msgpack.packb(status, use_bin_type=True), zmq.NOBLOCK)
    
    # Process messages
    while True:
        try:
            msg = pull_socket.recv()
            queue_item = msgpack.unpackb(msg, raw=False)
            audio_chunk = queue_item.get('data', {})
            
            chunk_id_bytes = audio_chunk.get('id')
            if isinstance(chunk_id_bytes, bytes) and len(chunk_id_bytes) == 16:
                chunk_id = str(uuid.UUID(bytes=chunk_id_bytes))
            else:
                chunk_id = "unknown"
            
            logger.info(f"Worker {worker_id} processing {chunk_id}")
            
            # Send MessageReceived status
            status = {
                "worker_id": worker_id,
                "status": {"type": "MessageReceived", "message_id": chunk_id},
                "timestamp": time.time(),
                "metadata": None
            }
            control_socket.send(msgpack.packb(status, use_bin_type=True), zmq.NOBLOCK)
            
            # Simulate processing
            time.sleep(0.1)
            
            # Create result
            transcript = {
                "id": chunk_id_bytes,
                "text": f"Test transcription from worker {worker_id}",
                "confidence": 0.95,
                "timestamp": time.time(),
                "metadata": {
                    "worker_id": worker_id,
                    "processing_time_ms": 100
                }
            }
            
            result = {"Ok": transcript}
            push_socket.send(msgpack.packb(result, use_bin_type=True))
            
            # Send MessageCompleted status
            status = {
                "worker_id": worker_id,
                "status": {"type": "MessageCompleted", "message_id": chunk_id, "success": True, "duration_ms": 100},
                "timestamp": time.time(),
                "metadata": None
            }
            control_socket.send(msgpack.packb(status, use_bin_type=True), zmq.NOBLOCK)
            
            logger.info(f"Worker {worker_id} completed {chunk_id}")
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            logger.error(f"Worker {worker_id} error: {e}")
            break
    
    # Clean up
    pull_socket.close()
    push_socket.close()
    control_socket.close()
    context.term()

def main():
    """Test client that sends through proxy."""
    # Start a worker in the background
    worker_thread = Thread(target=start_worker, args=("test-worker-1",), daemon=True)
    worker_thread.start()
    
    # Give worker time to start
    time.sleep(1)
    
    context = zmq.Context()
    
    # Connect to proxy frontend
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 5000)
    
    logger.info("Client connected to proxy frontend")
    
    # Send test message
    chunk_id = uuid.uuid4()
    audio = np.random.randn(16000).astype(np.float32) * 0.1
    
    audio_chunk = {
        "id": chunk_id.bytes,
        "audio": audio.tolist(),
        "sample_rate": 16000,
        "timestamp": time.time(),
    }
    
    queue_item = {
        "data": audio_chunk,
        "priority": 0,
        "timestamp": time.time(),
    }
    
    message = msgpack.packb(queue_item, use_bin_type=True)
    push_socket.send(message)
    logger.info(f"Client sent audio chunk {chunk_id}")
    
    # Wait for result
    try:
        result_msg = pull_socket.recv()
        result = msgpack.unpackb(result_msg, raw=False)
        
        if "Ok" in result:
            transcript = result["Ok"]
            logger.info(f"Client received: '{transcript['text']}'")
            logger.info("✅ Test successful!")
        else:
            logger.error(f"Client received error: {result['Err']}")
            
    except zmq.Again:
        logger.error("Timeout waiting for result")
    
    # Clean up
    push_socket.close()
    pull_socket.close()
    context.term()

if __name__ == "__main__":
    main()