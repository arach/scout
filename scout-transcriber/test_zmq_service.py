#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
#   "colorama",
# ]
# ///
"""Comprehensive test suite for ZeroMQ transcription service."""

import sys
import time
import uuid
import zmq
import msgpack
import numpy as np
import logging
from colorama import init, Fore, Style
from typing import Optional, Tuple

init(autoreset=True)  # Initialize colorama

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

class TranscriptionTester:
    """Test client for the ZeroMQ transcription service."""
    
    def __init__(self):
        self.context = zmq.Context()
        self.push_socket = self.context.socket(zmq.PUSH)
        self.push_socket.connect("tcp://127.0.0.1:5555")
        
        self.pull_socket = self.context.socket(zmq.PULL)
        self.pull_socket.connect("tcp://127.0.0.1:5556")
        self.pull_socket.setsockopt(zmq.RCVTIMEO, 10000)  # 10 second timeout
        
        logger.info(f"{Fore.CYAN}Connected to ZeroMQ endpoints{Style.RESET_ALL}")
        self.test_results = []
    
    def generate_audio(self, duration: float = 2.0, pattern: str = "speech") -> np.ndarray:
        """Generate different types of test audio."""
        sample_rate = 16000
        samples = int(duration * sample_rate)
        t = np.linspace(0, duration, samples)
        
        if pattern == "speech":
            # Speech-like pattern with varying frequency
            fundamental = 120 + 50 * np.sin(2 * np.pi * 0.5 * t)
            audio = np.sin(2 * np.pi * fundamental * t)
            audio += 0.5 * np.sin(2 * np.pi * 2 * fundamental * t)
            envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)
            audio = audio * envelope
            
        elif pattern == "tone":
            # Simple tone
            audio = np.sin(2 * np.pi * 440 * t)  # A4 note
            
        elif pattern == "silence":
            # Silence with tiny noise
            audio = np.random.randn(samples) * 0.001
            
        elif pattern == "noise":
            # White noise
            audio = np.random.randn(samples) * 0.3
            
        else:
            raise ValueError(f"Unknown pattern: {pattern}")
        
        # Add some noise and normalize
        if pattern != "silence":
            audio += 0.05 * np.random.randn(samples)
        audio = audio / np.max(np.abs(audio) + 1e-10) * 0.3
        
        return audio.astype(np.float32)
    
    def send_and_receive(self, audio: np.ndarray, test_name: str) -> Tuple[bool, Optional[str], float]:
        """Send audio and receive transcription result."""
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
        start_time = time.time()
        message = msgpack.packb(queue_item, use_bin_type=True)
        self.push_socket.send(message)
        
        logger.info(f"{Fore.YELLOW}[{test_name}] Sent audio ({len(audio)} samples){Style.RESET_ALL}")
        
        # Wait for result
        try:
            result_msg = self.pull_socket.recv()
            elapsed = time.time() - start_time
            result = msgpack.unpackb(result_msg, raw=False)
            
            if "Ok" in result:
                transcript = result["Ok"]
                text = transcript['text']
                processing_time = transcript['metadata']['processing_time_ms']
                
                logger.info(f"{Fore.GREEN}✅ [{test_name}] Success{Style.RESET_ALL}")
                logger.info(f"   Text: '{text[:50]}...' (truncated)" if len(text) > 50 else f"   Text: '{text}'")
                logger.info(f"   Processing: {processing_time}ms, Round-trip: {elapsed*1000:.0f}ms")
                return True, text, elapsed
                
            else:
                error = result['Err']
                logger.error(f"{Fore.RED}❌ [{test_name}] Error: {error['message']}{Style.RESET_ALL}")
                return False, None, elapsed
                
        except zmq.Again:
            logger.error(f"{Fore.RED}❌ [{test_name}] Timeout waiting for result{Style.RESET_ALL}")
            return False, None, 10.0
    
    def run_test(self, test_name: str, duration: float, pattern: str):
        """Run a single test."""
        logger.info(f"\n{Fore.BLUE}{'='*50}{Style.RESET_ALL}")
        logger.info(f"{Fore.BLUE}Test: {test_name}{Style.RESET_ALL}")
        logger.info(f"{Fore.BLUE}{'='*50}{Style.RESET_ALL}")
        
        audio = self.generate_audio(duration, pattern)
        success, text, elapsed = self.send_and_receive(audio, test_name)
        
        self.test_results.append({
            'name': test_name,
            'success': success,
            'text': text,
            'time': elapsed
        })
        
        return success
    
    def run_parallel_test(self, count: int = 3):
        """Test sending multiple requests in quick succession."""
        logger.info(f"\n{Fore.BLUE}{'='*50}{Style.RESET_ALL}")
        logger.info(f"{Fore.BLUE}Parallel Test: {count} requests{Style.RESET_ALL}")
        logger.info(f"{Fore.BLUE}{'='*50}{Style.RESET_ALL}")
        
        # Send multiple requests
        chunk_ids = []
        for i in range(count):
            audio = self.generate_audio(1.0, "speech")
            chunk_id = uuid.uuid4()
            
            audio_chunk = {
                "id": chunk_id.bytes,
                "audio": audio.tolist(),
                "sample_rate": 16000,
                "timestamp": time.time(),
            }
            
            queue_item = {
                "data": audio_chunk,
                "priority": i,  # Different priorities
                "timestamp": time.time(),
            }
            
            message = msgpack.packb(queue_item, use_bin_type=True)
            self.push_socket.send(message)
            chunk_ids.append(chunk_id)
            logger.info(f"{Fore.YELLOW}Sent request {i+1}/{count}{Style.RESET_ALL}")
            time.sleep(0.1)  # Small delay between sends
        
        # Receive all results
        received = 0
        for i in range(count):
            try:
                result_msg = self.pull_socket.recv()
                result = msgpack.unpackb(result_msg, raw=False)
                
                if "Ok" in result:
                    received += 1
                    logger.info(f"{Fore.GREEN}✅ Received result {received}/{count}{Style.RESET_ALL}")
                else:
                    logger.error(f"{Fore.RED}❌ Error in result {i+1}{Style.RESET_ALL}")
                    
            except zmq.Again:
                logger.error(f"{Fore.RED}❌ Timeout waiting for result {i+1}/{count}{Style.RESET_ALL}")
                break
        
        success = received == count
        self.test_results.append({
            'name': f'Parallel ({count} requests)',
            'success': success,
            'text': f'{received}/{count} completed',
            'time': 0
        })
        
        return success
    
    def print_summary(self):
        """Print test summary."""
        logger.info(f"\n{Fore.CYAN}{'='*50}{Style.RESET_ALL}")
        logger.info(f"{Fore.CYAN}TEST SUMMARY{Style.RESET_ALL}")
        logger.info(f"{Fore.CYAN}{'='*50}{Style.RESET_ALL}")
        
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r['success'])
        
        for result in self.test_results:
            status = f"{Fore.GREEN}✅ PASS{Style.RESET_ALL}" if result['success'] else f"{Fore.RED}❌ FAIL{Style.RESET_ALL}"
            logger.info(f"{status} {result['name']}")
            if result['time'] > 0:
                logger.info(f"     Time: {result['time']*1000:.0f}ms")
        
        logger.info(f"\n{Fore.CYAN}Results: {passed}/{total} tests passed{Style.RESET_ALL}")
        
        if passed == total:
            logger.info(f"{Fore.GREEN}🎉 All tests passed!{Style.RESET_ALL}")
        else:
            logger.info(f"{Fore.YELLOW}⚠️  Some tests failed{Style.RESET_ALL}")
        
        return passed == total
    
    def cleanup(self):
        """Clean up resources."""
        self.push_socket.close()
        self.pull_socket.close()
        self.context.term()

def main():
    """Run all tests."""
    tester = TranscriptionTester()
    
    try:
        # Individual tests
        tester.run_test("Short Speech", 1.0, "speech")
        time.sleep(1)
        
        tester.run_test("Long Speech", 3.0, "speech")
        time.sleep(1)
        
        tester.run_test("Pure Tone", 1.0, "tone")
        time.sleep(1)
        
        tester.run_test("Silence", 0.5, "silence")
        time.sleep(1)
        
        tester.run_test("White Noise", 1.0, "noise")
        time.sleep(1)
        
        # Parallel test
        tester.run_parallel_test(3)
        
        # Print summary
        all_passed = tester.print_summary()
        
        sys.exit(0 if all_passed else 1)
        
    finally:
        tester.cleanup()

if __name__ == "__main__":
    main()