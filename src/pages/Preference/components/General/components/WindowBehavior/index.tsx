import AdaptiveSelect from "@/components/AdaptiveSelect";
import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import type { WindowBehaviorMode } from "@/types/store";
import { saveStore } from "@/utils/store";
import { Radio, Typography } from "antd";
import { useSnapshot } from "valtio";

const { Text } = Typography;

interface WindowBehaviorOption {
	label: string;
	value: WindowBehaviorMode;
	description: string;
}

const WindowBehavior = () => {
	const { app } = useSnapshot(globalStore);
	const { t } = useTranslation();

	// 监听窗口行为设置变化，自动保存配置
	useImmediateKey(globalStore.app, "windowBehavior", async () => {
		await saveStore();
	});

	const options: WindowBehaviorOption[] = [
		{
			label: t(
				"preference.settings.app_settings.label.window_behavior_lightweight",
			),
			value: "lightweight",
			description: t(
				"preference.settings.app_settings.hints.window_behavior_lightweight",
			),
		},
		{
			label: t(
				"preference.settings.app_settings.label.window_behavior_resident",
			),
			value: "resident",
			description: t(
				"preference.settings.app_settings.hints.window_behavior_resident",
			),
		},
		{
			label: t(
				"preference.settings.app_settings.label.window_behavior_auto_recycle",
			),
			value: "auto_recycle",
			description: t(
				"preference.settings.app_settings.hints.window_behavior_auto_recycle",
			),
		},
	];

	const delayOptions = [
		{
			value: 30,
			label: t("preference.settings.app_settings.label.window_behavior_30s"),
		},
		{
			value: 60,
			label: t("preference.settings.app_settings.label.window_behavior_1min"),
		},
		{
			value: 180,
			label: t("preference.settings.app_settings.label.window_behavior_3min"),
		},
		{
			value: 300,
			label: t("preference.settings.app_settings.label.window_behavior_5min"),
		},
	];

	return (
		<ProList
			header={t("preference.settings.app_settings.label.window_behavior_mode")}
		>
			<Radio.Group
				value={app.windowBehavior.mode}
				onChange={(e) => {
					globalStore.app.windowBehavior.mode = e.target.value;
				}}
				style={{ width: "100%" }}
			>
				{options.map((option) => (
					<ProListItem
						key={option.value}
						title={
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<Radio value={option.value} />
								<Text>{option.label}</Text>
							</div>
						}
						description={
							<Text type="secondary" style={{ fontSize: 12 }}>
								{option.description}
							</Text>
						}
					>
						{option.value === "auto_recycle" &&
							app.windowBehavior.mode === "auto_recycle" && (
								<AdaptiveSelect
									value={app.windowBehavior.recycleDelaySeconds}
									options={delayOptions}
									onChange={(value) => {
										globalStore.app.windowBehavior.recycleDelaySeconds = value;
									}}
								/>
							)}
					</ProListItem>
				))}
			</Radio.Group>
		</ProList>
	);
};

export default WindowBehavior;
