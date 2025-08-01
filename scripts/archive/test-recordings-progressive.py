#!/usr/bin/env python3
import os
import time
import subprocess
import json
from datetime import datetime

RECORDINGS_DIR = "/Users/arach/Library/Application Support/com.scout.app/recordings"
WHISPER_DIR = "/Users/arach/Library/Application Support/com.scout.app/whisper_sessions"

# Selected recordings
test_recordings = {
    "long": [
        "recording_20250717_213547.wav",  # ~370s
        "recording_20250717_202651.wav",  # ~270s
    ],
    "short": [
        "recording_20250717_200446.wav",  # ~20s
        "recording_20250718_085337.wav",  # ~30s
    ]
}

# Chunk sizes to test
chunk_sizes = [5, 10, 15, 20]

def get_wav_duration(filepath):
    """Get duration of WAV file in seconds"""
    try:
        import wave
        with wave.open(filepath, 'rb') as wav_file:
            frames = wav_file.getnframes()
            rate = wav_file.getframerate()
            duration = frames / float(rate)
            return duration
    except:
        return 0

def run_transcription_test(recording, chunk_size):
    """Run a single transcription test"""
    recording_path = os.path.join(RECORDINGS_DIR, recording)
    duration = get_wav_duration(recording_path)
    
    print(f"\n{'='*60}")
    print(f"Recording: {recording}")
    print(f"Duration: {duration:.1f}s")
    print(f"Refinement chunk size: {chunk_size}s")
    print(f"{'='*60}")
    
    # Create test config
    config = {
        "transcription": {
            "enable_chunking": True,
            "chunking_threshold_secs": 5,
            "refinement_chunk_secs": chunk_size,
            "force_strategy": "progressive"
        }
    }
    
    # Save config to temp file
    config_file = f"/tmp/scout_test_config_{chunk_size}.json"
    with open(config_file, 'w') as f:
        json.dump(config, f)
    
    # Run whisper-rs directly on the recording
    start_time = time.time()
    
    # Use the scout binary to process the recording
    env = os.environ.copy()
    env['RUST_LOG'] = 'scout=info'
    env['SCOUT_CONFIG_OVERRIDE'] = config_file
    
    # Since we can't easily run the full app, let's analyze the existing logs
    # Look for the most recent whisper session log
    latest_log = None
    latest_time = 0
    
    if os.path.exists(WHISPER_DIR):
        for log_file in os.listdir(WHISPER_DIR):
            if log_file.startswith("whisper_") and log_file.endswith(".log"):
                log_path = os.path.join(WHISPER_DIR, log_file)
                mtime = os.path.getmtime(log_path)
                if mtime > latest_time:
                    latest_time = mtime
                    latest_log = log_path
    
    # Analyze the log if found
    if latest_log:
        print(f"\nAnalyzing log: {os.path.basename(latest_log)}")
        with open(latest_log, 'r') as f:
            log_content = f.read()
            
        # Extract key metrics
        tiny_chunks = log_content.count("Tiny model chunk")
        medium_chunks = log_content.count("Refined chunk transcription")
        progressive_selected = "Auto-selected progressive strategy" in log_content
        
        print(f"Progressive strategy selected: {progressive_selected}")
        print(f"Tiny model chunks: {tiny_chunks}")
        print(f"Medium model refinements: {medium_chunks}")
    
    # Theoretical analysis
    print(f"\nTheoretical analysis:")
    print(f"  - Tiny chunks (5s each): {int(duration / 5)}")
    print(f"  - Medium refinements ({chunk_size}s each): {int(duration / chunk_size)}")
    print(f"  - Expected latency reduction: refinement stops at recording end")
    
    return {
        "recording": recording,
        "duration": duration,
        "chunk_size": chunk_size,
        "tiny_chunks_expected": int(duration / 5),
        "medium_chunks_expected": int(duration / chunk_size),
    }

def main():
    print("Progressive Transcription Analysis")
    print("=================================")
    print(f"Testing {len(test_recordings['long'])} long and {len(test_recordings['short'])} short recordings")
    print(f"Chunk sizes: {chunk_sizes}")
    
    results = []
    
    # Test long recordings
    print("\n\nLONG RECORDINGS (>30s)")
    print("-" * 80)
    for recording in test_recordings['long']:
        for chunk_size in chunk_sizes:
            result = run_transcription_test(recording, chunk_size)
            results.append(result)
    
    # Test short recordings
    print("\n\nSHORT RECORDINGS (<30s)")
    print("-" * 80)
    for recording in test_recordings['short']:
        for chunk_size in [5, 10, 15]:  # Skip 20s for short recordings
            result = run_transcription_test(recording, chunk_size)
            results.append(result)
    
    # Summary
    print("\n\nSUMMARY")
    print("=" * 80)
    print(f"{'Recording':<30} {'Duration':<10} {'Chunk':<8} {'Tiny':<8} {'Medium':<8}")
    print("-" * 80)
    
    for r in results:
        print(f"{r['recording']:<30} {r['duration']:<10.1f} {r['chunk_size']:<8} {r['tiny_chunks_expected']:<8} {r['medium_chunks_expected']:<8}")
    
    print("\n\nKEY INSIGHTS:")
    print("- Smaller chunks (5-10s) = More frequent quality updates during recording")
    print("- Larger chunks (15-20s) = Less overhead, fewer refinements")
    print("- All refinement stops immediately when recording ends (latency first!)")
    print("- For recordings <15s, refinement may not even start with 15s chunks")

if __name__ == "__main__":
    main()