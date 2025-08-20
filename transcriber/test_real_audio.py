#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
#   "sounddevice",
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
import argparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_real_audio_file(file_path="test_audio.wav"):
    """Load audio from a real WAV file."""
    import wave
    import os
    
    if not os.path.exists(file_path):
        # If test_audio.wav doesn't exist, try to create it with macOS 'say' command
        logger.info(f"Creating {file_path} using macOS 'say' command...")
        os.system(f'say "Hello, this is a test of the transcription system" -o {file_path}')
    
    try:
        with wave.open(file_path, 'rb') as wav_file:
            sample_rate = wav_file.getframerate()
            num_frames = wav_file.getnframes()
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            audio_data = wav_file.readframes(num_frames)
            
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
            
    except Exception as e:
        logger.error(f"Error loading WAV file: {e}")
        return None, None

def generate_speech_like_audio(text_hint="Hello, this is a test", duration=3, sample_rate=16000):
    """Generate audio - prefer real audio file if available."""
    # Try to load real audio first
    audio, loaded_sample_rate = load_real_audio_file()
    if audio is not None:
        return audio
    
    # Fall back to synthetic generation
    logger.info("Generating synthetic audio (won't transcribe well)")
    samples = int(duration * sample_rate)
    t = np.linspace(0, duration, samples)
    
    # Create a more speech-like waveform with varying frequency
    # Speech typically has fundamental frequency 85-255 Hz
    fundamental = 120 + 50 * np.sin(2 * np.pi * 0.5 * t)  # Varying pitch
    
    # Add harmonics - fix the frequency calculation!
    # We need to integrate the frequency to get phase
    phase = 2 * np.pi * np.cumsum(fundamental) / sample_rate
    audio = np.sin(phase)
    audio += 0.5 * np.sin(2 * phase)  # Second harmonic
    audio += 0.3 * np.sin(3 * phase)  # Third harmonic
    
    # Add envelope to simulate words/syllables
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
    audio = audio * envelope
    
    # Add some noise
    audio += 0.05 * np.random.randn(samples)
    
    # Normalize
    audio = audio / np.max(np.abs(audio)) * 0.3
    
    return audio.astype(np.float32)

def play_audio(audio, sample_rate=16000):
    """Play audio through speakers."""
    try:
        import sounddevice as sd
        logger.info("Playing audio...")
        sd.play(audio, sample_rate)
        sd.wait()  # Wait until audio finishes playing
        logger.info("Audio playback complete")
    except Exception as e:
        logger.warning(f"Could not play audio: {e}")
        logger.info("Install sounddevice to enable playback: pip install sounddevice")

def main():
    """Send test audio to ZeroMQ queue."""
    parser = argparse.ArgumentParser(description='Test transcription with simulated audio')
    parser.add_argument('--play', '-p', action='store_true', help='Play the audio before sending')
    parser.add_argument('--duration', '-d', type=float, default=3, help='Audio duration in seconds')
    parser.add_argument('--text', '-t', default="Testing the transcription system", help='Text hint for generation')
    parser.add_argument('--use-synthetic', '-s', action='store_true', help='Force use of synthetic audio instead of real file')
    parser.add_argument('--file', '-f', default="test_audio.wav", help='WAV file to use (default: test_audio.wav)')
    args = parser.parse_args()
    
    context = zmq.Context()
    
    # Connect to the ports where Python worker is binding
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 10000)  # 10 second timeout
    
    logger.info("Connected to ZeroMQ endpoints")
    
    # Create more realistic audio
    SAMPLE_RATE = 16000  # Make it explicit
    if args.use_synthetic:
        # Force synthetic audio
        logger.info("Using synthetic audio (as requested)")
        import sounddevice  # Import here to ensure we have it for synthetic generation
        samples = int(args.duration * SAMPLE_RATE)
        t = np.linspace(0, args.duration, samples)
        fundamental = 120 + 50 * np.sin(2 * np.pi * 0.5 * t)
        phase = 2 * np.pi * np.cumsum(fundamental) / SAMPLE_RATE
        audio = np.sin(phase)
        audio += 0.5 * np.sin(2 * phase)
        audio += 0.3 * np.sin(3 * phase)
        envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
        audio = audio * envelope
        audio += 0.05 * np.random.randn(samples)
        audio = audio / np.max(np.abs(audio)) * 0.3
        audio = audio.astype(np.float32)
    else:
        # Try to load real audio first
        audio, loaded_sample_rate = load_real_audio_file(args.file)
        if audio is None:
            # Fall back to synthetic
            audio = generate_speech_like_audio(args.text, duration=args.duration, sample_rate=SAMPLE_RATE)
    
    logger.info(f"Audio samples: {len(audio)}")
    logger.info(f"Sample rate: {SAMPLE_RATE} Hz")
    logger.info(f"Actual duration: {len(audio)/SAMPLE_RATE:.2f} seconds")
    if args.use_synthetic:
        logger.info("Note: This is synthetic audio, so transcription may vary from the hint text")
    
    # Play audio if requested
    if args.play:
        play_audio(audio, sample_rate=SAMPLE_RATE)
    
    chunk_id = uuid.uuid4()
    audio_chunk = {
        "id": chunk_id.bytes,
        "audio": audio.tolist(),
        "sample_rate": SAMPLE_RATE,  # Use the same constant
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
    logger.info(f"Sent audio chunk {chunk_id}")
    
    # Wait for result
    logger.info("Waiting for transcription result...")
    try:
        result_msg = pull_socket.recv()
        result = msgpack.unpackb(result_msg, raw=False)
        
        if "Ok" in result:
            transcript = result["Ok"]
            transcribed_text = transcript['text'].strip().lower()
            
            # Determine expected text
            expected_text = None
            if args.use_synthetic:
                # For synthetic audio, we don't have a reliable expected text
                expected_text = None
            elif args.file == "test_audio.wav" and "test_audio.wav" in args.file:
                expected_text = "hello this is a test of the transcription system"
            
            # Check for success
            success = False
            if expected_text:
                # Normalize both texts for comparison
                expected_normalized = expected_text.lower().replace(',', '').replace('.', '').strip()
                transcribed_normalized = transcribed_text.replace(',', '').replace('.', '').strip()
                
                # Check for exact match or close match
                if expected_normalized == transcribed_normalized:
                    success = True
                elif len(transcribed_normalized) > 0:
                    # Calculate word overlap
                    expected_words = set(expected_normalized.split())
                    transcribed_words = set(transcribed_normalized.split())
                    overlap = expected_words.intersection(transcribed_words)
                    if len(overlap) >= len(expected_words) * 0.7:  # 70% word match
                        success = True
            elif args.use_synthetic:
                # For synthetic audio, just check if we got something
                success = len(transcribed_text) > 0
            else:
                # For unknown files, success if we got non-empty transcription
                success = len(transcribed_text) > 0
            
            logger.info("\n" + "="*60)
            logger.info("TRANSCRIPTION RESULT")
            logger.info("="*60)
            if expected_text:
                logger.info(f"Expected:        '{expected_text}'")
            elif args.use_synthetic:
                logger.info(f"Expected (hint): '{args.text}'")
            else:
                logger.info(f"Audio file:      '{args.file}'")
            logger.info(f"Transcribed:     '{transcript['text']}'")
            logger.info("="*60)
            logger.info(f"Confidence: {transcript['confidence']}")
            logger.info(f"Processing time: {transcript['metadata']['processing_time_ms']}ms")
            logger.info(f"Worker: {transcript['metadata']['worker_id']}")
            logger.info(f"Model: {transcript['metadata'].get('model', 'Unknown')}")
            logger.info("="*60)
            
            if success:
                logger.info("✅ TEST PASSED - Transcription successful")
                if expected_text and expected_normalized != transcribed_normalized:
                    logger.info("   (Close match detected)")
            else:
                logger.error("❌ TEST FAILED - Transcription did not match expected")
                if expected_text:
                    logger.error(f"   Expected: {expected_normalized}")
                    logger.error(f"   Got:      {transcribed_normalized}")
            
            return 0 if success else 1
        else:
            logger.error(f"❌ TEST FAILED - Error: {result['Err']}")
            return 1
            
    except zmq.Again:
        logger.error("❌ TEST FAILED - Timeout waiting for result")
        return 1
    finally:
        # Clean up
        push_socket.close()
        pull_socket.close()
        context.term()
    
    return 1  # Default to failure if we get here

if __name__ == "__main__":
    import sys
    sys.exit(main())