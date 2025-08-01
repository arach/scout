# CSS Architecture Migration Guide

## Overview

This guide outlines the new CSS architecture for Scout and provides step-by-step instructions for migrating existing styles.

## New Architecture Structure

```
src/styles/
├── index.css           # Main entry point
├── base/              # Reset and base styles
│   ├── reset.css      # Modern CSS reset
│   └── typography.css # Base typography styles
├── tokens/            # Design tokens (CSS custom properties)
│   ├── colors.css     # Color system
│   ├── typography.css # Typography tokens
│   ├── spacing.css    # 8pt grid system
│   ├── shadows.css    # Shadow system
│   ├── animations.css # Animation tokens
│   └── z-index.css    # Z-index scale
├── layout/            # Layout utilities
├── utilities/         # Single-purpose utility classes
├── components/        # Shared component styles
├── themes/           # Theme-specific overrides
└── vendor/           # Third-party overrides
```

## Key Improvements

### 1. **Modular Architecture**
- Separated concerns into logical modules
- Eliminated the 2300+ line App.css file
- Clear import hierarchy

### 2. **Design Token System**
- All values defined as CSS custom properties
- Consistent spacing based on 8pt grid
- Centralized color management
- Theme-aware tokens

### 3. **CSS Modules Support**
- Component-scoped styles
- No more global namespace pollution
- Better tree-shaking in production
- Type-safe class names (with TypeScript)

### 4. **PostCSS Optimization**
- Automatic vendor prefixing
- CSS nesting support
- Unused CSS removal (PurgeCSS)
- Minification with cssnano

## Migration Steps

### Step 1: Install Dependencies

```bash
./scripts/install-css-deps.sh
```

### Step 2: Update Main Entry Point

In `src/main.tsx`, replace:
```tsx
import "./App.css"
```

With:
```tsx
import "./styles/index.css"
```

### Step 3: Migrate Component Styles

#### Option A: CSS Modules (Recommended)

1. Create a `.module.css` file next to your component:
```css
/* MyComponent.module.css */
.container {
  padding: var(--space-3);
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.title {
  font-size: var(--font-size-lg);
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
```

2. Import and use in your component:
```tsx
import styles from './MyComponent.module.css';

export const MyComponent = () => {
  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Hello</h2>
    </div>
  );
};
```

#### Option B: Use Utility Classes

```tsx
export const MyComponent = () => {
  return (
    <div className="p-3 bg-secondary rounded-md">
      <h2 className="text-lg text-primary mb-2">Hello</h2>
    </div>
  );
};
```

### Step 4: Update Theme-Specific Styles

Move all theme overrides from component files to `/styles/themes/theme-overrides.css`:

```css
[data-theme="terminal-chic"] .my-component {
  /* Terminal-specific styles */
}
```

### Step 5: Replace Hardcoded Values

Replace all hardcoded values with design tokens:

```css
/* Before */
.button {
  padding: 16px 32px;
  border-radius: 6px;
  font-size: 14px;
  color: #1f2937;
}

/* After */
.button {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}
```

## Component Migration Checklist

For each component:

- [ ] Extract styles to `.module.css` file
- [ ] Replace hardcoded values with design tokens
- [ ] Remove global class names
- [ ] Move theme-specific styles to theme overrides
- [ ] Update component imports
- [ ] Test with different themes
- [ ] Verify responsive behavior

## Performance Benefits

1. **Smaller Bundle Size**
   - PurgeCSS removes unused styles
   - CSS modules enable better tree-shaking
   - Modular imports reduce initial load

2. **Better Caching**
   - Separated files can be cached independently
   - Theme changes don't invalidate all styles

3. **Faster Development**
   - Hot module replacement works better
   - Easier to find and fix style issues
   - No more specificity wars

## Best Practices

1. **Use Design Tokens**
   - Always use CSS variables for values
   - Never hardcode colors, spacing, or sizes

2. **Prefer CSS Modules**
   - Use for component-specific styles
   - Avoid global styles when possible

3. **Keep Specificity Low**
   - Use single class selectors
   - Avoid deep nesting
   - Don't use IDs for styling

4. **Organize by Feature**
   - Keep component styles with components
   - Use shared styles sparingly

5. **Document Complex Styles**
   - Add comments for non-obvious code
   - Document animation sequences
   - Explain theme-specific overrides

## Troubleshooting

### Styles Not Applied
- Check import order in `index.css`
- Verify CSS module imports
- Check for typos in class names

### Theme Not Working
- Ensure theme provider is wrapping app
- Check CSS variable names match
- Verify theme-specific selectors

### Build Errors
- Run `pnpm install` to ensure dependencies
- Check PostCSS config syntax
- Verify all imported files exist

## Next Steps

1. Complete migration of all components
2. Remove old CSS files
3. Set up CSS linting rules
4. Add CSS documentation
5. Create component style guide