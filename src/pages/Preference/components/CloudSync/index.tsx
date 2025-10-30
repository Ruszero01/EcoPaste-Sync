import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { LISTEN_KEY } from "@/constants";
import { clearHistoryTable, resetDatabase } from "@/database";
import {
	type WebDAVConfig,
	getServerConfig,
	setServerConfig,
	testConnection,
} from "@/plugins/webdav";
import { globalStore } from "@/stores/global";
import {
	SYNC_MODE_PRESETS,
	type SyncMode,
	type SyncModeConfig,
} from "@/types/sync.d";
import { isDev } from "@/utils/is";
import { type SyncInterval, realtimeSync } from "@/utils/realtimeSync";
import { syncEngine } from "@/utils/syncEngine";
import {
	CheckCircleOutlined,
	CloudOutlined,
	CloudSyncOutlined,
	DeleteOutlined,
	ScheduleOutlined,
} from "@ant-design/icons";
import { emit } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
	Alert,
	App,
	Button,
	Flex,
	Form,
	Input,
	InputNumber,
	Modal,
	Select,
	Switch,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { saveSyncModeConfig } from "./syncModeConfig";

const { Text } = Typography;

// 格式化同步时间显示
const formatSyncTime = (timestamp: number): string => {
	if (!timestamp || timestamp === 0) return "";

	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffMins < 1) {
		return "刚刚";
	}
	if (diffMins < 60) {
		return `${diffMins}分钟前`;
	}
	if (diffHours < 24) {
		return `${diffHours}小时前`;
	}
	if (diffDays < 7) {
		return `${diffDays}天前`;
	}
	return date.toLocaleDateString(); // 显示具体日期
};

const CloudSync = () => {
	// 安全获取消息 API 实例
	let appMessage: any;
	try {
		const app = App.useApp();
		appMessage = app.message;
	} catch (error) {
		// 如果 App.useApp() 失败，使用静态方法
		appMessage = {
			success: (content: string) => message.success(content),
			error: (content: string) => message.error(content),
			warning: (content: string) => message.warning(content),
			info: (content: string) => message.info(content),
			loading: (content: string) => message.loading(content),
		};
	}

	// 直接使用静态 Modal 方法（在 App context 中应该正常工作）
	const appModal = {
		confirm: (options: any) => Modal.confirm(options),
		info: (options: any) => Modal.info(options),
		success: (options: any) => Modal.success(options),
		error: (options: any) => Modal.error(options),
		warning: (options: any) => Modal.warning(options),
	};
	const { cloudSync: cloudSyncStore } = useSnapshot(globalStore);
	const [isConfigLoading, setIsConfigLoading] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<
		"idle" | "testing" | "success" | "failed"
	>("idle");
	const [isSyncing, setIsSyncing] = useState(false);
	const [lastSyncTime, setLastSyncTime] = useState<number>(0);
	const [intervalSyncEnabled, setIntervalSyncEnabled] = useState(false);
	const [syncInterval, setSyncInterval] = useState<SyncInterval>(1); // 默认1小时
	const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>({
		url: "",
		username: "",
		password: "",
		path: "/EcoPaste",
		timeout: 30000, // 设置默认超时时间30秒，不在前端显示
	});
	const [syncModeConfig, setSyncModeConfig] = useState<SyncModeConfig>(
		SYNC_MODE_PRESETS.lightweight,
	);
	const [favoritesModeEnabled, setFavoritesModeEnabled] = useState(false);
	const [form] = Form.useForm();

	// 保存上次同步时间到本地存储
	const saveLastSyncTime = useCallback((timestamp: number) => {
		try {
			localStorage.setItem("ecopaste-last-sync-time", timestamp.toString());
		} catch (error) {
			// 静默处理，避免控制台噪音
		}
	}, []);

	// 保存连接状态到本地存储
	const saveConnectionState = useCallback(
		async (status: "success" | "failed", config: WebDAVConfig) => {
			try {
				const configHash = btoa(JSON.stringify(config)).substring(0, 16);
				const connectionState = {
					status,
					timestamp: Date.now(),
					configHash,
				};
				localStorage.setItem(
					"ecopaste-connection-state",
					JSON.stringify(connectionState),
				);
			} catch (error) {
				// 静默处理，避免控制台噪音
			}
		},
		[],
	);

	// 验证连接状态并初始化同步引擎
	const validateConnectionStatus = useCallback(
		async (config: WebDAVConfig, showMessage = true) => {
			if (!config || !config.url || !config.username || !config.password) {
				return;
			}

			setConnectionStatus("testing");
			try {
				const result = await testConnection(config);
				if (result.success) {
					setConnectionStatus("success");

					// 持久化连接状态
					await saveConnectionState("success", config);

					// 初始化同步引擎
					await syncEngine.initialize(config);
					// 设置同步模式配置
					syncEngine.setSyncModeConfig(syncModeConfig);

					// 如果间隔同步已启用，重新初始化它
					if (intervalSyncEnabled) {
						realtimeSync.initialize({
							enabled: true,
							intervalHours: syncInterval,
							webdavConfig: config,
						});
					}

					if (showMessage) {
						appMessage.success("连接验证成功，云同步已就绪");
					}
				} else {
					setConnectionStatus("failed");
					await saveConnectionState("failed", config);

					if (showMessage) {
						appMessage.warning("连接失败，请检查网络或服务器配置");
					}
				}
			} catch (testError) {
				setConnectionStatus("failed");
				await saveConnectionState("failed", config);
				console.error("❌ 连接验证出现异常", {
					error:
						testError instanceof Error ? testError.message : String(testError),
				});

				if (showMessage) {
					appMessage.error("连接验证失败");
				}
			}
		},
		[intervalSyncEnabled, syncInterval, syncModeConfig, saveConnectionState],
	);

	// 加载同步模式配置
	const loadSyncMode = useCallback(() => {
		try {
			// 优先使用globalStore中的lightweightMode状态来生成配置
			const lightweightMode = cloudSyncStore.fileSync.lightweightMode;
			let config: SyncModeConfig;

			if (lightweightMode) {
				// 轻量模式：排除图片和文件
				config = SYNC_MODE_PRESETS.lightweight;
			} else {
				// 全量模式：包含所有类型
				config = SYNC_MODE_PRESETS.full;
			}

			// 检查当前组件状态中的收藏模式，而不是旧的syncModeConfig
			if (favoritesModeEnabled) {
				config = SYNC_MODE_PRESETS.favorites;
			}

			setSyncModeConfig(config);

			// 立即更新同步引擎配置（如果引擎已初始化）
			try {
				syncEngine.setSyncModeConfig(config);
			} catch (error) {
				// 同步引擎尚未初始化，配置将在引擎初始化后应用
			}
		} catch (error) {
			console.error("❌ 加载同步模式配置失败", error);
			// 发生错误时使用默认配置
			const defaultConfig = SYNC_MODE_PRESETS.lightweight;
			setSyncModeConfig(defaultConfig);
		}
	}, [cloudSyncStore.fileSync.lightweightMode, favoritesModeEnabled]);

	// 加载服务器配置
	const loadServerConfig = useCallback(async () => {
		try {
			const config = await getServerConfig();
			if (config && config.url) {
				setWebdavConfig(config);
				form.setFieldsValue(config);

				// 检查缓存的连接状态是否仍然有效
				const savedConnectionState = localStorage.getItem(
					"ecopaste-connection-state",
				);
				if (savedConnectionState) {
					try {
						const { status, timestamp, configHash } =
							JSON.parse(savedConnectionState);
						const currentTime = Date.now();
						const tenMinutes = 10 * 60 * 1000;

						// 检查缓存是否过期（10分钟）以及配置是否变化
						const currentConfigHash = btoa(JSON.stringify(config)).substring(
							0,
							16,
						);

						if (
							currentTime - timestamp < tenMinutes &&
							configHash === currentConfigHash &&
							status === "success"
						) {
							setConnectionStatus("success");

							// 如果之前连接成功，直接初始化同步引擎
							try {
								await syncEngine.initialize(config);
								// 设置同步模式配置
								syncEngine.setSyncModeConfig(syncModeConfig);
								if (intervalSyncEnabled) {
									realtimeSync.initialize({
										enabled: true,
										intervalHours: syncInterval,
										webdavConfig: config,
									});
								}
							} catch (_initError) {
								// 如果初始化失败，重新测试连接
								await validateConnectionStatus(config);
							}
						} else {
							setConnectionStatus("idle");
						}
					} catch (_parseError) {
						setConnectionStatus("idle");
					}
				} else {
					setConnectionStatus("idle");
				}
			} else {
				setConnectionStatus("idle");
			}
		} catch (error) {
			console.error("❌ 加载配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			setConnectionStatus("failed");
			appMessage.error("加载配置失败");
		} finally {
			setIsConfigLoading(false);
		}
	}, [
		syncModeConfig,
		intervalSyncEnabled,
		syncInterval,
		form,
		validateConnectionStatus,
	]);

	// 处理收藏模式开关变更
	const handleFavoritesModeChange = (enabled: boolean) => {
		try {
			const currentConfig = syncModeConfig;
			const newConfig = {
				...currentConfig,
				mode: (enabled ? "favorites" : "full") as SyncMode,
				settings: {
					...currentConfig.settings,
					onlyFavorites: enabled,
				},
			};

			setSyncModeConfig(newConfig);

			// 同时更新globalStore中的lightweightMode状态
			globalStore.cloudSync.fileSync.lightweightMode = enabled;

			const saved = saveSyncModeConfig(newConfig);
			if (saved) {
				appMessage.success(enabled ? "已启用收藏模式" : "已关闭收藏模式");
			} else {
				appMessage.error("保存配置失败");
			}
		} catch (error) {
			console.error("❌ 处理收藏模式变更失败", error);
			appMessage.error("更新配置失败");
		}
	};

	// 处理文件模式开关变更（新版本：文件模式 = 包含图片和文件）
	const handleFileModeChange = (enabled: boolean) => {
		try {
			// 检查是否真的需要变更（避免重复操作）
			const currentMode =
				syncModeConfig.settings.includeImages &&
				syncModeConfig.settings.includeFiles;
			if (currentMode === enabled) {
				return; // 状态未变化，直接返回
			}

			const currentConfig = syncModeConfig;
			const newConfig = {
				...currentConfig,
				settings: {
					...currentConfig.settings,
					includeImages: enabled,
					includeFiles: enabled,
				},
			};

			// 先更新globalStore状态（这样useEffect读取到的是最新值）
			globalStore.cloudSync.fileSync.lightweightMode = !enabled;

			const saved = saveSyncModeConfig(newConfig);
			if (saved) {
				// 最后才更新组件状态，避免触发多余的useEffect
				setSyncModeConfig(newConfig);
				appMessage.success(enabled ? "已启用文件模式" : "已关闭文件模式");
			} else {
				console.error("❌ 保存文件模式配置失败");
				appMessage.error("保存配置失败");
				// 回滚globalStore状态
				globalStore.cloudSync.fileSync.lightweightMode = enabled;
			}
		} catch (error) {
			console.error("❌ 处理文件模式变更失败", error);
			appMessage.error("更新配置失败");
		}
	};

	// 处理文件大小限制变更
	const handleMaxFileSizeChange = (value: number | null) => {
		if (value === null || value < 1) return;

		try {
			globalStore.cloudSync.fileSync.maxFileSize = value;
			appMessage.success(`文件大小限制已更新为 ${value}MB`);
		} catch (error) {
			console.error("❌ 处理文件大小限制变更失败", error);
			appMessage.error("更新配置失败");
		}
	};

	// 初始化时加载配置
	useEffect(() => {
		// 监听间隔同步完成事件
		const unlisten = listen(
			LISTEN_KEY.REALTIME_SYNC_COMPLETED,
			(event: any) => {
				if (event.payload?.type === "interval_sync") {
					const timestamp = event.payload.timestamp;
					setLastSyncTime(timestamp);
					saveLastSyncTime(timestamp); // 持久化保存
				}
			},
		);

		// 加载持久化的同步时间
		const savedLastSyncTime = localStorage.getItem("ecopaste-last-sync-time");
		if (savedLastSyncTime) {
			setLastSyncTime(Number.parseInt(savedLastSyncTime, 10));
		}

		// 加载配置
		loadServerConfig();
		loadSyncMode();

		// 清理函数
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [loadSyncMode, saveLastSyncTime, loadServerConfig]);

	// 更新同步引擎的同步模式配置（使用防抖优化）
	useEffect(() => {
		if (syncModeConfig) {
			const timeoutId = setTimeout(() => {
				syncEngine.setSyncModeConfig(syncModeConfig);
			}, 100); // 100ms 防抖，避免快速连续更新
			return () => clearTimeout(timeoutId);
		}
	}, [syncModeConfig]);

	// 同步配置到开关状态
	useEffect(() => {
		if (syncModeConfig) {
			setFavoritesModeEnabled(syncModeConfig.settings.onlyFavorites);
		}
	}, [syncModeConfig]);

	// 保存服务器配置
	const saveServerConfig = async (config: WebDAVConfig) => {
		try {
			await setServerConfig(config);
			console.log("WebDAV配置已保存", config);
			return true;
		} catch (error) {
			console.error("保存配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	// 测试WebDAV连接 - 简化版本：只测试连接，不进行持久化
	const testWebDAVConnection = async () => {
		setConnectionStatus("testing");
		try {
			const result = await testConnection(webdavConfig);
			if (result.success) {
				setConnectionStatus("success");
				appMessage.success("连接测试成功");
			} else {
				setConnectionStatus("failed");
				appMessage.error("连接测试失败");
			}
		} catch (error) {
			setConnectionStatus("failed");
			appMessage.error("连接测试异常");
		}
	};

	// 处理表单提交 - 优化版本：自动测试连接并持久化状态
	const handleConfigSubmit = async (values: any) => {
		setIsConfigLoading(true);
		try {
			// 确保包含默认超时时间
			const config: WebDAVConfig = {
				...values,
				timeout: 30000, // 设置默认30秒超时
			};

			setWebdavConfig(config);

			// 保存配置到本地
			const saved = await saveServerConfig(config);
			if (!saved) {
				appMessage.error("配置保存失败");
				return;
			}

			// 自动测试连接并初始化同步引擎
			await validateConnectionStatus(config);
		} catch (error) {
			setConnectionStatus("failed");
			appMessage.error("配置保存失败");
			console.error("❌ 配置处理失败", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsConfigLoading(false);
		}
	};

	// 立即同步处理函数
	const handleImmediateSync = async () => {
		if (isSyncing) {
			return;
		}

		if (connectionStatus !== "success") {
			appMessage.error("请先确保网络连接正常");
			return;
		}

		// 检查WebDAV配置是否有效
		if (!webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
			appMessage.error("WebDAV配置不完整，请先配置云同步");
			return;
		}

		setIsSyncing(true);

		try {
			// 确保同步引擎已初始化配置
			const configToPass = Object.assign({}, webdavConfig);

			await syncEngine.initialize(configToPass);

			// 构建包含文件大小限制的同步模式配置
			const enhancedSyncModeConfig = {
				...syncModeConfig,
				fileLimits: {
					maxPackageSize: cloudSyncStore.fileSync.maxFileSize,
				},
			};

			// 设置同步模式配置
			syncEngine.setSyncModeConfig(enhancedSyncModeConfig);

			// 双向智能同步
			const syncResult = await syncEngine.performBidirectionalSync();

			if (syncResult.success) {
				const timestamp = syncResult.timestamp;

				// 更新同步时间
				setLastSyncTime(timestamp);
				saveLastSyncTime(timestamp);

				// 显示成功消息 - 统一格式
				const totalCount = syncResult.downloaded + syncResult.uploaded;

				let successMessage;
				if (totalCount === 0) {
					successMessage = "无需同步";
				} else {
					successMessage = `已同步 ${totalCount} 条数据`;
				}

				appMessage.success(successMessage);

				// 触发界面刷新，确保列表显示最新数据
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (error) {
					// 静默处理刷新失败
				}
			} else {
				throw new Error("双向同步失败");
			}
		} catch (error) {
			console.error("❌ 同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			appMessage.error("同步出错，请查看控制台");
		} finally {
			setIsSyncing(false);
		}
	};

	// 处理间隔同步开关
	const handleIntervalSyncToggle = async (enabled: boolean) => {
		setIntervalSyncEnabled(enabled);
		try {
			if (enabled) {
				realtimeSync.initialize({
					enabled: true,
					intervalHours: syncInterval,
					webdavConfig,
				});
				console.log(`🔄 间隔同步已启用，间隔: ${syncInterval}小时`);
				appMessage.success(`间隔同步已启用，每${syncInterval}小时自动同步`);
			} else {
				realtimeSync.setEnabled(false);
				console.log("⏸️ 间隔同步已禁用");
				appMessage.info("间隔同步已禁用");
			}
		} catch (error) {
			console.error("间隔同步操作失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			appMessage.error("间隔同步操作失败");
		}
	};

	// 处理同步间隔变更
	const handleSyncIntervalChange = async (hours: SyncInterval) => {
		setSyncInterval(hours);
		if (intervalSyncEnabled) {
			try {
				realtimeSync.setIntervalHours(hours);
				console.log(`📊 同步间隔已更新: ${hours}小时`, { hours });
				appMessage.success(`同步间隔已更新为每${hours}小时`);
			} catch (error) {
				console.error("更新同步间隔失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				appMessage.error("更新同步间隔失败");
			}
		}
	};

	// 开发环境专用：数据库重置功能
	const handleClearHistory = async () => {
		Modal.confirm({
			title: "清空历史记录",
			content: "确定要清空所有剪贴板历史记录吗？此操作无法撤销。",
			okText: "确定",
			cancelText: "取消",
			okType: "danger",
			onOk: async () => {
				try {
					const success = await clearHistoryTable();
					if (success) {
						appMessage.success("历史记录已清空");
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} else {
						appMessage.error("清空失败");
					}
				} catch (error) {
					console.error("清空历史记录失败:", error);
					appMessage.error("操作失败");
				}
			},
		});
	};

	const handleResetDatabase = async () => {
		appModal.confirm({
			title: "重置数据库",
			content:
				"确定要重置整个数据库吗？这将删除所有数据并重新创建数据库。此操作无法撤销。",
			okText: "确定",
			cancelText: "取消",
			okType: "danger",
			onOk: async () => {
				try {
					const success = await resetDatabase();
					if (success) {
						appMessage.success("数据库已重置");
						emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					} else {
						appMessage.error("重置失败");
					}
				} catch (error) {
					console.error("重置数据库失败:", error);
					appMessage.error("操作失败");
				}
			},
		});
	};

	return (
		<>
			{/* 服务器配置 */}
			<ProList header="服务器配置">
				<Form
					form={form}
					layout="vertical"
					onFinish={handleConfigSubmit}
					initialValues={webdavConfig}
				>
					{/* 服务器地址 */}
					<ProListItem title="服务器地址" description="WebDAV服务器地址">
						<Form.Item
							name="url"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="https://example.com/dav" />
						</Form.Item>
					</ProListItem>

					{/* 用户名 */}
					<ProListItem title="用户名" description="WebDAV服务器用户名">
						<Form.Item
							name="username"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="username" />
						</Form.Item>
					</ProListItem>

					{/* 密码 */}
					<ProListItem title="密码" description="WebDAV服务器密码">
						<Form.Item
							name="password"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input.Password placeholder="password" />
						</Form.Item>
					</ProListItem>

					{/* 同步路径 */}
					<ProListItem
						title="同步路径"
						description="云端同步目录，默认为 /EcoPaste"
					>
						<Form.Item
							name="path"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="/EcoPaste" />
						</Form.Item>
					</ProListItem>

					{/* 操作按钮 */}
					<ProListItem
						title={
							connectionStatus !== "idle" ? (
								<Alert
									message={
										connectionStatus === "testing"
											? "正在测试连接..."
											: connectionStatus === "success"
												? "连接成功"
												: "连接失败"
									}
									type={
										connectionStatus === "testing"
											? "info"
											: connectionStatus === "success"
												? "success"
												: "error"
									}
									showIcon
									style={{
										margin: 0,
										display: "inline-flex",
										alignItems: "center",
										height: "32px", // 与按钮高度保持一致
										padding: "4px 8px",
										minWidth: "auto",
									}}
								/>
							) : null
						}
					>
						<Flex gap={8}>
							<Button
								type="default"
								icon={<CloudOutlined />}
								loading={connectionStatus === "testing"}
								onClick={testWebDAVConnection}
							>
								测试连接
							</Button>
							<Button
								type="primary"
								htmlType="submit"
								loading={isConfigLoading}
								icon={
									connectionStatus === "success" ? (
										<CheckCircleOutlined />
									) : undefined
								}
							>
								保存配置
							</Button>
						</Flex>
					</ProListItem>
				</Form>
			</ProList>

			{/* 同步配置 */}
			<ProList header="同步配置">
				{/* 收藏模式 */}
				<ProListItem title="收藏模式" description="只同步收藏的剪贴板内容">
					<Switch
						checked={favoritesModeEnabled}
						onChange={handleFavoritesModeChange}
					/>
				</ProListItem>

				{/* 文件模式 */}
				<ProListItem title="文件模式" description="启用后同步图片和文件内容">
					<Flex vertical gap={8} align="flex-end">
						<Switch
							checked={
								syncModeConfig.settings.includeImages &&
								syncModeConfig.settings.includeFiles
							}
							onChange={handleFileModeChange}
						/>
						{syncModeConfig.settings.includeImages &&
							syncModeConfig.settings.includeFiles && (
								<Flex align="center" gap={8} style={{ width: "auto" }}>
									<Text type="secondary" style={{ fontSize: "12px" }}>
										最大文件大小：
									</Text>
									<InputNumber
										size="small"
										min={1}
										max={100}
										value={cloudSyncStore.fileSync.maxFileSize}
										onChange={handleMaxFileSizeChange}
										style={{ width: 80 }}
										addonAfter="MB"
									/>
								</Flex>
							)}
					</Flex>
				</ProListItem>

				{/* 间隔同步 */}
				<ProListItem title="间隔同步" description="每隔一段时间自动同步数据">
					<Flex vertical gap={8} align="flex-end">
						<Switch
							checked={intervalSyncEnabled}
							onChange={handleIntervalSyncToggle}
						/>
						{intervalSyncEnabled && (
							<Select
								value={syncInterval}
								onChange={handleSyncIntervalChange}
								style={{ width: 120 }}
							>
								<Select.Option value={0.5}>30分钟</Select.Option>
								<Select.Option value={1}>1小时</Select.Option>
								<Select.Option value={2}>2小时</Select.Option>
								<Select.Option value={6}>6小时</Select.Option>
								<Select.Option value={12}>12小时</Select.Option>
								<Select.Option value={24}>每天</Select.Option>
							</Select>
						)}
					</Flex>
				</ProListItem>

				{/* 立即同步 */}
				<ProListItem
					title={
						lastSyncTime > 0 ? (
							<Flex
								align="center"
								gap={8}
								style={{
									display: "inline-flex",
									alignItems: "center",
									height: "32px", // 与按钮高度保持一致
									padding: "4px 12px",
									backgroundColor: "rgba(82, 196, 26, 0.05)",
									borderRadius: "4px",
									border: "1px solid rgba(82, 196, 26, 0.15)",
								}}
							>
								<ScheduleOutlined
									style={{ fontSize: "14px", color: "#52c41a" }}
								/>
								<Text type="secondary" style={{ fontSize: "12px" }}>
									上次同步：{formatSyncTime(lastSyncTime)}
								</Text>
							</Flex>
						) : (
							"立即同步"
						)
					}
				>
					<Button
						type="primary"
						size="middle"
						icon={<CloudSyncOutlined />}
						loading={isSyncing}
						onClick={handleImmediateSync}
						disabled={connectionStatus !== "success"}
						style={{ minWidth: 120 }}
					>
						立即同步
					</Button>
				</ProListItem>
			</ProList>

			{/* 开发环境专用：数据库管理工具 */}
			{isDev() && (
				<ProList header="开发工具（仅限开发环境）">
					<ProListItem
						title="清空历史记录"
						description="清空所有剪贴板历史记录，保留数据库结构"
					>
						<Button
							type="default"
							danger
							size="small"
							icon={<DeleteOutlined />}
							onClick={handleClearHistory}
						>
							清空历史
						</Button>
					</ProListItem>

					<ProListItem
						title="重置数据库"
						description="完全删除并重新创建数据库，删除所有数据"
					>
						<Button
							type="primary"
							danger
							size="small"
							icon={<DeleteOutlined />}
							onClick={handleResetDatabase}
						>
							重置数据库
						</Button>
					</ProListItem>
				</ProList>
			)}
		</>
	);
};

export default CloudSync;
