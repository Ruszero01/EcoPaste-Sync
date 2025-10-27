import { SYNC_MODE_PRESETS } from "@/types/sync.d";
import type { SyncMode, SyncModeConfig } from "@/types/sync.d";
import { Card, Flex, List, Radio, Space, Tag, Typography } from "antd";
import type { ChangeEvent } from "react";

const { Text } = Typography;

interface SyncModeSelectorProps {
	value: SyncModeConfig;
	onChange: (config: SyncModeConfig) => void;
	disabled?: boolean;
}

const SyncModeSelector = ({
	value,
	onChange,
	disabled = false,
}: SyncModeSelectorProps) => {
	// 防御性检查
	if (!value || !value.mode) {
		console.error("SyncModeSelector: 无效的配置值", value);
		return null;
	}

	// 获取模式描述
	const getModeDescription = (mode: SyncMode): string => {
		switch (mode) {
			case "lightweight":
				return "轻量模式：同步文本、HTML、富文本等（不含图片和文件）";
			case "full":
				return "全量模式：同步所有内容（图片≤5MB，文件≤10MB）";
			case "favorites":
				return "收藏模式：仅同步收藏内容（图片≤5MB，文件≤10MB）";
			default:
				return "";
		}
	};

	// 获取模式颜色配置
	const getModeConfig = (mode: SyncMode) => {
		switch (mode) {
			case "lightweight":
				return {
					color: "#1890ff",
					bgColor: "#f0f9ff",
					borderColor: "#1890ff",
					icon: "📝",
					tag: "推荐",
					tagColor: "blue",
				};
			case "full":
				return {
					color: "#fa8c16",
					bgColor: "#fff7e6",
					borderColor: "#fa8c16",
					icon: "🌐",
					tag: "完整",
					tagColor: "orange",
				};
			case "favorites":
				return {
					color: "#52c41a",
					bgColor: "#f6ffed",
					borderColor: "#52c41a",
					icon: "⭐",
					tag: "精选",
					tagColor: "green",
				};
		}
	};

	// 获取模式详细内容说明
	const getModeContent = (mode: SyncMode) => {
		switch (mode) {
			case "lightweight":
				return (
					<Space direction="vertical" size={2}>
						<Text style={{ fontSize: "11px", color: "#0958d9" }}>
							✅ 包含：纯文本、代码片段、网页内容、格式化文本
						</Text>
						<Text style={{ fontSize: "11px", color: "#8c8c8c" }}>
							❌ 不包含：图片、文件附件（避免大文件传输）
						</Text>
					</Space>
				);
			case "full":
				return (
					<Space direction="vertical" size={2}>
						<Text style={{ fontSize: "11px", color: "#d46b08" }}>
							✅ 包含：所有类型的内容
						</Text>
						<Text style={{ fontSize: "11px", color: "#d46b08" }}>
							📏 文件限制：图片 ≤ 5MB，文件 ≤ 10MB，单次同步 ≤ 50MB
						</Text>
						<Text style={{ fontSize: "11px", color: "#8c8c8c" }}>
							💡 提示：大文件将被过滤，不会同步
						</Text>
					</Space>
				);
			case "favorites":
				return (
					<Space direction="vertical" size={2}>
						<Text style={{ fontSize: "11px", color: "#0958d9" }}>
							✅ 包含：已收藏的所有类型内容
						</Text>
						<Text style={{ fontSize: "11px", color: "#0958d9" }}>
							📏 文件限制：图片 ≤ 5MB，文件 ≤ 10MB
						</Text>
						<Text style={{ fontSize: "11px", color: "#8c8c8c" }}>
							💡 提示：只同步重要内容，减少存储占用
						</Text>
					</Space>
				);
		}
	};

	// 处理模式变更
	const handleModeChange = (e: ChangeEvent<HTMLInputElement>) => {
		const mode = e.target.value as SyncMode;
		const newConfig = SYNC_MODE_PRESETS[mode];
		onChange(newConfig);
	};

	const currentMode = value.mode;
	const _modeConfig = getModeConfig(currentMode);

	return (
		<List.Item>
			<List.Item.Meta
				title="同步模式"
				description="选择适合您使用需求的同步策略"
			/>
			<Radio.Group
				value={currentMode}
				onChange={handleModeChange}
				disabled={disabled}
				size="small"
			>
				<Space direction="vertical" style={{ width: "100%" }}>
					{(["lightweight", "full", "favorites"] as SyncMode[]).map((mode) => {
						const config = getModeConfig(mode);
						const isSelected = currentMode === mode;

						return (
							<Radio key={mode} value={mode} style={{ width: "100%" }}>
								<Card
									size="small"
									style={{
										backgroundColor: isSelected ? config.bgColor : "#fafafa",
										border: isSelected
											? `1px solid ${config.borderColor}`
											: "1px solid #d9d9d9",
										marginBottom: isSelected ? "0" : "8px",
									}}
								>
									<Flex align="center" gap="8px">
										<Text strong style={{ color: config.color }}>
											{config.icon}{" "}
											{mode === "lightweight"
												? "轻量模式"
												: mode === "full"
													? "全量模式"
													: "收藏模式"}
										</Text>
										<Tag color={config.tagColor} size="small">
											{config.tag}
										</Tag>
										<Text
											type="secondary"
											style={{ fontSize: "12px", flex: 1 }}
										>
											{getModeDescription(mode)}
										</Text>
									</Flex>

									{isSelected && (
										<div
											style={{
												marginTop: "8px",
												padding: "4px 8px",
												backgroundColor:
													mode === "full" ? "#fff2e8" : "#f0f9ff",
												borderRadius: "4px",
											}}
										>
											{getModeContent(mode)}
										</div>
									)}
								</Card>
							</Radio>
						);
					})}
				</Space>
			</Radio.Group>
		</List.Item>
	);
};

export default SyncModeSelector;
