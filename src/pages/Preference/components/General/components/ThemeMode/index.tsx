import ProSelect from "@/components/ProSelect";
import type { Theme } from "@/types/store";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSnapshot } from "valtio";

interface Option {
	label: string;
	value: Theme;
}

const ThemeMode = () => {
	const { appearance } = useSnapshot(globalStore);
	const { t } = useTranslation();

	// TODO: mica 效果在新版 webview 上存在 BUG，暂时禁用
	// useMount(() => {
	// 	// 监听系统主题的变化
	// 	appWindow.onThemeChanged(async ({ payload }) => {
	// 		if (globalStore.appearance.theme !== "auto") return;
	//
	// 		globalStore.appearance.isDark = payload === "dark";
	//
	// 		// 更新 Mica 主题
	// 		updateMicaTheme(payload === "dark");
	// 	});
	// });

	// useImmediateKey(globalStore.appearance, "theme", async (value) => {
	// 	// Tauri的setTheme方法：auto模式需要传null，非auto模式传Theme值
	// 	const themeToSet = value === "auto" ? null : (value as Theme);
	//
	// 	await (appWindow.setTheme as any)(themeToSet);
	//
	// 	const actualTheme = await appWindow.theme();
	// 	const isDark = actualTheme === "dark";
	// 	globalStore.appearance.isDark = isDark;
	//
	// 	// 更新 Mica 主题
	// 	updateMicaTheme(isDark);
	// });

	const options: Option[] = [
		{
			label: t("preference.settings.appearance_settings.label.theme_auto"),
			value: "auto",
		},
		{
			label: t("preference.settings.appearance_settings.label.theme_light"),
			value: "light",
		},
		{
			label: t("preference.settings.appearance_settings.label.theme_dark"),
			value: "dark",
		},
	];

	return (
		<ProSelect
			title={t("preference.settings.appearance_settings.label.theme")}
			value={appearance.theme}
			options={options}
			onChange={async (value) => {
				globalStore.appearance.theme = value;

				// 设置窗口主题
				try {
					const appWindow = getCurrentWebviewWindow();
					const themeToSet = value === "auto" ? null : value;
					await (appWindow as any).setTheme?.(themeToSet);
				} catch {
					// 忽略错误，某些平台可能不支持
				}

				// 同步更新 isDark
				if (value === "light") {
					globalStore.appearance.isDark = false;
				} else if (value === "dark") {
					globalStore.appearance.isDark = true;
				} else if (value === "auto") {
					// 获取系统主题
					try {
						const appWindow = getCurrentWebviewWindow();
						const actualTheme = await appWindow.theme();
						globalStore.appearance.isDark = actualTheme === "dark";
					} catch {
						// 默认使用浅色
						globalStore.appearance.isDark = false;
					}
				}
			}}
		/>
	);
};

export default ThemeMode;
