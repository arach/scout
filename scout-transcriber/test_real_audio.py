#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Test with simulated speech audio."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_speech_like_audio(text_hint="Hello, this is a test", duration=3, sample_rate=16000):
    """Generate audio that simulates speech patterns."""
    samples = duration * sample_rate
    t = np.linspace(0, duration, samples)
    
    # Create a more speech-like waveform with varying frequency
    # Speech typically has fundamental frequency 85-255 Hz
    fundamental = 120 + 50 * np.sin(2 * np.pi * 0.5 * t)  # Varying pitch
    
    # Add harmonics
    audio = np.sin(2 * np.pi * fundamental * t)
    audio += 0.5 * np.sin(2 * np.pi * 2 * fundamental * t)
    audio += 0.3 * np.sin(2 * np.pi * 3 * fundamental * t)
    
    # Add envelope to simulate words/syllables
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
    audio = audio * envelope
    
    # Add some noise
    audio += 0.05 * np.random.randn(samples)
    
    # Normalize
    audio = audio / np.max(np.abs(audio)) * 0.3
    
    return audio.astype(np.float32)

def main():
    """Send test audio to ZeroMQ queue."""
    context = zmq.Context()
    
    # Connect to the ports where Python worker is binding
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 10000)  # 10 second timeout
    
    logger.info("Connected to ZeroMQ endpoints")
    
    # Create more realistic audio
    audio = generate_speech_like_audio("Testing the transcription system", duration=3)
    
    chunk_id = uuid.uuid4()
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
    
    # Send message
    message = msgpack.packb(queue_item, use_bin_type=True)
    push_socket.send(message)
    logger.info(f"Sent speech-like audio chunk {chunk_id} ({len(audio)} samples)")
    
    # Wait for result
    logger.info("Waiting for transcription result...")
    try:
        result_msg = pull_socket.recv()
        result = msgpack.unpackb(result_msg, raw=False)
        
        if "Ok" in result:
            transcript = result["Ok"]
            logger.info(f"✅ Transcription: '{transcript['text']}'")
            logger.info(f"   Confidence: {transcript['confidence']}")
            logger.info(f"   Processing time: {transcript['metadata']['processing_time_ms']}ms")
            logger.info(f"   Worker: {transcript['metadata']['worker_id']}")
        else:
            logger.error(f"❌ Error: {result['Err']}")
            
    except zmq.Again:
        logger.error("Timeout waiting for result")
    
    # Clean up
    push_socket.close()
    pull_socket.close()
    context.term()

if __name__ == "__main__":
    main()