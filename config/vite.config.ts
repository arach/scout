import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { analyzer } from 'vite-bundle-analyzer';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => {
  // @ts-expect-error process is a nodejs global
  const isAnalyzing = process.env.ANALYZE === 'true';
  
  return {
    plugins: [
      react(),
      // Add bundle analyzer when ANALYZE=true
      ...(isAnalyzing ? [analyzer({ 
        analyzerMode: 'server',
        openAnalyzer: true,
        reportFilename: 'bundle-analysis.html'
      })] : [])
    ],
    
    // CSS configuration
    css: {
      // Use PostCSS for processing if config exists
      postcss: './config/postcss.config.js',
      modules: {
        // Enable CSS modules for .module.css files
        localsConvention: 'camelCase',
        generateScopedName: isAnalyzing ? '[name]__[local]___[hash:base64:5]' : '[hash:base64:8]'
      }
    },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Configure entry points
  build: {
    // Enable minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console logs in production
        drop_debugger: true,
      },
    },
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "../index.html"),
      },
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'tauri-vendor': ['@tauri-apps/api'],
          'ui-vendor': ['lucide-react', '@radix-ui/react-select'],
          'audio-vendor': ['wavesurfer.js', '@wavesurfer/react'],
        },
        // CSS code splitting
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    // Enable source maps for production debugging
    sourcemap: false, // Set to true if you need production debugging
  },
  };
});
