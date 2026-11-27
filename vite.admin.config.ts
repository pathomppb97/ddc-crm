import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * Independent build configuration for the Enterprise Admin Control Center.
 * Outputs to ./dist-admin so CRM Web (./dist) and Admin deploy independently.
 */
export default defineConfig({
  root: path.resolve(import.meta.dirname, "apps/admin-control-center"),
  server: {
    port: 5179,
    host: true,
  },
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist-admin"),
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@ddc/shared-auth": path.resolve(
        import.meta.dirname,
        "packages/shared-auth/src/index.ts",
      ),
      "@ddc/shared-config": path.resolve(
        import.meta.dirname,
        "packages/shared-config/src/index.ts",
      ),
      "@ddc/shared-api": path.resolve(
        import.meta.dirname,
        "packages/shared-api/src/index.ts",
      ),
      "@ddc/shared-ui": path.resolve(
        import.meta.dirname,
        "packages/shared-ui/src/index.ts",
      ),
      "@ddc/shared-services": path.resolve(
        import.meta.dirname,
        "packages/shared-services/src/index.ts",
      ),
    },
  },
});
