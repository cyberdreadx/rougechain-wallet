import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const sharedResolve = {
    alias: {
        "@": path.resolve(__dirname, "./src"),
    },
};

const mainConfig: UserConfig = {
    plugins: [react()],
    resolve: sharedResolve,
    build: {
        outDir: "dist",
        sourcemap: false,
        minify: "esbuild",
        emptyOutDir: true,
        modulePreload: false,
        rollupOptions: {
            input: {
                popup: path.resolve(__dirname, "popup.html"),
                approval: path.resolve(__dirname, "approval.html"),
                content: path.resolve(__dirname, "src/content/inject.ts"),
                provider: path.resolve(__dirname, "src/content/provider.ts"),
            },
            output: {
                entryFileNames: (chunkInfo) => {
                    if (chunkInfo.name === "content") return "content.js";
                    if (chunkInfo.name === "provider") return "provider.js";
                    return "assets/[name]-[hash].js";
                },
            },
        },
    },
};

export default defineConfig(({ mode }) => {
    if (mode === "sw") {
        return {
            resolve: sharedResolve,
            build: {
                outDir: "dist",
                sourcemap: false,
                minify: "esbuild",
                emptyOutDir: false,
                modulePreload: false,
                rollupOptions: {
                    input: {
                        "service-worker": path.resolve(__dirname, "src/background/service-worker.ts"),
                    },
                    output: {
                        inlineDynamicImports: true,
                        entryFileNames: "service-worker.js",
                    },
                },
            },
        };
    }
    return mainConfig;
});
