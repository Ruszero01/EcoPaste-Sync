/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		react(),
		UnoCSS(),
		AutoImport({
			imports: [
				"vitest",
				"react",
				"ahooks",
				"react-router-dom",
				"react-i18next",
			],
			dts: "src/types/auto-imports.d.ts",
			dirs: [
				"src/router",
				"src/utils",
				"src/stores",
				"src/database",
				"src/hooks",
				"src/constants",
				"src/plugins",
				"src/locales",
			],
		}),
	],
	resolve: {
		alias: {
			"@": "/src",
		},
	},
	test: {
		environment: "happy-dom",
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		exclude: ["node_modules/**", "dist/**", ".git/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["src/**"],
			exclude: [
				"src/**/*.d.ts",
				"src/**/*.test.ts",
				"src/**/*.spec.ts",
				"src/types/**",
				"src/main.tsx",
				"src/App.tsx",
			],
		},
	},
});
