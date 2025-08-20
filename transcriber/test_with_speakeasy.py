#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Test transcription using speakeasy TTS for real speech audio."""

import subprocess
import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging
import tempfile
import os
import wave

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_speech_with_speakeasy(text):
    """Use speakeasy to generate TTS audio."""
    try:
        # Create a temporary file for the audio
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        
        # Call speakeasy to generate speech with OpenAI voice
        logger.info(f"Generating speech with speakeasy (OpenAI): '{text}'")
        result = subprocess.run(
            ['speakeasy', text, '--provider', 'openai', '--out', tmp_path],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            logger.error(f"Speakeasy failed: {result.stderr}")
            # Try without provider specification
            result = subprocess.run(
                ['speakeasy', text, '--out', tmp_path],
                capture_output=True,
                text=True
            )
        
        if result.returncode != 0:
            logger.error(f"Speakeasy error: {result.stderr}")
            return None, None
        
        # Read the WAV file
        with wave.open(tmp_path, 'rb') as wav_file:
            sample_rate = wav_file.getframerate()
            num_frames = wav_file.getnframes()
            audio_data = wav_file.readframes(num_frames)
            
            # Convert to numpy array
            audio = np.frombuffer(audio_data, dtype=np.int16)
            # Convert to float32 normalized
            audio = audio.astype(np.float32) / 32768.0
            
            # Resample to 16kHz if necessary
            if sample_rate != 16000:
                # Simple decimation/interpolation
                ratio = 16000 / sample_rate
                new_length = int(len(audio) * ratio)
                indices = np.arange(new_length) / ratio
                audio = np.interp(indices, np.arange(len(audio)), audio)
                sample_rate = 16000
        
        # Clean up
        os.unlink(tmp_path)
        
        logger.info(f"Generated {len(audio)} samples at {sample_rate}Hz")
        return audio.astype(np.float32), sample_rate
        
    except FileNotFoundError:
        logger.error("speakeasy not found. Please ensure it's installed and in PATH")
        return None, None
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        return None, None

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
            logger.info(f"   Text: '{transcript['text']}'")
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
    """Run tests with real TTS speech."""
    logger.info("Testing with real TTS-generated speech from speakeasy...")
    
    test_phrases = [
        "Hello, this is a test of the transcription system.",
        "The quick brown fox jumps over the lazy dog.",
        "Testing one, two, three, four, five.",
        "Can you understand what I am saying?",
        "This is Scout transcriber with ZeroMQ integration.",
    ]
    
    results = []
    
    for i, phrase in enumerate(test_phrases, 1):
        logger.info(f"\nTest {i}/{len(test_phrases)}")
        logger.info(f"Original text: '{phrase}'")
        
        # Generate speech with speakeasy
        audio, sample_rate = generate_speech_with_speakeasy(phrase)
        
        if audio is not None:
            # Test transcription
            success, transcribed = test_transcription(
                audio, sample_rate, 
                f"Test {i}: '{phrase[:30]}...'" if len(phrase) > 30 else f"Test {i}: '{phrase}'"
            )
            
            results.append({
                'original': phrase,
                'transcribed': transcribed,
                'success': success
            })
            
            time.sleep(1)  # Small delay between tests
        else:
            logger.warning(f"Skipping test {i} - could not generate audio")
            results.append({
                'original': phrase,
                'transcribed': None,
                'success': False
            })
    
    # Summary
    logger.info(f"\n{'='*60}")
    logger.info("SUMMARY - Comparing Original vs Transcribed")
    logger.info(f"{'='*60}")
    
    for i, result in enumerate(results, 1):
        status = "✅" if result['success'] else "❌"
        logger.info(f"\n{status} Test {i}:")
        logger.info(f"   Original:    '{result['original']}'")
        if result['transcribed']:
            logger.info(f"   Transcribed: '{result['transcribed']}'")
            
            # Simple similarity check
            orig_words = set(result['original'].lower().split())
            trans_words = set(result['transcribed'].lower().split())
            common = orig_words & trans_words
            if len(orig_words) > 0:
                accuracy = len(common) / len(orig_words) * 100
                logger.info(f"   Word match:  {accuracy:.0f}% ({len(common)}/{len(orig_words)} words)")
        else:
            logger.info(f"   Transcribed: FAILED")
    
    successful = sum(1 for r in results if r['success'])
    logger.info(f"\n{'='*60}")
    logger.info(f"Results: {successful}/{len(results)} tests completed successfully")
    
    if successful == len(results):
        logger.info("🎉 All tests passed!")
    elif successful > 0:
        logger.info("⚠️  Some tests failed")
    else:
        logger.info("❌ All tests failed - check if speakeasy is installed")

if __name__ == "__main__":
    main()