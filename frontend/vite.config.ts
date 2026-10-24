import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Read from frontend/.env (see .env.example); the API_PROXY_TARGET name has no VITE_ prefix on
  // purpose: it is only used here, in Node, and must not end up in the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://localhost:3000';

  return {
    // Lets `@/x` mean `src/x` and `@contract/x` mean the server's `src/contract/x`, as the "paths" in
    // tsconfig.json say (vitest.config.ts needs the same line).
    resolve: { tsconfigPaths: true },
    plugins: [
      // The router plugin has to come before the React plugin. It generates src/routeTree.gen.ts
      // from the files in src/routes (commit that file).
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    server: {
      // The server's mails link to http://localhost:5173/... (EMAIL_VERIFICATION_URL and
      // PASSWORD_RESET_URL). Without strictPort Vite would quietly move to 5174 when 5173 is taken
      // and those links would open the wrong page.
      port: 5173,
      strictPort: true,
      proxy: {
        // The browser only talks to this dev server, so the session cookie is first-party and no
        // CORS setup is needed. The API's paths all start with /api (/api/account, /api/chat,
        // /api/friend), which keeps them from colliding with the app's own pages (/chat/:chatId, ...),
        // and they are forwarded to the server unchanged.
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Added with the Socket.io milestone:
        // '/socket.io': { target: apiTarget, ws: true },
      },
    },
  };
});
