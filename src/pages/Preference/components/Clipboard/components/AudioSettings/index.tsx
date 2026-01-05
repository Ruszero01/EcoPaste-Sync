import ProList from "@/components/ProList";
import ProSwitch from "@/components/ProSwitch";
import UnoIcon from "@/components/UnoIcon";
import { clipboardStore } from "@/stores/clipboard";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";

const AudioSettings = () => {
	const { audio } = useSnapshot(clipboardStore);
	const { t } = useTranslation();

	// 调用后端播放音效
	const handlePreview = async () => {
		await invoke("plugin:eco-clipboard|preview_audio");
	};

	return (
		<ProList header={t("preference.clipboard.audio_settings.title")}>
			<ProSwitch
				onChange={(value) => {
					clipboardStore.audio.copy = value;
				}}
				title={t("preference.clipboard.audio_settings.label.copy_audio")}
				value={audio.copy}
			>
				<UnoIcon
					className="flex!"
					hoverable
					name="i-iconamoon:volume-up-light"
					onClick={handlePreview}
					size={22}
				/>
			</ProSwitch>
		</ProList>
	);
};

export default AudioSettings;
