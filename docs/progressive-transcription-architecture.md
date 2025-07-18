# Progressive Transcription Architecture

## Overview

This document outlines a two-tier transcription approach that prioritizes immediate user feedback while progressively enhancing transcript quality in the background.

## Core Principle

**Speed first, quality follows** - Users should see their words immediately, with accuracy improvements happening silently in the background.

## The Two-Tier Approach

### Tier 1: Immediate Feedback (Tiny Model)
- Process audio in 5-second chunks
- Display results immediately (~200-300ms per chunk)
- Includes the final chunk for instant gratification
- Optimized for conversational flow and quick notes

### Tier 2: Quality Refinement (Medium Model)
- Process audio in 30-second chunks in background
- Better context window improves accuracy
- Silently replaces Tiny transcript when ready
- Users can continue working without waiting

## Why This Works

1. **Cognitive Mode Matching**: Quick thoughts need quick transcription. Longer compositions can afford to wait for quality.

2. **No Final Chunk Waiting**: Traditional approaches make users wait for the last chunk. We transcribe it with Tiny first, then upgrade later.

3. **Progressive Enhancement**: Like video streaming - show low-res immediately, high-res fills in behind.

## Implementation Considerations

### Chunk Boundaries
- Respect natural speech pauses when possible
- Overlap chunks slightly to catch word boundaries
- Smart merging: match common phrases to align Tiny and Medium transcripts

### Automatic Model Selection
- Under 30-45 seconds: Tiny only (most use cases)
- Over 45 seconds: Two-tier approach
- Context-aware: Could detect dictation vs conversation patterns

### Future Enhancements
- Progressive LLM processing for formatting and commands
- Run grammar/punctuation fixes in parallel
- Process special commands while recording continues

## Next Steps

1. Implement two-tier transcription with existing ring buffer architecture
2. Start with fixed 30-second chunks for Medium model
3. Add simple word-boundary matching for transcript merging
4. Measure real-world performance impact
5. Add subtle UI indicators for progressive updates

## Design Philosophy

Don't make users choose between speed and quality - give them speed immediately and quality automatically. Power users can override defaults, but the system should "just work" for most people.

The transcription system should feel magical: words appear instantly as you speak, and if you look back later, they've been quietly perfected.