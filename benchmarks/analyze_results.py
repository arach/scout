#!/usr/bin/env python3
"""
Analyze progressive transcription benchmark results
"""

import json
import os
import sys
from pathlib import Path
from collections import defaultdict
import matplotlib.pyplot as plt

def load_results(results_dir):
    """Load all JSON result files from a directory"""
    results = []
    for file in Path(results_dir).glob("*.json"):
        if "config" not in file.name:
            with open(file) as f:
                data = json.load(f)
                results.append(data)
    return results

def analyze_by_recording(results):
    """Group and analyze results by recording"""
    by_recording = defaultdict(list)
    
    for r in results:
        recording = r['recording'].replace('.wav', '')
        by_recording[recording].append(r)
    
    analysis = {}
    for recording, data in by_recording.items():
        # Sort by chunk size
        data.sort(key=lambda x: x['chunk_size'])
        
        # Find optimal chunk size (lowest total time)
        optimal = min(data, key=lambda x: x['total_time_ms'])
        
        analysis[recording] = {
            'duration': data[0]['duration_secs'],
            'results': data,
            'optimal_chunk_size': optimal['chunk_size'],
            'optimal_time_ms': optimal['total_time_ms']
        }
    
    return analysis

def print_analysis(analysis):
    """Print analysis results"""
    print("\nProgressive Transcription Benchmark Analysis")
    print("=" * 60)
    
    for recording, data in analysis.items():
        print(f"\n{recording} (duration: {data['duration']:.1f}s)")
        print("-" * 40)
        print(f"{'Chunk Size':>10} | {'Total Time':>10} | {'Proc Time':>10} | {'Final Time':>10} | {'Refinements':>11}")
        print("-" * 40)
        
        for r in data['results']:
            print(f"{r['chunk_size']:>10}s | "
                  f"{r['total_time_ms']/1000:>9.2f}s | "
                  f"{r['processing_time_ms']/1000:>9.2f}s | "
                  f"{r['finalization_time_ms']/1000:>9.2f}s | "
                  f"{r['refinements_completed']:>11}")
        
        print(f"\nOptimal chunk size: {data['optimal_chunk_size']}s "
              f"({data['optimal_time_ms']/1000:.2f}s total time)")

def plot_results(analysis, output_dir):
    """Create visualization of results"""
    recordings = list(analysis.keys())
    
    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()
    
    for idx, (recording, data) in enumerate(analysis.items()):
        ax = axes[idx]
        
        chunk_sizes = [r['chunk_size'] for r in data['results']]
        total_times = [r['total_time_ms']/1000 for r in data['results']]
        final_times = [r['finalization_time_ms']/1000 for r in data['results']]
        refinements = [r['refinements_completed'] for r in data['results']]
        
        # Plot times
        ax2 = ax.twinx()
        
        l1 = ax.plot(chunk_sizes, total_times, 'b-o', label='Total Time')
        l2 = ax.plot(chunk_sizes, final_times, 'r--o', label='Finalization Time')
        l3 = ax2.plot(chunk_sizes, refinements, 'g:s', label='Refinements')
        
        ax.set_xlabel('Chunk Size (s)')
        ax.set_ylabel('Time (s)', color='b')
        ax2.set_ylabel('Refinements', color='g')
        ax.set_title(f'{recording} ({data["duration"]:.1f}s)')
        ax.grid(True, alpha=0.3)
        
        # Combine legends
        lns = l1 + l2 + l3
        labs = [l.get_label() for l in lns]
        ax.legend(lns, labs, loc='best')
        
        # Mark optimal
        optimal_idx = chunk_sizes.index(data['optimal_chunk_size'])
        ax.plot(chunk_sizes[optimal_idx], total_times[optimal_idx], 
                'ro', markersize=10, markerfacecolor='none', markeredgewidth=2)
    
    plt.suptitle('Progressive Transcription Performance by Chunk Size')
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'benchmark_results.png'), dpi=150)
    print(f"\nPlot saved to: {os.path.join(output_dir, 'benchmark_results.png')}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_results.py <results_directory>")
        sys.exit(1)
    
    results_dir = sys.argv[1]
    
    # Load results
    results = load_results(results_dir)
    if not results:
        print(f"No results found in {results_dir}")
        sys.exit(1)
    
    # Analyze
    analysis = analyze_by_recording(results)
    
    # Print analysis
    print_analysis(analysis)
    
    # Plot if matplotlib available
    try:
        plot_results(analysis, results_dir)
    except ImportError:
        print("\nMatplotlib not available - skipping plots")
    except Exception as e:
        print(f"\nError creating plots: {e}")
    
    # Save analysis summary
    summary_file = os.path.join(results_dir, "analysis_summary.json")
    with open(summary_file, 'w') as f:
        json.dump(analysis, f, indent=2, default=str)
    print(f"\nAnalysis saved to: {summary_file}")

if __name__ == "__main__":
    main()