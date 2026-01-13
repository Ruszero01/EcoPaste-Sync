import { LISTEN_KEY } from "@/constants";
import type { Language, Store } from "@/types/store";
import { getName, getVersion } from "@tauri-apps/api/app";
import { emit } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";
import {
	exists,
	mkdir,
	readTextFile,
	writeTextFile,
} from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { omit } from "lodash-es";
import { getLocale } from "tauri-plugin-locale-api";

/**
 * 初始化数据库插件 - 独立函数，可以单独调用
 * 注意：现在数据库插件会在后端自动初始化，这里仅作兼容性保留
 */
const initDatabasePlugin = async () => {
	// 数据库插件现在会在后端自动初始化，无需前端手动调用
	// 这里保留函数是为了兼容性，实际不需要做任何事情
	return true;
};

/**
 * 初始化配置项
 */
const initStore = async () => {
	// 首先初始化数据库插件 - 确保环境变量已设置
	await initDatabasePlugin();

	globalStore.appearance.language ??= await getLocale<Language>();
	globalStore.env.platform = platform();
	globalStore.env.appName = await getName();
	globalStore.env.appVersion = await getVersion();
	globalStore.env.saveDataDir ??= await appDataDir();

	await mkdir(globalStore.env.saveDataDir, { recursive: true });
};

/**
 * 本地存储配置项
 * @param backup 是否为备份数据
 */
export const saveStore = async (backup = false) => {
	const store = { globalStore, clipboardStore };

	const path = await getSaveStorePath(backup);

	await writeTextFile(path, JSON.stringify(store, null, 2));

	// 通知后端和其他窗口配置已变更
	await emit(LISTEN_KEY.STORE_CHANGED, store);
};

// 导出数据库初始化函数，供外部调用
export { initDatabasePlugin };

/**
 * 从本地存储恢复配置项
 * @param backup 是否为备份数据
 */
export const restoreStore = async (backup = false) => {
	const path = await getSaveStorePath(backup);

	const existed = await exists(path);

	if (existed) {
		const content = await readTextFile(path);
		const store: Store = JSON.parse(content);
		const nextGlobalStore = omit(store.globalStore, backup ? "env" : "");

		deepAssign(globalStore, nextGlobalStore);
		deepAssign(clipboardStore, store.clipboardStore);
	}

	if (backup) return;

	return initStore();
};
