import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
    allowedHosts: true, // Cloudflare 터널 등 외부 호스트로 데모 공유용
  },
})
