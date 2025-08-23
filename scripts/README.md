# Scout Development Scripts

## Running Multiple Dev Instances

You can run multiple Scout instances on different ports for testing different branches simultaneously.

### Available Scripts

```bash
# Default port (5173)
pnpm tauri dev

# Run on port 1425
pnpm tauri:dev:1425

# Run on port 1430
pnpm tauri:dev:1430
```

### How it Works

1. The `dev-multiport.js` script:
   - Sets `VITE_PORT` and `VITE_HMR_PORT` environment variables
   - Temporarily modifies `tauri.conf.json` to use the specified port
   - Restores the original config on exit

2. The Vite config reads the port from environment variables:
   - `VITE_PORT` - Main dev server port (default: 5173)
   - `VITE_HMR_PORT` - Hot Module Replacement port (default: VITE_PORT + 1)

### Example: Running Two Branches

Terminal 1 (main branch):
```bash
git checkout main
pnpm tauri:dev:1425
```

Terminal 2 (feature branch):
```bash
git checkout feature-branch
pnpm tauri:dev:1430
```

Both instances will run independently on different ports!