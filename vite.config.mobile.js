import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Mobile build config for Capacitor.
// Outputs to www/ which Capacitor copies into android/ and ios/ via `npx cap sync`.
export default defineConfig({
  plugins: [react()],
  root: 'src',
  build: {
    outDir: resolve(__dirname, 'www'),
    emptyOutDir: true,
  },
})
