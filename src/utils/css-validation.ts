/**
 * CSS Validation Utilities
 * 
 * Utilities to help ensure CSS follows Scout's architecture guidelines
 * and maintains consistency across the application.
 */

// Common hardcoded values that should be replaced with CSS variables
const HARDCODED_COLORS = [
  /#[0-9a-fA-F]{3,6}/g, // Hex colors
  /rgb\([^)]+\)/g,      // RGB colors
  /rgba\([^)]+\)/g,     // RGBA colors
  /hsl\([^)]+\)/g,      // HSL colors
  /hsla\([^)]+\)/g,     // HSLA colors
];

const HARDCODED_SPACING = [
  /\d+px(?!.*var\()/g,  // Pixel values not in CSS variables
  /\d+rem(?!.*var\()/g, // Rem values not in CSS variables
  /\d+em(?!.*var\()/g,  // Em values not in CSS variables
];

/**
 * Validate CSS content for common anti-patterns
 */
export function validateCSS(cssContent: string, fileName: string) {
  const issues: Array<{
    type: 'error' | 'warning' | 'info';
    line: number;
    message: string;
    suggestion?: string;
  }> = [];

  const lines = cssContent.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmedLine = line.trim();

    // Skip comments and empty lines
    if (!trimmedLine || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
      return;
    }

    // Check for hardcoded colors
    HARDCODED_COLORS.forEach(pattern => {
      if (pattern.test(trimmedLine)) {
        issues.push({
          type: 'warning',
          line: lineNumber,
          message: `Hardcoded color found: ${trimmedLine}`,
          suggestion: 'Use CSS custom properties like var(--text-primary) instead'
        });
      }
    });

    // Check for hardcoded spacing (but allow some exceptions)
    if (!trimmedLine.includes('font-size') && !trimmedLine.includes('line-height')) {
      HARDCODED_SPACING.forEach(pattern => {
        const matches = trimmedLine.match(pattern);
        if (matches) {
          issues.push({
            type: 'info',
            line: lineNumber,
            message: `Consider using design system spacing: ${matches[0]}`,
            suggestion: 'Use var(--space-X) or var(--component-padding-X) values'
          });
        }
      });
    }

    // Check for non-BEM class naming
    const classNameMatch = trimmedLine.match(/\.(\w+(?:-\w+)*)/g);
    if (classNameMatch) {
      classNameMatch.forEach(className => {
        const name = className.substring(1); // Remove the dot
        
        // Good patterns: component-name, component-name__element, component-name--modifier
        const isBEM = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(__|--)[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name) ||
                     /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
        
        if (!isBEM && !name.startsWith('spacing-') && !name.startsWith('mt-') && 
            !name.startsWith('mb-') && !name.startsWith('gap-')) {
          issues.push({
            type: 'info',
            line: lineNumber,
            message: `Consider BEM naming convention for: ${className}`,
            suggestion: 'Use block__element or block--modifier pattern'
          });
        }
      });
    }

    // Check for !important usage
    if (trimmedLine.includes('!important')) {
      issues.push({
        type: 'warning',
        line: lineNumber,
        message: '!important usage detected - consider CSS specificity refactoring',
        suggestion: 'Use more specific selectors instead of !important'
      });
    }

    // Check for missing CSS custom property usage in common properties
    const colorProperties = ['color', 'background-color', 'border-color', 'fill', 'stroke'];
    colorProperties.forEach(prop => {
      const propPattern = new RegExp(`${prop}\\s*:\\s*(?!var\\()[^;]+`, 'i');
      if (propPattern.test(trimmedLine) && !trimmedLine.includes('transparent') && 
          !trimmedLine.includes('inherit') && !trimmedLine.includes('currentColor')) {
        issues.push({
          type: 'warning',
          line: lineNumber,
          message: `${prop} should use CSS custom properties`,
          suggestion: `Use var(--text-primary), var(--bg-primary), etc.`
        });
      }
    });
  });

  return {
    fileName,
    totalLines: lines.length,
    issues,
    summary: {
      errors: issues.filter(i => i.type === 'error').length,
      warnings: issues.filter(i => i.type === 'warning').length,
      infos: issues.filter(i => i.type === 'info').length,
    }
  };
}

/**
 * Generate a report for CSS validation issues
 */
export function generateCSSReport(validationResults: ReturnType<typeof validateCSS>[]) {
  const totalIssues = validationResults.reduce((sum, result) => 
    sum + result.issues.length, 0
  );
  
  const totalErrors = validationResults.reduce((sum, result) => 
    sum + result.summary.errors, 0
  );
  
  const totalWarnings = validationResults.reduce((sum, result) => 
    sum + result.summary.warnings, 0
  );
  
  const totalInfos = validationResults.reduce((sum, result) => 
    sum + result.summary.infos, 0
  );

  console.log('\n=== Scout CSS Validation Report ===');
  console.log(`Total files checked: ${validationResults.length}`);
  console.log(`Total issues found: ${totalIssues}`);
  console.log(`  - Errors: ${totalErrors}`);
  console.log(`  - Warnings: ${totalWarnings}`);
  console.log(`  - Info: ${totalInfos}`);
  console.log('\n');

  validationResults.forEach(result => {
    if (result.issues.length > 0) {
      console.log(`📄 ${result.fileName} (${result.issues.length} issues)`);
      
      result.issues.forEach(issue => {
        const icon = issue.type === 'error' ? '❌' : 
                    issue.type === 'warning' ? '⚠️' : 'ℹ️';
        
        console.log(`  ${icon} Line ${issue.line}: ${issue.message}`);
        if (issue.suggestion) {
          console.log(`     💡 ${issue.suggestion}`);
        }
      });
      console.log('');
    }
  });

  return {
    totalFiles: validationResults.length,
    totalIssues,
    summary: {
      errors: totalErrors,
      warnings: totalWarnings,
      infos: totalInfos,
    }
  };
}

/**
 * Recommended CSS custom properties for common use cases
 */
export const RECOMMENDED_CSS_VARIABLES = {
  // Text colors
  'color: #000': 'color: var(--text-primary)',
  'color: #333': 'color: var(--text-primary)',
  'color: #666': 'color: var(--text-secondary)',
  'color: #999': 'color: var(--text-tertiary)',
  'color: #fff': 'color: var(--text-inverse)',
  
  // Background colors
  'background: #fff': 'background: var(--bg-primary)',
  'background-color: #fff': 'background-color: var(--bg-primary)',
  'background: #f5f5f5': 'background: var(--bg-secondary)',
  
  // Spacing
  'padding: 8px': 'padding: var(--space-1)',
  'padding: 16px': 'padding: var(--space-2)',
  'padding: 24px': 'padding: var(--space-3)',
  'margin: 8px': 'margin: var(--space-1)',
  'margin: 16px': 'margin: var(--space-2)',
  'margin: 24px': 'margin: var(--space-3)',
  
  // Border
  'border: 1px solid #ddd': 'border: 1px solid var(--border-primary)',
  'border-color: #ddd': 'border-color: var(--border-primary)',
};
