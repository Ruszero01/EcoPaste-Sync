import ProList from "@/components/ProList";
import ProSwitch from "@/components/ProSwitch";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useSnapshot } from "valtio";
import Language from "./components/Language";
import MacosPermissions from "./components/MacosPermissions";
import RowHeight from "./components/RowHeight";
import ThemeMode from "./components/ThemeMode";
import WindowBehavior from "./components/WindowBehavior";

const General = () => {
	const { app } = useSnapshot(globalStore);
	const { t } = useTranslation();

	// 监听自动启动变更
	useImmediateKey(globalStore.app, "autoStart", async (value) => {
		const enabled = await isEnabled();

		if (value && !enabled) {
			return enable();
		}

		if (!value && enabled) {
			disable();
		}
	});

	return (
		<>
			<MacosPermissions />

			<ProList header={t("preference.settings.app_settings.title")}>
				<ProSwitch
					title={t("preference.settings.app_settings.label.auto_start")}
					value={app.autoStart}
					onChange={(value) => {
						globalStore.app.autoStart = value;
					}}
				/>

				<ProSwitch
					title={t("preference.settings.app_settings.label.show_menubar_icon")}
					value={app.showMenubarIcon}
					onChange={(value) => {
						globalStore.app.showMenubarIcon = value;
					}}
				/>

				<ProSwitch
					title={t("preference.settings.app_settings.label.show_taskbar_icon")}
					value={app.showTaskbarIcon}
					onChange={(value) => {
						globalStore.app.showTaskbarIcon = value;
					}}
				/>
			</ProList>

			<WindowBehavior />

			<ProList header={t("preference.settings.appearance_settings.title")}>
				<Language />

				<ThemeMode />

				<RowHeight />
			</ProList>

			{/* 更新设置已隐藏 - fork分支不需要这些设置
			<ProList header={t("preference.settings.update_settings.title")}>
				<ProSwitch
					title={t("preference.settings.update_settings.label.auto_update")}
					value={update.auto}
					onChange={(value) => {
						globalStore.update.auto = value;
					}}
				/>

				<ProSwitch
					title={t("preference.settings.update_settings.label.update_beta")}
					description={t(
						"preference.settings.update_settings.hints.update_beta",
					)}
					value={update.beta}
					onChange={(value) => {
						globalStore.update.beta = value;
					}}
				/>
			</ProList>
			*/}
		</>
	);
};

export default General;
