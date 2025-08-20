#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyzmq",
#   "msgpack",
#   "numpy",
# ]
# ///
"""Load test for the transcription service."""

import time
import uuid
import zmq
import msgpack
import numpy as np
import argparse
from concurrent.futures import ThreadPoolExecutor
import statistics

def send_request(duration=1.0):
    """Send a single transcription request."""
    context = zmq.Context()
    push_socket = context.socket(zmq.PUSH)
    push_socket.connect("tcp://127.0.0.1:5555")
    
    pull_socket = context.socket(zmq.PULL)
    pull_socket.connect("tcp://127.0.0.1:5556")
    pull_socket.setsockopt(zmq.RCVTIMEO, 30000)  # 30 second timeout
    
    # Generate audio
    sample_rate = 16000
    samples = int(duration * sample_rate)
    t = np.linspace(0, duration, samples)
    fundamental = 120 + 50 * np.sin(2 * np.pi * 0.5 * t)
    audio = np.sin(2 * np.pi * fundamental * t) * 0.3
    audio = audio.astype(np.float32)
    
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
    
    # Send and time the request
    start_time = time.time()
    message = msgpack.packb(queue_item, use_bin_type=True)
    push_socket.send(message)
    
    try:
        result_msg = pull_socket.recv()
        elapsed = time.time() - start_time
        result = msgpack.unpackb(result_msg, raw=False)
        
        push_socket.close()
        pull_socket.close()
        context.term()
        
        if "Ok" in result:
            return True, elapsed
        else:
            return False, elapsed
            
    except zmq.Again:
        push_socket.close()
        pull_socket.close()
        context.term()
        return False, 30.0

def run_load_test(concurrent_requests=5, total_requests=20, audio_duration=1.0):
    """Run load test with specified parameters."""
    print(f"Load Test Configuration:")
    print(f"  Concurrent requests: {concurrent_requests}")
    print(f"  Total requests: {total_requests}")
    print(f"  Audio duration: {audio_duration}s")
    print(f"  Starting test...\n")
    
    results = []
    start_time = time.time()
    
    with ThreadPoolExecutor(max_workers=concurrent_requests) as executor:
        futures = []
        for i in range(total_requests):
            future = executor.submit(send_request, audio_duration)
            futures.append(future)
            
            # Stagger the requests slightly
            if i < total_requests - 1:
                time.sleep(0.1)
        
        # Collect results
        for i, future in enumerate(futures):
            success, elapsed = future.result()
            results.append((success, elapsed))
            status = "✅" if success else "❌"
            print(f"{status} Request {i+1}/{total_requests}: {elapsed:.2f}s")
    
    total_time = time.time() - start_time
    
    # Calculate statistics
    successful = [r[1] for r in results if r[0]]
    failed = len(results) - len(successful)
    
    print(f"\n{'='*50}")
    print(f"LOAD TEST RESULTS")
    print(f"{'='*50}")
    print(f"Total time: {total_time:.2f}s")
    print(f"Total requests: {total_requests}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {failed}")
    print(f"Success rate: {len(successful)/total_requests*100:.1f}%")
    
    if successful:
        print(f"\nResponse times (successful requests):")
        print(f"  Min: {min(successful):.2f}s")
        print(f"  Max: {max(successful):.2f}s")
        print(f"  Mean: {statistics.mean(successful):.2f}s")
        print(f"  Median: {statistics.median(successful):.2f}s")
        if len(successful) > 1:
            print(f"  Stdev: {statistics.stdev(successful):.2f}s")
        
        print(f"\nThroughput: {len(successful)/total_time:.2f} requests/second")

def main():
    parser = argparse.ArgumentParser(description='Load test the transcription service')
    parser.add_argument('--concurrent', type=int, default=5,
                       help='Number of concurrent requests')
    parser.add_argument('--total', type=int, default=20,
                       help='Total number of requests')
    parser.add_argument('--duration', type=float, default=1.0,
                       help='Audio duration in seconds')
    
    args = parser.parse_args()
    
    run_load_test(args.concurrent, args.total, args.duration)

if __name__ == "__main__":
    main()