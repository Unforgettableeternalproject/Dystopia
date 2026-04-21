import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Tauri 在開發時需要固定 port
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    fs: {
      // Allow serving lore data files (import.meta.glob targets)
      allow: ['src', 'lore'],
    },
  },
  // 防止 Vite 遮蔽 Tauri 的 OS-specific API
  envPrefix: ['VITE_', 'TAURI_'],
});
