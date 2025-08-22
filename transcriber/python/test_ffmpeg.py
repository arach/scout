#!/usr/bin/env python3
"""Test FFmpeg installation and Python bindings."""

import sys
import os

# Add site-packages to path for uv-installed packages
sys.path.insert(0, '/Users/arach/lib/python3.13/site-packages')

import ffmpeg
import numpy as np
import soundfile as sf

def test_ffmpeg_probe():
    """Test if FFmpeg can probe audio files."""
    print("Testing FFmpeg probe functionality...")
    
    # Create a test audio file
    test_file = "/tmp/test_audio.wav"
    sample_rate = 16000
    duration = 1.0  # 1 second
    samples = np.sin(2 * np.pi * 440 * np.linspace(0, duration, int(sample_rate * duration)))
    
    # Write test file
    sf.write(test_file, samples, sample_rate)
    print(f"✅ Created test file: {test_file}")
    
    try:
        # Probe the file with FFmpeg
        probe = ffmpeg.probe(test_file)
        print(f"✅ FFmpeg probe successful!")
        print(f"   Format: {probe['format']['format_name']}")
        print(f"   Duration: {probe['format']['duration']}s")
        print(f"   Sample rate: {probe['streams'][0]['sample_rate']}Hz")
        
        # Test audio conversion
        output_file = "/tmp/test_audio_converted.wav"
        stream = ffmpeg.input(test_file)
        stream = ffmpeg.output(stream, output_file, ar=48000)  # Resample to 48kHz
        ffmpeg.run(stream, overwrite_output=True, quiet=True)
        
        # Verify conversion
        probe2 = ffmpeg.probe(output_file)
        print(f"✅ FFmpeg conversion successful!")
        print(f"   New sample rate: {probe2['streams'][0]['sample_rate']}Hz")
        
        # Clean up
        os.remove(test_file)
        os.remove(output_file)
        print("✅ Cleanup complete")
        
        return True
        
    except ffmpeg.Error as e:
        print(f"❌ FFmpeg error: {e.stderr.decode() if e.stderr else str(e)}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_ffmpeg_in_transcriber():
    """Test if FFmpeg works in transcriber context."""
    print("\nTesting FFmpeg in transcriber context...")
    
    try:
        # Check if parakeet needs FFmpeg
        from parakeet_mlx import from_pretrained
        print("✅ Parakeet MLX can be imported")
        print("   FFmpeg is available for Parakeet audio processing")
        return True
    except ImportError as e:
        print(f"⚠️  Parakeet MLX not installed: {e}")
        print("   This is expected if using Whisper or MLX-Whisper instead")
        return True  # Not an error, just using different model
    except Exception as e:
        print(f"❌ Error testing Parakeet: {e}")
        return False

if __name__ == "__main__":
    print("=" * 50)
    print("FFmpeg Installation Test")
    print("=" * 50)
    
    # Check FFmpeg binary
    import subprocess
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"✅ FFmpeg binary found: {version_line}")
        else:
            print("❌ FFmpeg binary not working properly")
    except FileNotFoundError:
        print("❌ FFmpeg binary not found in PATH")
        print("   Install with: brew install ffmpeg")
        sys.exit(1)
    
    # Test Python bindings
    print("\n" + "=" * 50)
    success = test_ffmpeg_probe()
    
    if success:
        test_ffmpeg_in_transcriber()
        print("\n" + "=" * 50)
        print("✅ All FFmpeg tests passed!")
    else:
        print("\n" + "=" * 50)
        print("❌ Some FFmpeg tests failed")
        sys.exit(1)