#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Test transcription using a WAV file or recorded audio."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging
import wave
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_wav_file(file_path):
    """Load audio from a WAV or AIFF file."""
    try:
        # Try to load as AIFF first if extension suggests it
        if file_path.endswith('.aiff') or file_path.endswith('.aif'):
            import aifc
            with aifc.open(file_path, 'rb') as aiff_file:
                sample_rate = aiff_file.getframerate()
                num_frames = aiff_file.getnframes()
                channels = aiff_file.getnchannels()
                sample_width = aiff_file.getsampwidth()
                audio_data = aiff_file.readframes(num_frames)
                
                # Convert to numpy array
                if sample_width == 2:
                    audio = np.frombuffer(audio_data, dtype=np.int16)
                else:
                    logger.error(f"Unsupported sample width: {sample_width}")
                    return None, None
                
                # Convert to mono if stereo
                if channels == 2:
                    audio = audio.reshape(-1, 2).mean(axis=1)
                
                # Convert to float32 normalized
                audio = audio.astype(np.float32) / 32768.0
                
                # Resample to 16kHz if necessary
                if sample_rate != 16000:
                    logger.info(f"Resampling from {sample_rate}Hz to 16000Hz")
                    ratio = 16000 / sample_rate
                    new_length = int(len(audio) * ratio)
                    indices = np.arange(new_length) / ratio
                    audio = np.interp(indices, np.arange(len(audio)), audio)
                    sample_rate = 16000
                
                logger.info(f"Loaded {len(audio)} samples at {sample_rate}Hz from {file_path}")
                return audio.astype(np.float32), sample_rate
        else:
            # Load as WAV
            with wave.open(file_path, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
                num_frames = wav_file.getnframes()
                channels = wav_file.getnchannels()
                sample_width = wav_file.getsampwidth()
                audio_data = wav_file.readframes(num_frames)
                
                # Convert to numpy array
                if sample_width == 2:
                    audio = np.frombuffer(audio_data, dtype=np.int16)
                elif sample_width == 1:
                    audio = np.frombuffer(audio_data, dtype=np.uint8)
                    audio = audio.astype(np.int16) - 128
                else:
                    logger.error(f"Unsupported sample width: {sample_width}")
                    return None, None
                
                # Convert to mono if stereo
                if channels == 2:
                    audio = audio.reshape(-1, 2).mean(axis=1)
                
                # Convert to float32 normalized
                audio = audio.astype(np.float32) / 32768.0
                
                # Resample to 16kHz if necessary
                if sample_rate != 16000:
                    logger.info(f"Resampling from {sample_rate}Hz to 16000Hz")
                    ratio = 16000 / sample_rate
                    new_length = int(len(audio) * ratio)
                    indices = np.arange(new_length) / ratio
                    audio = np.interp(indices, np.arange(len(audio)), audio)
                    sample_rate = 16000
                
                logger.info(f"Loaded {len(audio)} samples at {sample_rate}Hz from {file_path}")
                return audio.astype(np.float32), sample_rate
            
    except FileNotFoundError:
        logger.error(f"File not found: {file_path}")
        return None, None
    except Exception as e:
        logger.error(f"Error loading WAV file: {e}")
        return None, None

def record_audio_with_sox(duration=3, output_file="test_audio.wav"):
    """Record audio using sox (if available)."""
    import subprocess
    try:
        logger.info(f"Recording {duration} seconds of audio...")
        result = subprocess.run(
            ['sox', '-d', output_file, 'trim', '0', str(duration)],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            logger.info(f"Recorded audio to {output_file}")
            return output_file
        else:
            logger.error(f"Recording failed: {result.stderr}")
            return None
    except FileNotFoundError:
        logger.warning("sox not found. Install with: brew install sox")
        return None

def test_transcription(audio, sample_rate, description):
    """Send audio for transcription and display results."""
    if audio is None:
        logger.error("No audio to transcribe")
        return False, None
    
    context = zmq.Context()
    
    # Connect to the ports where Python worker is binding
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 15000)  # 15 second timeout
    
    logger.info(f"\n{'='*60}")
    logger.info(f"Testing: {description}")
    logger.info(f"Audio: {len(audio)} samples ({len(audio)/sample_rate:.1f} seconds)")
    
    chunk_id = uuid.uuid4()
    audio_chunk = {
        "id": chunk_id.bytes,
        "audio": audio.tolist(),
        "sample_rate": int(sample_rate),
        "timestamp": time.time(),
    }
    
    queue_item = {
        "data": audio_chunk,
        "priority": 0,
        "timestamp": time.time(),
    }
    
    # Send message
    start_time = time.time()
    message = msgpack.packb(queue_item, use_bin_type=True)
    push_socket.send(message)
    logger.info(f"Sent audio chunk {chunk_id}")
    
    # Wait for result
    logger.info("Waiting for transcription...")
    try:
        result_msg = pull_socket.recv()
        elapsed = time.time() - start_time
        result = msgpack.unpackb(result_msg, raw=False)
        
        if "Ok" in result:
            transcript = result["Ok"]
            logger.info(f"✅ SUCCESS")
            logger.info(f"   Transcribed text: '{transcript['text']}'")
            logger.info(f"   Confidence: {transcript['confidence']}")
            logger.info(f"   Processing: {transcript['metadata']['processing_time_ms']}ms")
            logger.info(f"   Total time: {elapsed*1000:.0f}ms")
            return True, transcript['text']
        else:
            logger.error(f"❌ ERROR: {result['Err']}")
            return False, None
            
    except zmq.Again:
        logger.error("❌ TIMEOUT waiting for result")
        return False, None
    finally:
        push_socket.close()
        pull_socket.close()
        context.term()

def main():
    """Run tests with WAV files or recorded audio."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Test transcription with audio files')
    parser.add_argument('--file', '-f', help='WAV file to transcribe')
    parser.add_argument('--record', '-r', type=int, help='Record N seconds of audio')
    parser.add_argument('--all', '-a', action='store_true', help='Try all test methods')
    
    args = parser.parse_args()
    
    if args.file:
        # Test with provided file
        audio, sample_rate = load_wav_file(args.file)
        if audio is not None:
            test_transcription(audio, sample_rate, f"File: {args.file}")
    
    elif args.record:
        # Record and test
        recorded_file = record_audio_with_sox(args.record)
        if recorded_file:
            audio, sample_rate = load_wav_file(recorded_file)
            if audio is not None:
                test_transcription(audio, sample_rate, f"Recorded: {args.record}s")
                os.unlink(recorded_file)  # Clean up
    
    elif args.all:
        # Try multiple test methods
        logger.info("Testing with various audio sources...")
        
        # 1. Try to find sample WAV files
        sample_files = [
            "/System/Library/Sounds/Glass.aiff",  # macOS system sound
            "/System/Library/Sounds/Hero.aiff",
            "test.wav",
            "sample.wav",
        ]
        
        for file_path in sample_files:
            if Path(file_path).exists():
                logger.info(f"\nTesting with system sound: {file_path}")
                audio, sample_rate = load_wav_file(file_path)
                if audio is not None:
                    test_transcription(audio, sample_rate, f"System sound: {Path(file_path).name}")
                    break
        
        # 2. Try recording
        recorded = record_audio_with_sox(3)
        if recorded:
            audio, sample_rate = load_wav_file(recorded)
            if audio is not None:
                test_transcription(audio, sample_rate, "Recorded audio")
                os.unlink(recorded)
    
    else:
        logger.info("Usage:")
        logger.info("  Test with file:     python test_with_wav_file.py --file audio.wav")
        logger.info("  Record and test:    python test_with_wav_file.py --record 3")
        logger.info("  Try all methods:    python test_with_wav_file.py --all")
        logger.info("\nYou can also create a test audio file with:")
        logger.info("  say 'Hello, this is a test' -o test.wav  # macOS")
        logger.info("  sox -n test.wav synth 3 sine 440         # Generate tone")

if __name__ == "__main__":
    main()