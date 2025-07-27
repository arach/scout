import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { analyzer } from 'vite-bundle-analyzer';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => {
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

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
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
        main: resolve(__dirname, "index.html"),
      },
      output: {
        // Enhanced manual chunk splitting for better caching
        manualChunks: {
          // React ecosystem
          'react-vendor': ['react', 'react-dom'],
          
          // Tauri and plugins
          'tauri-vendor': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-http',
            '@tauri-apps/plugin-opener'
          ],
          
          // UI libraries
          'ui-vendor': [
            '@base-ui-components/react',
            '@radix-ui/react-select',
            'lucide-react'
          ],
          
          // Audio/media libraries
          'media-vendor': [
            'wavesurfer.js',
            '@wavesurfer/react'
          ],
          
          // Text processing
          'text-vendor': [
            'marked',
            '@types/marked'
          ],
          
          // Large components that change less frequently
          'components-stable': (id) => {
            if (id.includes('/src/components/')) {
              // Group stable UI components that don't change often
              return ['TranscriptItem', 'TranscriptsView', 'SettingsView', 'RecordView']
                .some(component => id.includes(component));
            }
            return false;
          },
          
          // Contexts and providers
          'contexts': (id) => {
            return id.includes('/src/contexts/') || id.includes('/src/themes/');
          }
        },
        
        // Improve file naming for better caching
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? 
            chunkInfo.facadeModuleId.split('/').pop()?.replace('.tsx', '').replace('.ts', '') : 'chunk';
          return `assets/[name]-[hash].js`;
        },
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
    },
    // Enable source maps for production debugging
    sourcemap: false, // Set to true if you need production debugging
  },
  };
});
