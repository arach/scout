# Scout Landing Page

A modern, responsive landing page for Scout built with Next.js 15, React, TailwindCSS, and shadcn/ui.

## Features

- ⚡ Next.js 15 with App Router
- 🎨 TailwindCSS for styling
- 🧩 shadcn/ui components
- 📱 Fully responsive design
- 🌙 Dark mode optimized
- 🚀 Static export ready
- 🔍 SEO optimized

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm start
```

## Deployment

The site is configured for static export and can be deployed to any static hosting service:

### GitHub Pages (Automatic)
The repository includes a GitHub Actions workflow that automatically deploys to GitHub Pages when you push to the main branch. 

To enable:
1. Go to Settings → Pages in your GitHub repository
2. Under "Source", select "GitHub Actions"
3. Push to main branch or manually trigger the workflow

### GitHub Pages (Manual)
```bash
pnpm deploy:gh-pages
# Then push the `out` directory to the `gh-pages` branch
```

### Vercel
```bash
vercel
```

### Netlify
```bash
netlify deploy
```

## Structure

```
landing/
├── app/
│   ├── globals.css      # Global styles and Tailwind config
│   ├── layout.tsx       # Root layout with metadata
│   └── page.tsx         # Home page component
├── components/
│   └── ui/              # shadcn/ui components
│       ├── badge.tsx
│       ├── button.tsx
│       └── card.tsx
├── lib/
│   └── utils.ts         # Utility functions
└── public/              # Static assets
    ├── favicon.ico
    └── scout-logo.png
```

## Customization

- Update colors in `app/globals.css`
- Modify content in `app/page.tsx`
- Add new pages in the `app` directory
- Install additional shadcn/ui components as needed

## License

Same as Scout main project.