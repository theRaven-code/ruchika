import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react(), command === 'serve' ? basicSsl() : null],
  server: {
    host: true,
  },
}))
