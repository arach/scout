#!/usr/bin/env node

/**
 * Documentation Build Script
 * Converts markdown documentation files into TypeScript React components
 */

const fs = require('fs').promises;
const path = require('path');
const { marked } = require('marked');
const prism = require('prismjs');
require('prismjs/components/prism-typescript');
require('prismjs/components/prism-rust');
require('prismjs/components/prism-bash');
require('prismjs/components/prism-json');
require('prismjs/components/prism-sql');

// Configure marked with syntax highlighting
marked.setOptions({
  highlight: function(code, lang) {
    if (prism.languages[lang]) {
      return prism.highlight(code, prism.languages[lang], lang);
    }
    return code;
  },
  breaks: true,
  gfm: true
});

// Docs configuration
const DOCS_SOURCE = path.join(__dirname, '../../docs');
const DOCS_DEST = path.join(__dirname, '../app/docs/content');
const DOCS_INDEX_FILE = path.join(DOCS_DEST, 'index.ts');

// Documentation sections and their files
const DOCS_CONFIG = {
  sections: [
    {
      id: 'architecture',
      title: 'Architecture',
      files: [
        { file: 'PIPELINE_OVERVIEW.md', title: 'Pipeline Overview', id: 'pipeline-overview' },
        { file: 'AUDIO_PIPELINE.md', title: 'Audio Pipeline', id: 'audio-pipeline' },
        { file: 'TRANSCRIPTION_ARCHITECTURE.md', title: 'Transcription Architecture', id: 'transcription-architecture' }
      ]
    },
    {
      id: 'performance',
      title: 'Performance',
      files: [
        { file: 'AGENT_REPORT_AUDIO_SYSTEM.md', title: 'Audio System Analysis', id: 'audio-system-analysis' },
        { file: 'WHISPER_IMPROVEMENTS.md', title: 'Whisper Optimizations', id: 'whisper-optimizations' }
      ]
    },
    {
      id: 'features',
      title: 'Features',
      files: [
        { file: 'features/transcription-overlay.md', title: 'Transcription Overlay', id: 'transcription-overlay' }
      ]
    }
  ]
};

// Convert markdown to React component
function markdownToReactComponent(markdown, metadata) {
  // Convert markdown to HTML
  const html = marked(markdown);
  
  // Escape backticks and dollar signs in the HTML
  const escapedHtml = html
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  
  // Generate component
  return `// Auto-generated from ${metadata.file}
// Do not edit directly - edit the source markdown file

export const ${metadata.componentName} = {
  id: '${metadata.id}',
  title: '${metadata.title}',
  content: \`${escapedHtml}\`
};
`;
}

// Generate component name from file path
function generateComponentName(filePath) {
  const basename = path.basename(filePath, '.md');
  return basename
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

async function buildDocs() {
  console.log('🔨 Building documentation...');
  
  try {
    // Ensure destination directory exists
    await fs.mkdir(DOCS_DEST, { recursive: true });
    
    const allComponents = [];
    const exports = [];
    
    // Process each section
    for (const section of DOCS_CONFIG.sections) {
      console.log(`\n📁 Processing section: ${section.title}`);
      
      const sectionComponents = [];
      
      for (const doc of section.files) {
        const sourcePath = path.join(DOCS_SOURCE, doc.file);
        
        try {
          // Read markdown file
          const markdown = await fs.readFile(sourcePath, 'utf8');
          console.log(`  ✓ Read ${doc.file}`);
          
          // Generate component
          const componentName = generateComponentName(doc.file);
          const metadata = {
            file: doc.file,
            componentName,
            id: doc.id,
            title: doc.title
          };
          
          const component = markdownToReactComponent(markdown, metadata);
          
          // Write component file
          const componentFileName = `${doc.id}.tsx`;
          const componentPath = path.join(DOCS_DEST, componentFileName);
          await fs.writeFile(componentPath, component);
          console.log(`  ✓ Generated ${componentFileName}`);
          
          // Track for index
          sectionComponents.push({
            componentName,
            fileName: componentFileName,
            ...doc
          });
          
        } catch (err) {
          console.error(`  ✗ Failed to process ${doc.file}: ${err.message}`);
        }
      }
      
      // Add section to allComponents
      if (sectionComponents.length > 0) {
        allComponents.push({
          ...section,
          components: sectionComponents
        });
      }
    }
    
    // Generate index file
    const indexContent = generateIndexFile(allComponents);
    await fs.writeFile(DOCS_INDEX_FILE, indexContent);
    console.log('\n✓ Generated index.ts');
    
    // Generate sections metadata
    const sectionsFile = path.join(DOCS_DEST, 'sections.ts');
    const sectionsContent = generateSectionsFile(allComponents);
    await fs.writeFile(sectionsFile, sectionsContent);
    console.log('✓ Generated sections.ts');
    
    console.log('\n✅ Documentation build complete!');
    console.log(`📁 Output directory: ${DOCS_DEST}`);
    
  } catch (error) {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
  }
}

function generateIndexFile(sections) {
  const imports = [];
  const exports = [];
  
  sections.forEach(section => {
    section.components.forEach(comp => {
      imports.push(`import { ${comp.componentName} } from './${comp.id}';`);
      exports.push(comp.componentName);
    });
  });
  
  return `// Auto-generated documentation index
// Do not edit directly - run pnpm build:docs

${imports.join('\n')}

export const allDocs = {
${exports.map(name => `  ${name}`).join(',\n')}
};

export type DocContent = {
  id: string;
  title: string;
  content: string;
};
`;
}

function generateSectionsFile(sections) {
  return `// Auto-generated documentation sections
// Do not edit directly - run pnpm build:docs

export type DocSection = {
  id: string;
  title: string;
  docs: Array<{
    id: string;
    title: string;
  }>;
};

export const docSections: DocSection[] = ${JSON.stringify(
  sections.map(section => ({
    id: section.id,
    title: section.title,
    docs: section.components.map(comp => ({
      id: comp.id,
      title: comp.title
    }))
  })),
  null,
  2
)};
`;
}

// Run the build
buildDocs().catch(console.error);