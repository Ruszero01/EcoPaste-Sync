import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
	plugins: [
		react(),
		UnoCSS(),
		AutoImport({
			imports: ["react", "ahooks", "react-router-dom", "react-i18next"],
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
	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 3000,
		strictPort: true,
		host: host || "localhost",
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 3001,
				}
			: undefined,
		watch: {
			// 3. tell vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
	build: {
		chunkSizeWarningLimit: 3000,
		rollupOptions: {
			output: {
				manualChunks: {
					// 将 Tauri 相关的 API 分离到单独的 chunk
					tauri: [
						"@tauri-apps/api/core",
						"@tauri-apps/plugin-dialog",
						"@tauri-apps/plugin-fs",
						"@tauri-apps/plugin-log",
						"@tauri-apps/plugin-opener",
						"@tauri-apps/plugin-os",
						"@tauri-apps/plugin-process",
						"@tauri-apps/plugin-sql",
					],

					// 将 WebDAV 相关的 API 分离到单独的 chunk
					webdav: ["@/plugins/webdav"],

					// 将工具函数分离到单独的 chunk
					utils: [
						"@/utils/store",
						"@/utils/path",
						"@/utils/is",
						"@/utils/autoSync",
						"@/utils/configSync",
						"@/utils/syncEngine",
						"@/utils/localDataManager",
						"@/utils/fileSyncManager",
						"@/utils/bookmarkManager",
						"@/utils/cloudDataManager",
					],

					// 将组件 hooks 分离到单独的 chunk
					hooks: ["@/hooks/useWindowState", "@/hooks/useTray"],

					// 将数据库相关分离到单独的 chunk
					database: ["@/database"],

					// 将常量分离到单独的 chunk
					constants: ["@/constants"],
				},
			},
		},
	},
	css: {
		preprocessorOptions: {
			scss: {
				// https://sass-lang.com/documentation/breaking-changes/legacy-js-api/#silencing-warnings
				silenceDeprecations: ["legacy-js-api"],
			},
		},
	},
}));
