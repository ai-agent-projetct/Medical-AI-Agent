import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    // The Flutter app lives in mobile_app/; its build output churns and locks files on Windows.
    watch: { ignored: ['**/mobile_app/**'] },
  },
})
