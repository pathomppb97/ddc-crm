import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import createHtmlPlugin from "vite-plugin-simple-html";

export default defineConfig({
  server: { port: 5174 },
  plugins: [
    react(),
    tailwindcss(),
    createHtmlPlugin({
      minify: true,
      inject: {
        data: {
          mainScript: "demo/main.tsx",
        },
      },
    }),
  ],
  define: {
    "import.meta.env.VITE_LAN_ACCOUNTS": JSON.stringify("false"),
    "import.meta.env.VITE_IS_DEMO": JSON.stringify("true"),
    "import.meta.env.VITE_ENABLE_ERP": JSON.stringify("false"),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "https://demo.example.org",
    ),
    "import.meta.env.VITE_SB_PUBLISHABLE_KEY":
      JSON.stringify("public-demo-unused"),
  },
  base: "./",
  build: {
    rolldownOptions: {
      output: {
        keepNames: true,
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
    dedupe: ["react-router", "react-router-dom"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
