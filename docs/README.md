# Scout Documentation

Welcome to the Scout documentation. This directory contains technical documentation, architecture guides, and development resources for the Scout dictation application.

## 📁 Directory Structure

### `/architecture`
Technical architecture documentation and system design
- `audio-pipeline.md` - Audio processing pipeline architecture
- `transcription-architecture.md` - Transcription system design
- `pipeline-overview.md` - Overall data flow and processing pipeline
- `project-structure.md` - Codebase organization and structure
- `audio-metadata.md` - Audio metadata handling and storage
- `progressive-transcription-architecture.md` - Progressive transcription implementation

### `/features`
Feature specifications and documentation
- `dictionary-feature.md` - Dictionary replacement feature
- `active-app-detection.md` - Active application detection
- `overlay-hover.md` - Overlay hover interactions
- `onboarding-spec.md` - Onboarding flow specification
- `transcription-overlay.md` - Transcription overlay feature

### `/development`
Development guides and implementation notes
- `debug-logging.md` - Debugging and logging guide
- `open-overlay-devtools.md` - Overlay DevTools usage
- `css-architecture-migration.md` - CSS architecture migration guide
- `backend-agent.md` - Backend agent documentation
- `audio-recorder-changes.md` - Audio recorder implementation changes
- `progressive-transcription-implementation.md` - Progressive transcription implementation details
- `progressive-transcription-testing.md` - Testing progressive transcription

### `/analysis`
Technical analysis and reports
- `agent-reports-summary.md` - Summary of agent analysis reports
- `agent-report-ai-pipeline.md` - AI pipeline analysis
- `agent-report-audio-system.md` - Audio system analysis
- `agent-report-state-management.md` - State management analysis
- `agent-report-system-integration.md` - System integration analysis
- `agent-report-ui-components.md` - UI components analysis

### `/guides`
User and developer guides
- `performance.md` - Performance optimization guide
- `performance-optimization-summary.md` - Performance optimization summary
- `whisper-improvements.md` - Whisper model improvements
- `dictionary-marketing.md` - Dictionary feature marketing guide

### `/design-system`
Design system documentation
- `settings-ui.md` - Settings UI design documentation

### `/screenshots`
Application screenshots for documentation
- Various UI screenshots

### `/archive`
Historical documentation and outdated specifications
- Contains older documentation for reference purposes

## 🚀 Getting Started

If you're new to Scout development, start with:
1. `/architecture/project-structure.md` - Understand the codebase
2. `/architecture/pipeline-overview.md` - Learn the data flow
3. `/development/debug-logging.md` - Set up debugging

## 📝 Contributing

When adding new documentation:
- Use lowercase filenames with hyphens (e.g., `feature-name.md`)
- Place documents in the appropriate subdirectory
- Update this README if adding new categories
- Move outdated docs to `/archive` rather than deleting

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