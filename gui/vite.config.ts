import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // API_PORT matches the server's PORT when a second checkout runs on other ports.
      "/api": `http://localhost:${process.env.API_PORT ?? 3001}`,
    },
  },
});
