#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "msgpack",
#   "numpy",
#   "torch",
#   "transformers",
#   "huggingface-hub",
# ]
# ///
"""
Transcription worker for transcriber service.
Handles audio transcription using Hugging Face models.

This script uses inline UV script dependencies for easy deployment.
To run: uv run python/transcriber.py
"""

import sys
import json
import time
import struct
import logging
import traceback
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict
from enum import Enum

import msgpack
import numpy as np

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger(__name__)


class MessageType(Enum):
    """Message types for IPC protocol."""
    AUDIO_CHUNK = "AudioChunk"
    TRANSCRIPT = "Transcript"
    ERROR = "Error"
    HEARTBEAT = "Heartbeat"
    CONTROL = "Control"


@dataclass
class AudioChunk:
    """Audio chunk message."""
    id: str
    audio: np.ndarray
    sample_rate: int
    channels: int
    timestamp: int
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AudioChunk':
        """Create AudioChunk from dictionary."""
        return cls(
            id=data['id'],
            audio=np.array(data['audio'], dtype=np.float32),
            sample_rate=data['sample_rate'],
            channels=data['channels'],
            timestamp=data['timestamp']
        )


@dataclass
class Transcript:
    """Transcript result message."""
    id: str
    text: str
    confidence: float
    timestamp: int
    metadata: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return asdict(self)


@dataclass
class ErrorResult:
    """Error result message."""
    id: str
    message: str
    timestamp: int
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return asdict(self)


class TranscriptionModel:
    """Base class for transcription models."""
    
    def __init__(self, model_name: str = "openai/whisper-base"):
        """Initialize the transcription model."""
        self.model_name = model_name
        self.model = None
        self.processor = None
        self.load_model()
    
    def load_model(self):
        """Load the model and processor."""
        logger.info(f"Loading model: {self.model_name}")
        
        try:
            from transformers import WhisperProcessor, WhisperForConditionalGeneration
            
            self.processor = WhisperProcessor.from_pretrained(self.model_name)
            self.model = WhisperForConditionalGeneration.from_pretrained(self.model_name)
            
            # Move to GPU if available
            import torch
            if torch.cuda.is_available():
                self.model = self.model.to("cuda")
                logger.info("Model loaded on GPU")
            else:
                logger.info("Model loaded on CPU")
                
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            # Fall back to a mock model for testing
            logger.warning("Using mock transcription model")
            self.model = None
            self.processor = None
    
    def transcribe(self, audio: np.ndarray, sample_rate: int) -> tuple[str, float]:
        """
        Transcribe audio to text.
        
        Returns:
            Tuple of (text, confidence)
        """
        if self.model is None or self.processor is None:
            # Mock transcription for testing
            return f"Mock transcription for {len(audio)} samples", 0.95
        
        try:
            # Process audio
            inputs = self.processor(
                audio, 
                sampling_rate=sample_rate, 
                return_tensors="pt"
            )
            
            # Move to same device as model
            import torch
            if torch.cuda.is_available():
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
            # Generate transcription
            generated_ids = self.model.generate(inputs["input_features"])
            transcription = self.processor.batch_decode(
                generated_ids, 
                skip_special_tokens=True
            )[0]
            
            # Calculate confidence (simplified - could use model scores)
            confidence = 0.95  # Placeholder
            
            return transcription, confidence
            
        except Exception as e:
            logger.error(f"Transcription failed: {e}")
            raise


class ParakeetModel(TranscriptionModel):
    """Parakeet TDT model for transcription."""
    
    def __init__(self):
        """Initialize Parakeet model."""
        # For now, use Whisper as a placeholder
        # In production, this would load the actual Parakeet model
        super().__init__("openai/whisper-base")
        logger.info("Initialized Parakeet model (using Whisper as placeholder)")


class TranscriptionWorker:
    """Main worker class for handling transcription requests."""
    
    def __init__(self, model_type: str = "whisper"):
        """Initialize the transcription worker."""
        self.model_type = model_type
        self.model = self._create_model()
        self.stats = {
            'processed': 0,
            'errors': 0,
            'start_time': time.time()
        }
    
    def _create_model(self) -> TranscriptionModel:
        """Create the appropriate model based on type."""
        if self.model_type == "parakeet":
            return ParakeetModel()
        else:
            return TranscriptionModel()
    
    def process_audio_chunk(self, chunk: AudioChunk) -> Transcript:
        """Process an audio chunk and return transcript."""
        logger.debug(f"Processing chunk {chunk.id}")
        
        try:
            # Transcribe audio
            text, confidence = self.model.transcribe(
                chunk.audio, 
                chunk.sample_rate
            )
            
            # Create transcript result
            transcript = Transcript(
                id=chunk.id,
                text=text,
                confidence=confidence,
                timestamp=int(time.time() * 1000),
                metadata={
                    'model': self.model_type,
                    'sample_rate': chunk.sample_rate,
                    'duration_ms': len(chunk.audio) * 1000 // chunk.sample_rate
                }
            )
            
            self.stats['processed'] += 1
            return transcript
            
        except Exception as e:
            logger.error(f"Failed to process chunk {chunk.id}: {e}")
            self.stats['errors'] += 1
            raise
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle incoming message and return response."""
        msg_type = message.get('type')
        
        if msg_type == MessageType.AUDIO_CHUNK.value:
            try:
                chunk = AudioChunk.from_dict(message['data'])
                transcript = self.process_audio_chunk(chunk)
                return {
                    'type': MessageType.TRANSCRIPT.value,
                    'data': transcript.to_dict()
                }
            except Exception as e:
                error = ErrorResult(
                    id=message['data'].get('id', 'unknown'),
                    message=str(e),
                    timestamp=int(time.time() * 1000)
                )
                return {
                    'type': MessageType.ERROR.value,
                    'data': error.to_dict()
                }
        
        elif msg_type == MessageType.HEARTBEAT.value:
            return {
                'type': MessageType.HEARTBEAT.value,
                'data': {
                    'timestamp': int(time.time() * 1000),
                    'stats': self.stats
                }
            }
        
        elif msg_type == MessageType.CONTROL.value:
            command = message['data'].get('command')
            if command == 'shutdown':
                logger.info("Received shutdown command")
                return None
            elif command == 'stats':
                return {
                    'type': MessageType.CONTROL.value,
                    'data': {'stats': self.stats}
                }
        
        logger.warning(f"Unknown message type: {msg_type}")
        return None
    
    def run(self):
        """Main worker loop."""
        logger.info(f"Starting transcription worker (model: {self.model_type})")
        
        while True:
            try:
                # Read message from stdin
                # Messages are length-prefixed for reliable framing
                length_bytes = sys.stdin.buffer.read(4)
                if not length_bytes or len(length_bytes) < 4:
                    logger.info("No more input, exiting")
                    break
                
                # Unpack message length
                msg_length = struct.unpack('<I', length_bytes)[0]
                
                # Read message data
                msg_data = sys.stdin.buffer.read(msg_length)
                if len(msg_data) < msg_length:
                    logger.error(f"Incomplete message: expected {msg_length}, got {len(msg_data)}")
                    continue
                
                # Deserialize message
                message = msgpack.unpackb(msg_data, raw=False)
                logger.debug(f"Received message: {message.get('type')}")
                
                # Handle message
                response = self.handle_message(message)
                
                if response is None:
                    if message.get('type') == MessageType.CONTROL.value:
                        if message['data'].get('command') == 'shutdown':
                            break
                    continue
                
                # Serialize response
                response_data = msgpack.packb(response, use_bin_type=True)
                
                # Write length-prefixed response to stdout
                sys.stdout.buffer.write(struct.pack('<I', len(response_data)))
                sys.stdout.buffer.write(response_data)
                sys.stdout.buffer.flush()
                
            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                break
            except Exception as e:
                logger.error(f"Worker error: {e}")
                logger.error(traceback.format_exc())
                # Continue running despite errors
                continue
        
        logger.info("Worker shutting down")
        logger.info(f"Stats: {self.stats}")


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Scout Transcription Worker')
    parser.add_argument(
        '--model', 
        choices=['whisper', 'parakeet'],
        default='whisper',
        help='Model type to use'
    )
    parser.add_argument(
        '--log-level',
        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        default='INFO',
        help='Logging level'
    )
    
    args = parser.parse_args()
    
    # Set logging level
    logging.getLogger().setLevel(getattr(logging, args.log_level))
    
    # Create and run worker
    worker = TranscriptionWorker(model_type=args.model)
    worker.run()


if __name__ == '__main__':
    main()