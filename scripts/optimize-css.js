#!/usr/bin/env node

/**
 * Simple CSS optimization script
 * - Removes duplicate CSS rules
 * - Minifies CSS for production
 * - Reports on CSS usage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function analyzeCSSUsage() {
  const cssFiles = [];
  const cssRules = new Map();
  const duplicates = [];
  
  // Find all CSS files
  function findCSSFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !file.includes('node_modules') && !file.includes('target')) {
        findCSSFiles(fullPath);
      } else if (file.endsWith('.css')) {
        cssFiles.push(fullPath);
      }
    }
  }
  
  findCSSFiles(path.join(__dirname, '..', 'src'));
  
  // Analyze CSS files
  let totalLines = 0;
  let totalSize = 0;
  
  for (const file of cssFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    totalLines += lines.length;
    totalSize += content.length;
    
    // Extract CSS rules (simple regex)
    const rules = content.match(/[^{}]+\{[^}]*\}/g) || [];
    
    for (const rule of rules) {
      const normalized = rule.trim().replace(/\s+/g, ' ');
      if (cssRules.has(normalized)) {
        duplicates.push({
          rule: normalized,
          files: [cssRules.get(normalized), file]
        });
      } else {
        cssRules.set(normalized, file);
      }
    }
  }
  
  // Report findings
  console.log('CSS Analysis Report');
  console.log('==================');
  console.log(`Total CSS files: ${cssFiles.length}`);
  console.log(`Total lines: ${totalLines.toLocaleString()}`);
  console.log(`Total size: ${(totalSize / 1024).toFixed(2)} KB`);
  console.log(`Unique rules: ${cssRules.size}`);
  console.log(`Duplicate rules: ${duplicates.length}`);
  
  if (duplicates.length > 0) {
    console.log('\nTop duplicate rules:');
    duplicates.slice(0, 10).forEach(dup => {
      console.log(`- "${dup.rule.substring(0, 50)}..." in:`);
      dup.files.forEach(file => console.log(`  ${path.relative(process.cwd(), file)}`));
    });
  }
  
  // Find largest CSS files
  const fileSizes = cssFiles.map(file => ({
    file: path.relative(process.cwd(), file),
    size: fs.statSync(file).size
  })).sort((a, b) => b.size - a.size);
  
  console.log('\nLargest CSS files:');
  fileSizes.slice(0, 10).forEach(({ file, size }) => {
    console.log(`- ${file}: ${(size / 1024).toFixed(2)} KB`);
  });
}

// Run the analysis
analyzeCSSUsage();