#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
#   "scipy",
# ]
# ///
"""Test with more realistic audio that should produce meaningful transcriptions."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
from scipy import signal
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_realistic_speech(text="Hello world, this is a test", duration=3, sample_rate=16000):
    """Generate more realistic speech-like audio with formants."""
    samples = int(duration * sample_rate)
    t = np.linspace(0, duration, samples)
    
    # Create a more complex audio signal that mimics speech patterns
    audio = np.zeros(samples)
    
    # Simulate syllables with amplitude modulation
    syllable_rate = len(text.split()) / duration  # Words per second
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * syllable_rate * 2 * t)
    
    # Add multiple formants (characteristic frequencies of speech)
    # F1: 700 Hz (first formant)
    # F2: 1220 Hz (second formant) 
    # F3: 2600 Hz (third formant)
    formants = [700, 1220, 2600]
    formant_amplitudes = [1.0, 0.6, 0.3]
    
    for freq, amp in zip(formants, formant_amplitudes):
        # Add some frequency variation to simulate speech
        freq_mod = freq + 50 * np.sin(2 * np.pi * 0.5 * t)
        audio += amp * np.sin(2 * np.pi * freq_mod * t / sample_rate)
    
    # Apply envelope
    audio = audio * envelope
    
    # Add voiced/unvoiced segments
    # Create random voiced/unvoiced pattern
    segment_length = int(0.05 * sample_rate)  # 50ms segments
    num_segments = samples // segment_length
    
    for i in range(num_segments):
        start = i * segment_length
        end = min((i + 1) * segment_length, samples)
        
        if np.random.random() > 0.7:  # 30% chance of unvoiced
            # Unvoiced segment (like 's', 'f', 'sh')
            audio[start:end] = np.random.randn(end - start) * 0.1
    
    # Add some natural variation
    audio += np.random.randn(samples) * 0.02
    
    # Apply a bandpass filter to keep speech frequencies
    nyquist = sample_rate / 2
    low = 80 / nyquist
    high = 8000 / nyquist
    
    if high < 1.0:  # Only filter if we're not exceeding Nyquist
        b, a = signal.butter(4, [low, high], btype='band')
        audio = signal.filtfilt(b, a, audio)
    
    # Normalize
    audio = audio / (np.max(np.abs(audio)) + 1e-10) * 0.5
    
    return audio.astype(np.float32)

def generate_counting_audio(duration=3, sample_rate=16000):
    """Generate audio that sounds like counting numbers."""
    samples = int(duration * sample_rate)
    t = np.linspace(0, duration, samples)
    audio = np.zeros(samples)
    
    # Simulate counting "one, two, three, four..."
    # Each number takes about 0.5 seconds
    words_per_second = 2
    word_duration = 0.3  # seconds per word
    pause_duration = 0.2  # pause between words
    
    current_time = 0
    word_count = 0
    
    while current_time < duration:
        # Word segment
        word_start = int(current_time * sample_rate)
        word_end = min(int((current_time + word_duration) * sample_rate), samples)
        
        if word_end > word_start:
            # Create different pitch patterns for different "numbers"
            base_freq = 100 + (word_count % 4) * 50  # Vary pitch
            
            # Generate word sound
            word_t = t[word_start:word_end]
            local_t = np.linspace(0, word_duration, word_end - word_start)
            
            # Consonant-vowel-consonant pattern
            # Start with consonant burst
            consonant_len = int(0.05 * sample_rate)
            if consonant_len < len(local_t):
                audio[word_start:word_start + consonant_len] = np.random.randn(consonant_len) * 0.2
            
            # Vowel sound with formants
            for formant, amp in [(base_freq * 2, 1.0), (base_freq * 3.5, 0.5), (base_freq * 5, 0.3)]:
                audio[word_start:word_end] += amp * np.sin(2 * np.pi * formant * local_t)
            
            # Apply envelope
            envelope = np.sin(np.pi * local_t / word_duration)
            audio[word_start:word_end] *= envelope
        
        current_time += word_duration + pause_duration
        word_count += 1
    
    # Add some background characteristics
    audio += np.random.randn(samples) * 0.01
    
    # Normalize
    audio = audio / (np.max(np.abs(audio)) + 1e-10) * 0.5
    
    return audio.astype(np.float32)

def test_transcription(audio, description, sample_rate=16000):
    """Send audio for transcription and display results."""
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
        "sample_rate": sample_rate,
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
    """Run tests with different audio patterns."""
    logger.info("Testing with more realistic audio patterns...")
    
    # Test 1: Speech-like with formants
    audio1 = generate_realistic_speech("Testing the transcription system", duration=3)
    success1, text1 = test_transcription(audio1, "Realistic speech pattern with formants")
    time.sleep(1)
    
    # Test 2: Counting pattern
    audio2 = generate_counting_audio(duration=3)
    success2, text2 = test_transcription(audio2, "Counting pattern audio")
    time.sleep(1)
    
    # Test 3: Short burst
    audio3 = generate_realistic_speech("Quick test", duration=1)
    success3, text3 = test_transcription(audio3, "Short speech burst")
    time.sleep(1)
    
    # Test 4: Actual white noise (to contrast)
    audio4 = np.random.randn(16000).astype(np.float32) * 0.1
    success4, text4 = test_transcription(audio4, "Pure white noise (for comparison)")
    
    # Summary
    logger.info(f"\n{'='*60}")
    logger.info("SUMMARY")
    logger.info(f"{'='*60}")
    
    tests = [
        ("Realistic speech", success1, text1),
        ("Counting pattern", success2, text2),
        ("Short burst", success3, text3),
        ("White noise", success4, text4),
    ]
    
    for name, success, text in tests:
        status = "✅" if success else "❌"
        logger.info(f"{status} {name}: {text if text else 'Failed'}")
    
    logger.info("\nNote: Whisper is trained on real speech, so synthetic audio")
    logger.info("often produces nonsensical transcriptions like 'Mm-mm' or random words.")
    logger.info("For real testing, use actual recorded speech or TTS-generated audio.")

if __name__ == "__main__":
    main()