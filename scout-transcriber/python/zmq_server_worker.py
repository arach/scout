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
ZeroMQ server-mode transcription worker for scout-transcriber.
Binds to ports and acts as the server for the PUSH/PULL pattern.
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

# Configure logging to both stderr and file
log_handlers = [
    logging.StreamHandler(sys.stderr),
    logging.FileHandler('/tmp/scout-transcriber.log', mode='a')
]

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [PYTHON] %(name)s - %(levelname)s - %(message)s',
    handlers=log_handlers
)
logger = logging.getLogger(__name__)


class ZmqServerWorker:
    """ZeroMQ server-mode transcription worker."""
    
    def __init__(self, 
                 input_endpoint: str = "tcp://127.0.0.1:5555",
                 output_endpoint: str = "tcp://127.0.0.1:5556",
                 control_endpoint: str = "tcp://127.0.0.1:5557",
                 model_type: str = "whisper",
                 worker_id: Optional[str] = None):
        """
        Initialize the ZeroMQ server worker.
        
        Args:
            input_endpoint: Where to bind PULL socket (receive audio)
            output_endpoint: Where to bind PUSH socket (send results)
            control_endpoint: Where to connect for status updates
            model_type: Type of model to use
            worker_id: Optional worker identifier
        """
        self.model_type = model_type
        self.worker_id = worker_id or str(uuid.uuid4())
        self.context = zmq.Context()
        
        # Create PULL socket and BIND (server mode) for receiving audio
        self.pull_socket = self.context.socket(zmq.PULL)
        self.pull_socket.bind(input_endpoint)
        logger.info(f"Worker {self.worker_id} bound PULL socket to {input_endpoint}")
        
        # Create PUSH socket and BIND (server mode) for sending results
        self.push_socket = self.context.socket(zmq.PUSH)
        self.push_socket.bind(output_endpoint)
        logger.info(f"Worker {self.worker_id} bound PUSH socket to {output_endpoint}")
        
        # Create PUSH socket for control plane (connect as client)
        self.control_socket = self.context.socket(zmq.PUSH)
        self.control_socket.connect(control_endpoint)
        logger.info(f"Worker {self.worker_id} connected to control plane at {control_endpoint}")
        
        # Set receive timeout
        self.pull_socket.setsockopt(zmq.RCVTIMEO, 1000)  # 1 second timeout
        
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
            import torch
            
            if self.model_type == "parakeet":
                # Load NVIDIA Parakeet TDT 0.6B v3
                import nemo.collections.asr as nemo_asr
                
                model_name = "nvidia/parakeet-tdt-0.6b"
                logger.info(f"Loading NVIDIA Parakeet TDT model: {model_name}")
                
                # Load Parakeet model from NVIDIA
                self.model = nemo_asr.models.ASRModel.from_pretrained(model_name)
                self.processor = None  # Parakeet handles its own preprocessing
                
                # Move to GPU if available
                if torch.cuda.is_available():
                    self.model = self.model.cuda()
                    logger.info("Parakeet model loaded on GPU")
                else:
                    logger.info("Parakeet model loaded on CPU")
                    
            else:
                # Default to Whisper
                from transformers import WhisperProcessor, WhisperForConditionalGeneration
                
                model_name = "openai/whisper-base"
                self.processor = WhisperProcessor.from_pretrained(model_name)
                self.model = WhisperForConditionalGeneration.from_pretrained(model_name)
                
                # Move to GPU if available
                if torch.cuda.is_available():
                    self.model = self.model.to("cuda")
                    logger.info("Whisper model loaded on GPU")
                else:
                    logger.info("Whisper model loaded on CPU")
                
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
            
            if self.model_type == "parakeet":
                # Parakeet transcription
                # Ensure audio is in the right format (Parakeet expects 16kHz)
                if sample_rate != 16000:
                    logger.warning(f"Parakeet expects 16kHz audio, got {sample_rate}Hz")
                
                # Convert to tensor and add batch dimension
                audio_tensor = torch.from_numpy(audio).unsqueeze(0)
                
                # Move to GPU if available
                if torch.cuda.is_available():
                    audio_tensor = audio_tensor.cuda()
                
                # Transcribe with Parakeet
                with torch.no_grad():
                    transcription = self.model.transcribe([audio_tensor])[0]
                
                return transcription, 0.95
                
            else:
                # Whisper transcription
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
    
    def send_status(self, status_type: str, **kwargs):
        """Send status update to control plane."""
        try:
            status = {
                "worker_id": self.worker_id,
                "status": {
                    "type": status_type,
                    **kwargs
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "metadata": None
            }
            
            # Send status update
            status_msg = msgpack.packb(status, use_bin_type=True)
            self.control_socket.send(status_msg, zmq.NOBLOCK)
            logger.debug(f"Sent status: {status_type}")
            
        except zmq.Again:
            # Control socket is full, skip this update
            logger.debug(f"Control socket full, skipping status: {status_type}")
        except Exception as e:
            logger.error(f"Failed to send status: {e}")
    
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
            
            # Send status: message received
            self.send_status("MessageReceived", message_id=chunk_id)
            
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
                    "worker_id": self.worker_id,
                    "extra": {
                        "sample_rate": str(sample_rate),
                        "duration_ms": str(len(audio) * 1000 // sample_rate)
                    }
                }
            }
            
            # Wrap in Result::Ok for Rust
            result = {"Ok": transcript}
            
            # Send status: message completed successfully
            self.send_status("MessageCompleted", 
                           message_id=chunk_id, 
                           success=True,
                           duration_ms=processing_time_ms)
            
            self.stats['processed'] += 1
            logger.info(f"Transcribed: '{text[:50]}...'")
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to process message: {e}")
            logger.error(traceback.format_exc())
            self.stats['errors'] += 1
            
            # Send status: message failed
            if 'chunk_id' in locals():
                processing_time_ms = int((time.time() - self.processing_start_time) * 1000) if self.processing_start_time else 0
                self.send_status("MessageCompleted",
                               message_id=chunk_id,
                               success=False,
                               duration_ms=processing_time_ms)
            
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
        logger.info(f"Starting ZeroMQ server worker (binding mode)")
        
        # Send started status
        self.send_status("Started")
        
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
                # Send heartbeat if enough time has passed
                if time.time() - self.stats['last_heartbeat'] > 30:  # Every 30 seconds
                    uptime = int(time.time() - self.stats['start_time'])
                    self.send_status("Heartbeat",
                                   messages_processed=self.stats['processed'],
                                   uptime_seconds=uptime)
                    self.stats['last_heartbeat'] = time.time()
                continue
                
            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                # Send stopping status
                self.send_status("Stopping")
                break
                
            except Exception as e:
                logger.error(f"Worker error: {e}")
                logger.error(traceback.format_exc())
                # Send error status
                self.send_status("Error", message=str(e))
                continue
        
        logger.info("Worker shutting down")
        logger.info(f"Stats: {self.stats}")
        
        # Clean up
        self.pull_socket.close()
        self.push_socket.close()
        self.control_socket.close()
        self.context.term()


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='ZeroMQ Server Transcription Worker')
    parser.add_argument('--input', default='tcp://127.0.0.1:5555',
                       help='Input queue endpoint to bind')
    parser.add_argument('--output', default='tcp://127.0.0.1:5556',
                       help='Output queue endpoint to bind')
    parser.add_argument('--control', default='tcp://127.0.0.1:5557',
                       help='Control plane endpoint to connect')
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
    worker = ZmqServerWorker(
        input_endpoint=args.input,
        output_endpoint=args.output,
        control_endpoint=args.control,
        model_type=args.model,
        worker_id=args.worker_id
    )
    worker.run()


if __name__ == '__main__':
    main()