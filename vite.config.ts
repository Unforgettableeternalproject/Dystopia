import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Tauri 在開發時需要固定 port
  server: {
    port: 5173,
    strictPort: true,
  },
  // 防止 Vite 遮蔽 Tauri 的 OS-specific API
  envPrefix: ['VITE_', 'TAURI_'],
});
