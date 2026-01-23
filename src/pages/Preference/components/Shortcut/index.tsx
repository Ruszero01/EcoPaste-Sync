import ProList from "@/components/ProList";
import ProShortcut from "@/components/ProShortcut";
import { useShortcutSubscription } from "@/hooks/useShortcutSubscription";
import { useSnapshot } from "valtio";
import Blacklist from "./components/Blacklist";
import Preset from "./components/Preset";
import QuickPaste from "./components/QuickPaste";

const Shortcut = () => {
	const { shortcut } = useSnapshot(globalStore);
	const { t } = useTranslation();

	// 监听快捷键配置变化，自动重新注册
	useShortcutSubscription();

	return (
		<>
			<ProList header={t("preference.shortcut.shortcut.title")}>
				<ProShortcut
					title={t("preference.shortcut.shortcut.label.open_clipboard")}
					value={shortcut.clipboard}
					onChange={(value) => {
						globalStore.shortcut.clipboard = value;
					}}
				/>

				<ProShortcut
					title={t("preference.shortcut.shortcut.label.open_settings")}
					value={shortcut.preference}
					onChange={(value) => {
						globalStore.shortcut.preference = value;
					}}
				/>

				<QuickPaste />

				<ProShortcut
					isSystem={true}
					title={t("preference.shortcut.shortcut.label.paste_as_plain")}
					description={t("preference.shortcut.shortcut.hints.paste_as_plain")}
					value={shortcut.pastePlain}
					onChange={(value) => {
						globalStore.shortcut.pastePlain = value;
					}}
				/>
			</ProList>

			<Preset />

			<div className="mt-4">
				<Blacklist />
			</div>
		</>
	);
};

export default Shortcut;
