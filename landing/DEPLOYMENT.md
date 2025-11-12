# Deployment Guide for openscout.app

## GitHub Pages Setup

This site is configured to deploy to GitHub Pages with the custom domain `openscout.app`.

### Prerequisites

1. Repository must be public or you need GitHub Pro for private repos with Pages
2. GitHub Pages must be enabled in repository settings
3. DNS must be configured for openscout.app

### DNS Configuration

Configure your DNS records at your domain registrar:

```
Type: A
Host: @
Value: 185.199.108.153
       185.199.109.153
       185.199.110.153
       185.199.111.153

Type: CNAME
Host: www
Value: <your-github-username>.github.io
```

### GitHub Repository Settings

1. Go to repository Settings → Pages
2. Source: GitHub Actions
3. Custom domain: openscout.app
4. Enforce HTTPS: ✓ (enable after DNS propagates)

### Deployment

The site automatically deploys when you push to the `main` or `master` branch.

#### Manual Deployment

```bash
# Build the site
pnpm run build

# The build outputs to ./out directory
# Deploy manually by pushing to gh-pages branch
pnpm run deploy:gh-pages
```

#### Automatic Deployment

The GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:
1. Builds the site on every push to main/master
2. Creates the .nojekyll file
3. Creates the CNAME file with openscout.app
4. Deploys to GitHub Pages

### Verify Deployment

After deployment:
1. Check https://openscout.app (may take a few minutes for DNS)
2. Verify HTTPS certificate is issued
3. Check that all assets load correctly
4. Test all pages and links

### Troubleshooting

**DNS not resolving:**
- DNS propagation can take 24-48 hours
- Check with `dig openscout.app` or `nslookup openscout.app`

**404 errors:**
- Ensure GitHub Pages is enabled
- Check that CNAME file exists in the deployed site
- Verify the repository name matches expectations

**Build failures:**
- Check GitHub Actions logs
- Verify pnpm-lock.yaml is committed
- Ensure all dependencies are listed in package.json

**HTTPS not available:**
- Wait for DNS to fully propagate
- GitHub needs to verify domain ownership first
- Can take up to 24 hours for certificate issuance
