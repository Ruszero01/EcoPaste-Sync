import ProSelect from "@/components/ProSelect";
import { updateMicaTheme } from "@/plugins/window";
import type { Theme } from "@/types/store";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSnapshot } from "valtio";

interface Option {
	label: string;
	value: Theme;
}

const appWindow = getCurrentWebviewWindow();

const ThemeMode = () => {
	const { appearance } = useSnapshot(globalStore);
	const { t } = useTranslation();

	useMount(() => {
		// 监听系统主题的变化
		appWindow.onThemeChanged(async ({ payload }) => {
			if (globalStore.appearance.theme !== "auto") return;

			globalStore.appearance.isDark = payload === "dark";

			// 更新 Mica 主题
			updateMicaTheme(payload === "dark");
		});
	});

	useImmediateKey(globalStore.appearance, "theme", async (value) => {
		// Tauri的setTheme方法：auto模式需要传null，非auto模式传Theme值
		const themeToSet = value === "auto" ? null : (value as Theme);

		await (appWindow.setTheme as any)(themeToSet);

		const actualTheme = await appWindow.theme();
		const isDark = actualTheme === "dark";
		globalStore.appearance.isDark = isDark;

		// 更新 Mica 主题
		updateMicaTheme(isDark);
	});

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
			onChange={(value) => {
				globalStore.appearance.theme = value;
			}}
		/>
	);
};

export default ThemeMode;
