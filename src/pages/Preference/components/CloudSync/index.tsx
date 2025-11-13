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
import { type SyncInterval, autoSync } from "@/utils/autoSync";
import { isDev } from "@/utils/is";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { loadSyncModeConfig, saveSyncModeConfig } from "./syncModeConfig";

const { Text } = Typography;

const CloudSync = () => {
	// 安全获取消息 API 实例
	let appMessage: any;
	try {
		const app = App.useApp();
		appMessage = app.message;
	} catch (_error) {
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
	const [renderKey, setRenderKey] = useState(0); // 用于强制重新渲染
	const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
	const [syncInterval, setSyncInterval] = useState<SyncInterval>(1); // 默认1小时
	const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>({
		url: "",
		username: "",
		password: "",
		path: "/EcoPaste",
		timeout: 60000, // 增加默认超时时间到60秒，提高网络请求的可靠性
	});
	const [syncModeConfig, setSyncModeConfig] = useState<SyncModeConfig>(
		SYNC_MODE_PRESETS.lightweight,
	);
	const [form] = Form.useForm();

	// 保存上次同步时间到本地存储
	const saveLastSyncTime = useCallback((timestamp: number) => {
		try {
			localStorage.setItem("ecopaste-last-sync-time", timestamp.toString());
		} catch (_error) {
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
					configHash,
				};
				localStorage.setItem(
					"ecopaste-connection-state",
					JSON.stringify(connectionState),
				);
			} catch (_error) {
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
					// 设置同步模式配置 - 使用 ref 避免循环依赖
					syncEngine.setSyncModeConfig(syncModeConfigRef.current);

					// 如果自动同步已启用，重新初始化它
					if (autoSyncEnabled) {
						autoSync.initialize({
							enabled: true,
							intervalHours: syncInterval,
						});
					}

					if (showMessage) {
						appMessage.success("连接成功，云同步已就绪");
					}
				} else {
					setConnectionStatus("failed");
					await saveConnectionState("failed", config);

					if (showMessage) {
						appMessage.warning("连接失败，请检查配置");
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
		[
			autoSyncEnabled,
			syncInterval,
			saveConnectionState,
			appMessage.success,
			appMessage.warning,
			appMessage.error,
		], // 移除 syncModeConfig 依赖，使用 ref 代替
	);

	// 加载同步模式配置
	const loadSyncMode = useCallback(() => {
		try {
			// 从localStorage加载保存的配置
			const savedConfig = loadSyncModeConfig();
			let config: SyncModeConfig;

			// 如果有保存的配置，优先使用
			if (savedConfig) {
				config = savedConfig;
			} else {
				// 否则根据globalStore中的lightweightMode状态生成配置
				const lightweightMode = cloudSyncStore.fileSync.lightweightMode;
				config = lightweightMode
					? SYNC_MODE_PRESETS.lightweight
					: SYNC_MODE_PRESETS.full;
			}

			setSyncModeConfig(config);

			// 延迟更新同步引擎配置，避免循环依赖
			setTimeout(() => {
				try {
					syncEngine.setSyncModeConfig(config);
				} catch (_error) {
					// 同步引擎尚未初始化，配置将在引擎初始化后应用
				}
			}, 100);
		} catch (error) {
			console.error("加载同步模式配置失败:", error);
			// 发生错误时使用默认配置
			const defaultConfig = SYNC_MODE_PRESETS.lightweight;
			setSyncModeConfig(defaultConfig);
		}
	}, [cloudSyncStore.fileSync.lightweightMode]);

	// 使用 useRef 存储 syncModeConfig，避免循环依赖
	const syncModeConfigRef = useRef(syncModeConfig);
	useEffect(() => {
		syncModeConfigRef.current = syncModeConfig;
	}, [syncModeConfig]);

	// 加载服务器配置
	const loadServerConfig = useCallback(async () => {
		try {
			const config = await getServerConfig();
			if (config?.url) {
				setWebdavConfig(config);
				form.setFieldsValue(config);

				// 检查缓存的连接状态是否仍然有效
				const savedConnectionState = localStorage.getItem(
					"ecopaste-connection-state",
				);
				if (savedConnectionState) {
					try {
						const { status, configHash } = JSON.parse(savedConnectionState);

						// 检查配置是否变化（移除时间限制，让连接状态持久化）
						const currentConfigHash = btoa(JSON.stringify(config)).substring(
							0,
							16,
						);

						if (configHash === currentConfigHash && status === "success") {
							setConnectionStatus("success");

							// 如果之前连接成功，直接初始化同步引擎
							try {
								await syncEngine.initialize(config);
								// 设置同步模式配置 - 使用 ref 避免循环依赖
								setTimeout(() => {
									syncEngine.setSyncModeConfig(syncModeConfigRef.current);
								}, 100);
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
	}, [form, validateConnectionStatus, appMessage.error]); // 移除 syncModeConfigRef 依赖，因为 ref 对象本身不会变化

	// 处理收藏模式开关变更（使用防抖优化）
	const handleFavoritesModeChange = useCallback(
		(enabled: boolean) => {
			try {
				// 检查状态是否已经相同，避免不必要的更新
				if (syncModeConfig.settings.onlyFavorites === enabled) {
					return;
				}

				const currentConfig = syncModeConfig;
				const newConfig = {
					...currentConfig,
					mode: (enabled ? "favorites" : "full") as SyncMode,
					settings: {
						...currentConfig.settings,
						onlyFavorites: enabled,
					},
				};

				// 先保存配置到localStorage
				const saved = saveSyncModeConfig(newConfig);

				if (saved) {
					// 更新组件状态
					setSyncModeConfig(newConfig);

					// 更新globalStore中的lightweightMode状态
					globalStore.cloudSync.fileSync.lightweightMode = enabled;

					appMessage.success(enabled ? "收藏模式已启用" : "收藏模式已关闭");
				} else {
					appMessage.error("保存配置失败");
				}
			} catch (error) {
				console.error("处理收藏模式变更失败:", error);
				appMessage.error("更新配置失败");
			}
		},
		[syncModeConfig, appMessage],
	);

	// 处理文件模式开关变更（新版本：文件模式 = 包含图片和文件）
	const handleFileModeChange = useCallback(
		(enabled: boolean) => {
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

				const saved = saveSyncModeConfig(newConfig);
				if (saved) {
					// 更新组件状态
					setSyncModeConfig(newConfig);

					// 更新globalStore状态
					globalStore.cloudSync.fileSync.lightweightMode = !enabled;

					appMessage.success(enabled ? "文件模式已启用" : "文件模式已关闭");
				} else {
					appMessage.error("保存配置失败");
				}
			} catch (error) {
				console.error("处理文件模式变更失败", error);
				appMessage.error("更新配置失败");
			}
		},
		[syncModeConfig, appMessage],
	);

	// 处理文件大小限制变更
	const handleMaxFileSizeChange = useCallback(
		(value: number | null) => {
			if (value === null || value < 1) return;

			try {
				globalStore.cloudSync.fileSync.maxFileSize = value;
				appMessage.success(`文件限制已更新为 ${value}MB`);
			} catch (error) {
				console.error("处理文件限制变更失败", error);
				appMessage.error("更新配置失败");
			}
		},
		[appMessage],
	);

	// 使用 ref 存储函数，避免依赖变化
	const loadServerConfigRef = useRef(loadServerConfig);
	const loadSyncModeRef = useRef(loadSyncMode);
	const saveLastSyncTimeRef = useRef(saveLastSyncTime);

	useEffect(() => {
		loadServerConfigRef.current = loadServerConfig;
	}, [loadServerConfig]);

	useEffect(() => {
		loadSyncModeRef.current = loadSyncMode;
	}, [loadSyncMode]);

	useEffect(() => {
		saveLastSyncTimeRef.current = saveLastSyncTime;
	}, [saveLastSyncTime]);

	// 刷新同步时间的函数
	const refreshLastSyncTime = useCallback(() => {
		const savedLastSyncTime = localStorage.getItem("ecopaste-last-sync-time");
		if (savedLastSyncTime) {
			setLastSyncTime(Number.parseInt(savedLastSyncTime, 10));
		}
	}, []);

	// 初始化时加载配置
	useEffect(() => {
		// 监听自动同步完成事件
		const unlisten = listen(
			LISTEN_KEY.REALTIME_SYNC_COMPLETED,
			(event: any) => {
				if (event.payload?.type === "auto_sync") {
					const timestamp = event.payload.timestamp;
					setLastSyncTime(timestamp);
					saveLastSyncTimeRef.current(timestamp); // 持久化保存
				}
			},
		);

		// 加载持久化的同步时间
		refreshLastSyncTime();

		// 加载配置
		loadServerConfigRef.current();
		loadSyncModeRef.current();

		// 清理函数
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refreshLastSyncTime]); // 添加refreshLastSyncTime依赖

	// 监听页面可见性变化，当页面重新可见时刷新同步时间
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				// 重新读取同步时间
				const savedLastSyncTime = localStorage.getItem(
					"ecopaste-last-sync-time",
				);
				if (savedLastSyncTime) {
					setLastSyncTime(Number.parseInt(savedLastSyncTime, 10));
				}
				// 强制重新渲染以更新时间显示
				setRenderKey((prev) => prev + 1);
			}
		};

		// 监听页面可见性变化
		document.addEventListener("visibilitychange", handleVisibilityChange);

		// 监听窗口获得焦点
		window.addEventListener("focus", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("focus", handleVisibilityChange);
		};
	}, []);

	// 更新同步引擎的同步模式配置（使用防抖优化）
	useEffect(() => {
		if (syncModeConfig) {
			const timeoutId = setTimeout(() => {
				try {
					syncEngine.setSyncModeConfig(syncModeConfig);
				} catch (_error) {
					// 同步引擎尚未初始化，配置将在引擎初始化后应用
				}
			}, 300); // 300ms 防抖，避免快速连续更新
			return () => clearTimeout(timeoutId);
		}
	}, [syncModeConfig]); // 使用 syncModeConfig 作为依赖，但通过其他方式避免循环

	// 自动同步初始化 - 独立于连接状态加载
	useEffect(() => {
		if (connectionStatus === "success" && webdavConfig.url) {
			try {
				if (autoSyncEnabled) {
					autoSync.initialize({
						enabled: true,
						intervalHours: syncInterval,
					});
				} else {
					autoSync.setEnabled(false);
				}
			} catch (error) {
				console.error("自动同步初始化失败:", error);
			}
		}
	}, [connectionStatus, autoSyncEnabled, syncInterval, webdavConfig.url]); // 只依赖 url 字段，避免整个对象变化导致的循环

	// 保存服务器配置
	const saveServerConfig = async (config: WebDAVConfig) => {
		try {
			await setServerConfig(config);
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
				appMessage.success("连接成功");
			} else {
				setConnectionStatus("failed");
				appMessage.error("连接失败");
			}
		} catch (_error) {
			setConnectionStatus("failed");
			appMessage.error("连接测试失败");
		}
	};

	// 处理表单提交 - 优化版本：自动测试连接并持久化状态
	const handleConfigSubmit = async (values: any) => {
		setIsConfigLoading(true);
		try {
			// 确保包含默认超时时间
			const config: WebDAVConfig = {
				...values,
				timeout: 60000, // 增加默认超时时间到60秒，提高网络请求的可靠性
			};

			setWebdavConfig(config);

			// 保存配置到本地
			const saved = await saveServerConfig(config);
			if (!saved) {
				appMessage.error("保存失败");
				return;
			}

			// 自动测试连接并初始化同步引擎
			await validateConnectionStatus(config);
		} catch (error) {
			setConnectionStatus("failed");
			appMessage.error("保存失败");
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
			appMessage.error("请先检查网络连接");
			return;
		}

		// 检查WebDAV配置是否有效
		if (!webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
			appMessage.error("配置不完整，请先完成设置");
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
					maxImageSize: cloudSyncStore.fileSync.maxFileSize,
					maxFileSize: cloudSyncStore.fileSync.maxFileSize,
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

				let successMessage: string;
				if (totalCount === 0) {
					successMessage = "无需同步";
				} else {
					successMessage = `已同步 ${totalCount} 条数据`;
				}

				appMessage.success(successMessage);

				// 触发界面刷新，确保列表显示最新数据
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					// 静默处理刷新失败
				}
			} else {
				throw new Error("双向同步失败");
			}
		} catch (error) {
			console.error("❌ 同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			appMessage.error("同步失败，请查看日志");
		} finally {
			setIsSyncing(false);
		}
	};

	// 处理自动同步开关
	const handleAutoSyncToggle = async (enabled: boolean) => {
		setAutoSyncEnabled(enabled);
		try {
			if (enabled) {
				autoSync.initialize({
					enabled: true,
					intervalHours: syncInterval,
				});
				appMessage.success("自动同步已启用");
			} else {
				autoSync.setEnabled(false);
				appMessage.info("自动同步已禁用");
			}
		} catch (error) {
			console.error("自动同步操作失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			appMessage.error("自动同步操作失败");
		}
	};

	// 处理同步间隔变更
	const handleSyncIntervalChange = async (hours: SyncInterval) => {
		setSyncInterval(hours);
		if (autoSyncEnabled) {
			try {
				autoSync.setIntervalHours(hours);
				appMessage.success("同步间隔已更新");
			} catch (error) {
				console.error("更新同步间隔失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				appMessage.error("更新间隔失败");
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
						appMessage.success("清空成功");
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
						appMessage.success("重置成功");
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
					<ProListItem title="服务器地址">
						<Form.Item
							name="url"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="https://example.com/dav" />
						</Form.Item>
					</ProListItem>

					{/* 用户名 */}
					<ProListItem title="用户名">
						<Form.Item
							name="username"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="username" />
						</Form.Item>
					</ProListItem>

					{/* 密码 */}
					<ProListItem title="密码">
						<Form.Item
							name="password"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input.Password placeholder="password" />
						</Form.Item>
					</ProListItem>

					{/* 同步路径 */}
					<ProListItem title="同步路径">
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
						checked={syncModeConfig.settings.onlyFavorites}
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
										文件限制：
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
				<ProListItem title="自动同步" description="按设定间隔自动同步数据">
					<Flex vertical gap={8} align="flex-end">
						<Switch checked={autoSyncEnabled} onChange={handleAutoSyncToggle} />
						{autoSyncEnabled && (
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
				{lastSyncTime > 0 ? (
					<ProListItem
						title={
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
								<Text
									type="secondary"
									style={{ fontSize: "12px" }}
									key={renderKey}
								>
									上次同步：{(() => {
										if (!lastSyncTime || lastSyncTime === 0) return "";

										const date = new Date(lastSyncTime);
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
										return date.toLocaleDateString();
									})()}
								</Text>
							</Flex>
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
				) : (
					// 当没有同步历史时，只显示按钮，不使用ProListItem包装
					<div
						style={{
							padding: "12px 16px",
							display: "flex",
							justifyContent: "flex-end",
						}}
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
					</div>
				)}
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
