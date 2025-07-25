# Scout CSS Architecture & Style Guide

## Overview

Scout uses a **consistent CSS architecture** based on CSS custom properties (variables), a design system, and component-scoped styles. This document outlines our CSS organization strategy and best practices.

## CSS Architecture Strategy

### 1. **CSS Custom Properties (Preferred)**
We use CSS custom properties for all theming, spacing, and design tokens. This approach provides:
- Theme switching capabilities
- Consistent design tokens
- Easy maintenance and updates
- Better performance than CSS-in-JS

### 2. **Component-Scoped CSS Files**
Each React component has its own CSS file:
```
ComponentName.tsx
ComponentName.css  ← Component-specific styles
```

### 3. **No CSS Modules**
We **do not** use CSS modules (`.module.css`) to keep the architecture simple and leverage CSS custom properties for theming.

## File Organization

```
src/
├── styles/                    # Global styles and design system
│   ├── spacing.css           # Spacing variables and utilities
│   └── README.md             # This file
├── App.css                   # Root application styles
├── overlay.css               # Overlay-specific styles
├── components/               # Component styles
│   ├── ComponentName.css     # One CSS file per component
│   └── ...
└── themes/                   # Theme definitions
    └── base/
        └── terminal.ts       # Theme configuration
```

## Design System

### Spacing System
We use an **8pt grid system** defined in `styles/spacing.css`:

```css
:root {
  --space-unit: 8px;
  --space-1: 8px;   /* 1 × 8pt */
  --space-2: 16px;  /* 2 × 8pt */
  --space-3: 24px;  /* 3 × 8pt */
  /* ... */
}
```

### Theme Variables
All colors and theme properties are defined as CSS custom properties:

```css
:root {
  --text-primary: /* set by theme */;
  --bg-primary: /* set by theme */;
  --border-primary: /* set by theme */;
  /* ... */
}
```

## Best Practices

### ✅ DO

1. **Use CSS custom properties for all values**
   ```css
   .my-component {
     color: var(--text-primary);
     padding: var(--space-2);
     border: 1px solid var(--border-primary);
   }
   ```

2. **Keep component styles scoped**
   ```css
   /* ComponentName.css */
   .component-name {
     /* Component-specific styles */
   }
   
   .component-name__element {
     /* BEM-style element naming */
   }
   ```

3. **Import component CSS in the React component**
   ```tsx
   import './ComponentName.css';
   
   export const ComponentName = () => {
     return <div className="component-name">...</div>;
   };
   ```

4. **Use design system spacing**
   ```css
   .my-component {
     padding: var(--component-padding-md);
     margin-bottom: var(--space-3);
   }
   ```

5. **Follow BEM naming convention**
   ```css
   .transcript-item { /* Block */ }
   .transcript-item__content { /* Element */ }
   .transcript-item--selected { /* Modifier */ }
   ```

### ❌ DON'T

1. **Don't use hardcoded values**
   ```css
   /* ❌ Bad */
   .my-component {
     color: #333;
     padding: 16px;
   }
   
   /* ✅ Good */
   .my-component {
     color: var(--text-primary);
     padding: var(--space-2);
   }
   ```

2. **Don't use CSS modules**
   ```css
   /* ❌ Avoid Component.module.css */
   ```

3. **Don't use CSS-in-JS libraries**
   ```tsx
   /* ❌ Avoid styled-components, emotion, etc. */
   ```

4. **Don't create global utility classes unnecessarily**
   ```css
   /* ❌ Avoid creating too many utility classes */
   /* Use spacing utilities from spacing.css instead */
   ```

## Migration Guidelines

If you find styles that don't follow these patterns:

1. **Replace hardcoded colors with CSS variables**
2. **Replace hardcoded spacing with design system values**
3. **Ensure component CSS is properly scoped**
4. **Use consistent naming conventions**

## Performance Considerations

- **CSS custom properties are fast** - they're processed by the browser's native CSS engine
- **Minimal CSS bundle size** - no CSS-in-JS runtime overhead
- **Efficient theme switching** - only CSS variables need to update
- **Tree shaking** - unused CSS can be eliminated by build tools

## Testing Styles

To test the visual consistency:

1. **Switch between themes** - ensure all components adapt properly
2. **Check spacing consistency** - use browser dev tools to verify spacing values
3. **Validate color usage** - ensure all colors come from theme variables

## Examples

### Good Component CSS Structure

```css
/* TranscriptItem.css */
.transcript-item {
  position: relative;
  background: transparent;
  border-bottom: 1px solid var(--border-primary);
  padding: var(--space-2) var(--space-3);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.transcript-item__content {
  flex: 1;
  min-width: 0;
}

.transcript-item__actions {
  display: flex;
  gap: var(--space-1);
}

.transcript-item--selected {
  background: var(--bg-selected);
}

.transcript-item--clickable {
  cursor: pointer;
}

.transcript-item--clickable:hover {
  background: var(--bg-hover);
}
```

### Theme Variable Usage

```css
/* Use semantic color names */
.error-message {
  color: var(--text-error);
  background: var(--bg-error);
  border: 1px solid var(--border-error);
}

/* Use spacing from design system */
.form-field {
  margin-bottom: var(--form-item-margin);
}

.form-field label {
  margin-bottom: var(--form-label-margin);
}
```

This architecture provides consistency, maintainability, and excellent performance while supporting Scout's advanced theming system.
