# Scout Documentation

This directory contains the technical documentation for Scout. The documentation is automatically built and integrated into the Scout website.

## Documentation Structure

```
docs/
├── AUDIO_PIPELINE.md              # Audio capture and processing pipeline
├── PIPELINE_OVERVIEW.md           # High-level pipeline overview
├── TRANSCRIPTION_ARCHITECTURE.md  # Transcription strategies and architecture
├── AGENT_REPORT_AUDIO_SYSTEM.md   # Performance analysis
├── WHISPER_IMPROVEMENTS.md        # Whisper optimization details
└── features/
    └── transcription-overlay.md   # Feature-specific documentation
```

## Building Documentation

The documentation is automatically converted from Markdown to React components for the website.

### Build Process

1. **Write/Edit Documentation**: Create or modify `.md` files in this directory
2. **Build Documentation**: Run from the landing directory:
   ```bash
   cd ../landing
   pnpm build:docs
   ```
3. **View in Website**: Start the development server:
   ```bash
   pnpm dev
   ```
   Then navigate to http://localhost:3000/docs

### How It Works

The build process (`landing/scripts/build-docs.js`):
1. Reads all configured markdown files from `/docs`
2. Converts markdown to HTML using `marked` with syntax highlighting
3. Generates TypeScript React components in `/landing/app/docs/content/`
4. Creates an index file for easy importing
5. Integrates with the docs page navigation

### Adding New Documentation

To add new documentation:

1. Create a new `.md` file in the appropriate directory
2. Add it to the configuration in `/landing/scripts/build-docs.js`:
   ```javascript
   const DOCS_CONFIG = {
     sections: [
       {
         id: 'your-section',
         title: 'Your Section Title',
         files: [
           { file: 'YOUR_FILE.md', title: 'Display Title', id: 'url-slug' }
         ]
       }
     ]
   };
   ```
3. Run `pnpm build:docs` to generate the components
4. The documentation will automatically appear in the website navigation

### Writing Guidelines

- Use standard Markdown syntax
- Code blocks should specify the language for syntax highlighting
- Include diagrams using ASCII art or Markdown-compatible formats
- Keep sections well-organized with clear headings
- Link between documents using relative paths

### Deployment

Documentation is built automatically when deploying the website:
- `pnpm build` in the landing directory builds both docs and the website
- The generated components are included in the static export
- No manual copying or synchronization needed

## Current Documentation

### Architecture
- **Pipeline Overview**: Complete audio-to-text pipeline flow
- **Audio Pipeline**: Detailed audio capture and processing
- **Transcription Architecture**: Ring buffer vs processing queue strategies

### Performance
- **Audio System Analysis**: Performance bottlenecks and optimizations
- **Whisper Improvements**: Model optimization techniques

### Features
- **Transcription Overlay**: macOS overlay implementation details