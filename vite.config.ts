import { defineConfig } from 'vite';

// Version shown in problem reports: the Git commit Vercel builds from (or "dev" locally).
const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev';
export default defineConfig({
  define: { __BUILD__: JSON.stringify(`${sha} (${new Date().toISOString().slice(0, 10)})`) },
});
