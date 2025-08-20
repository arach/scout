#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
#   "torch",
#   "transformers",
#   "huggingface-hub",
# ]
# ///
"""
ZeroMQ-based transcription worker for scout-transcriber.
Pulls audio from input queue, transcribes, and pushes results to output queue.
"""

import sys
import time
import uuid
import logging
import traceback
from typing import Dict, Any, Optional
from datetime import datetime, timezone

import zmq
import msgpack
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger(__name__)


class ZmqTranscriptionWorker:
    """ZeroMQ-based transcription worker."""
    
    def __init__(self, 
                 input_endpoint: str = "tcp://127.0.0.1:5555",
                 output_endpoint: str = "tcp://127.0.0.1:5556",
                 model_type: str = "whisper",
                 worker_id: Optional[str] = None):
        """
        Initialize the ZeroMQ worker.
        
        Args:
            input_endpoint: Where to pull audio chunks from
            output_endpoint: Where to push results to
            model_type: Type of model to use
            worker_id: Optional worker identifier
        """
        self.model_type = model_type
        self.worker_id = worker_id or str(uuid.uuid4())
        self.context = zmq.Context()
        
        # Create PULL socket for receiving audio
        self.pull_socket = self.context.socket(zmq.PULL)
        self.pull_socket.connect(input_endpoint)
        
        # Create PUSH socket for sending results
        self.push_socket = self.context.socket(zmq.PUSH)
        self.push_socket.connect(output_endpoint)
        
        # Set receive timeout
        self.pull_socket.setsockopt(zmq.RCVTIMEO, 1000)  # 1 second timeout
        
        logger.info(f"Worker {self.worker_id} connected to ZeroMQ endpoints:")
        logger.info(f"  Input (PULL): {input_endpoint}")
        logger.info(f"  Output (PUSH): {output_endpoint}")
        
        # Initialize the model
        self.model = self._load_model()
        
        # Current processing state
        self.current_message_id = None
        self.processing_start_time = None
        
        self.stats = {
            'processed': 0,
            'errors': 0,
            'start_time': time.time(),
            'last_heartbeat': time.time()
        }
    
    def _load_model(self):
        """Load the transcription model."""
        logger.info(f"Loading {self.model_type} model...")
        
        try:
            from transformers import WhisperProcessor, WhisperForConditionalGeneration
            import torch
            
            model_name = "openai/whisper-base"
            self.processor = WhisperProcessor.from_pretrained(model_name)
            self.model = WhisperForConditionalGeneration.from_pretrained(model_name)
            
            # Move to GPU if available
            if torch.cuda.is_available():
                self.model = self.model.to("cuda")
                logger.info("Model loaded on GPU")
            else:
                logger.info("Model loaded on CPU")
                
            return self.model
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            logger.warning("Using mock transcription for testing")
            return None
    
    def transcribe(self, audio: np.ndarray, sample_rate: int) -> tuple[str, float]:
        """Transcribe audio to text."""
        if self.model is None:
            # Mock transcription for testing
            return f"[Mock] Transcribed {len(audio)} samples at {sample_rate}Hz", 0.95
        
        try:
            import torch
            
            # Process audio
            inputs = self.processor(
                audio, 
                sampling_rate=sample_rate, 
                return_tensors="pt"
            )
            
            # Move to same device as model
            if torch.cuda.is_available():
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
            # Generate transcription
            generated_ids = self.model.generate(inputs["input_features"])
            transcription = self.processor.batch_decode(
                generated_ids, 
                skip_special_tokens=True
            )[0]
            
            return transcription, 0.95
            
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise
    
    def process_message(self, message: bytes) -> Optional[Dict[str, Any]]:
        """Process a message from the queue."""
        try:
            # Deserialize the QueueItem wrapper
            queue_item = msgpack.unpackb(message, raw=False)
            
            # Extract the AudioChunk from the data field
            audio_chunk = queue_item.get('data', {})
            
            # Convert UUID bytes back to string for display
            chunk_id_bytes = audio_chunk.get('id')
            if isinstance(chunk_id_bytes, bytes) and len(chunk_id_bytes) == 16:
                # Convert 16-byte UUID to string
                chunk_id = str(uuid.UUID(bytes=chunk_id_bytes))
            else:
                chunk_id = str(chunk_id_bytes)
            
            # Track current processing
            self.current_message_id = chunk_id
            self.processing_start_time = time.time()
            
            logger.info(f"Worker {self.worker_id} processing audio chunk: {chunk_id}")
            
            # Extract audio data
            audio = np.array(audio_chunk['audio'], dtype=np.float32)
            sample_rate = audio_chunk['sample_rate']
            
            # Transcribe
            text, confidence = self.transcribe(audio, sample_rate)
            
            # Calculate actual processing time
            processing_time_ms = int((time.time() - self.processing_start_time) * 1000)
            
            # Create transcript result
            transcript = {
                "id": chunk_id_bytes,  # Keep as bytes for Rust
                "text": text,
                "confidence": confidence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "metadata": {
                    "language": "en",  # Could be detected
                    "processing_time_ms": processing_time_ms,
                    "model": self.model_type,
                    "worker_id": self.worker_id,  # Include worker ID for tracking
                    "extra": {
                        "sample_rate": str(sample_rate),
                        "duration_ms": str(len(audio) * 1000 // sample_rate)
                    }
                }
            }
            
            # Wrap in Result::Ok for Rust
            result = {"Ok": transcript}
            
            self.stats['processed'] += 1
            logger.info(f"Transcribed: '{text[:50]}...'")
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to process message: {e}")
            logger.error(traceback.format_exc())
            self.stats['errors'] += 1
            
            # Return error result
            error = {
                "Err": {
                    "id": chunk_id_bytes if 'chunk_id_bytes' in locals() else b"unknown",
                    "message": str(e),
                    "error_code": "PROCESSING_ERROR",
                    "worker_id": self.worker_id
                }
            }
            return error
    
    def run(self):
        """Main worker loop."""
        logger.info(f"Starting ZeroMQ transcription worker")
        
        while True:
            try:
                # Try to receive a message
                message = self.pull_socket.recv()
                logger.debug(f"Received message ({len(message)} bytes)")
                
                # Process the message
                result = self.process_message(message)
                
                if result:
                    # Serialize and send result
                    result_msg = msgpack.packb(result, use_bin_type=True)
                    self.push_socket.send(result_msg)
                    logger.debug("Sent result to output queue")
                
            except zmq.Again:
                # Timeout - no message available
                continue
                
            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                break
                
            except Exception as e:
                logger.error(f"Worker error: {e}")
                logger.error(traceback.format_exc())
                continue
        
        logger.info("Worker shutting down")
        logger.info(f"Stats: {self.stats}")
        
        # Clean up
        self.pull_socket.close()
        self.push_socket.close()
        self.context.term()


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='ZeroMQ Transcription Worker')
    parser.add_argument('--input', default='tcp://127.0.0.1:5555',
                       help='Input queue endpoint')
    parser.add_argument('--output', default='tcp://127.0.0.1:5556',
                       help='Output queue endpoint')
    parser.add_argument('--model', default='whisper',
                       choices=['whisper', 'parakeet'],
                       help='Model type')
    parser.add_argument('--worker-id', default=None,
                       help='Worker identifier (auto-generated if not provided)')
    parser.add_argument('--log-level', default='INFO',
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                       help='Logging level')
    
    args = parser.parse_args()
    
    # Set logging level
    logging.getLogger().setLevel(getattr(logging, args.log_level))
    
    # Create and run worker
    worker = ZmqTranscriptionWorker(
        input_endpoint=args.input,
        output_endpoint=args.output,
        model_type=args.model,
        worker_id=args.worker_id
    )
    worker.run()


if __name__ == '__main__':
    main()