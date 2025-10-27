import ProList from "@/components/ProList";
import ProSwitch from "@/components/ProSwitch";
import UnoIcon from "@/components/UnoIcon";
import { LISTEN_KEY } from "@/constants";
import { setImportLogCallback } from "@/database";
import {
	type WebDAVConfig,
	getServerConfig,
	setServerConfig,
	testConnection,
} from "@/plugins/webdav";
import {
	SYNC_MODE_PRESETS,
	type SyncMode,
	type SyncModeConfig,
} from "@/types/sync.d";
import { isDev } from "@/utils/is";
import { type SyncInterval, realtimeSync } from "@/utils/realtimeSync";
import { setGlobalSyncLogCallback, syncEngine } from "@/utils/syncEngine";
import {
	CheckCircleOutlined,
	CloudOutlined,
	CloudSyncOutlined,
	LoadingOutlined,
	ScheduleOutlined,
} from "@ant-design/icons";
import { emit } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
	Alert,
	Button,
	Card,
	Collapse,
	Flex,
	Form,
	Input,
	List,
	Select,
	Typography,
	message,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
// import SyncModeSelector from "./SyncModeSelector";
// import ImmediateSyncButton from "./ImmediateSyncButton";
import { loadSyncModeConfig, saveSyncModeConfig } from "./syncModeConfig";
import type { LogEntry } from "./types";

const { Text } = Typography;
const { Panel } = Collapse;

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
	const [logs, setLogs] = useState<LogEntry[]>([]);
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
	const [lightweightModeEnabled, setLightweightModeEnabled] = useState(true);
	const [form] = Form.useForm();
	const logContainerRef = useRef<HTMLDivElement>(null);

	// 自动滚动到底部
	useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
		}
	});

	// 持久化同步时间
	const loadLastSyncTime = useCallback(() => {
		try {
			const saved = localStorage.getItem("ecopaste-last-sync-time");
			return saved ? Number.parseInt(saved, 10) : 0;
		} catch (error) {
			console.warn("加载上次同步时间失败:", error);
			return 0;
		}
	}, []);

	const saveLastSyncTime = useCallback((timestamp: number) => {
		try {
			localStorage.setItem("ecopaste-last-sync-time", timestamp.toString());
		} catch (error) {
			console.warn("保存上次同步时间失败:", error);
		}
	}, []);

	// 添加日志
	const addLog = useCallback(
		(
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => {
			const newLog: LogEntry = {
				id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
				timestamp: new Date().toLocaleString(),
				level,
				message,
				data: data ? JSON.stringify(data, null, 2) : undefined,
			};

			setLogs((prev) => [...prev, newLog]);

			// 同时输出到控制台
			const consoleMessage = `[CloudSync-${level.toUpperCase()}] ${message}`;
			switch (level) {
				case "error":
					console.error(consoleMessage, data);
					break;
				case "warning":
					console.warn(consoleMessage, data);
					break;
				case "success":
					// console.log(`%c${consoleMessage}`, "color: green", data);
					break;
				default:
				// console.log(consoleMessage, data);
			}
		},
		[],
	);

	// 加载同步模式配置
	const loadSyncMode = useCallback(() => {
		try {
			const config = loadSyncModeConfig();
			if (config?.mode) {
				setSyncModeConfig(config);
				addLog("info", "📝 已加载同步模式配置", { mode: config.mode });
			} else {
				console.error("加载的同步模式配置无效:", config);
				// 使用默认配置
				const defaultConfig = SYNC_MODE_PRESETS.lightweight;
				setSyncModeConfig(defaultConfig);
				addLog("warning", "⚠️ 使用默认同步模式配置", {
					mode: defaultConfig.mode,
				});
			}
		} catch (error) {
			addLog("error", "❌ 加载同步模式配置失败", { error });
			// 发生错误时使用默认配置
			const defaultConfig = SYNC_MODE_PRESETS.lightweight;
			setSyncModeConfig(defaultConfig);
		}
	}, [addLog]);

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
			const saved = saveSyncModeConfig(newConfig);
			if (saved) {
				addLog("info", "✅ 收藏模式配置已更新", { enabled });
				message.success(enabled ? "已启用收藏模式" : "已关闭收藏模式");
			} else {
				addLog("error", "❌ 保存收藏模式配置失败");
				message.error("保存配置失败");
			}
		} catch (error) {
			addLog("error", "❌ 处理收藏模式变更失败", { error });
			message.error("更新配置失败");
		}
	};

	// 处理轻量同步开关变更
	const handleLightweightModeChange = (enabled: boolean) => {
		try {
			const currentConfig = syncModeConfig;
			const newConfig = {
				...currentConfig,
				settings: {
					...currentConfig.settings,
					includeImages: !enabled,
					includeFiles: !enabled,
				},
			};

			// 如果启用了收藏模式，且关闭了轻量模式，保持完整的文件类型支持
			if (currentConfig.settings.onlyFavorites && !enabled) {
				newConfig.settings.includeImages = true;
				newConfig.settings.includeFiles = true;
			}

			setSyncModeConfig(newConfig);
			const saved = saveSyncModeConfig(newConfig);
			if (saved) {
				addLog("info", "✅ 轻量同步配置已更新", {
					enabled,
					includeImages: newConfig.settings.includeImages,
					includeFiles: newConfig.settings.includeFiles,
				});
				message.success(enabled ? "已启用轻量同步" : "已关闭轻量同步");
			} else {
				addLog("error", "❌ 保存轻量同步配置失败");
				message.error("保存配置失败");
			}
		} catch (error) {
			addLog("error", "❌ 处理轻量同步变更失败", { error });
			message.error("更新配置失败");
		}
	};

	// 初始化时加载配置
	useEffect(() => {
		// 设置全局日志回调
		setGlobalSyncLogCallback((level, message, data) => {
			addLog(level, message, data);
		});

		// 设置数据库导入日志回调
		setImportLogCallback((message, data) => {
			addLog("info", `💾 ${message}`, data);
		});

		// 监听间隔同步完成事件
		const unlisten = listen(
			LISTEN_KEY.REALTIME_SYNC_COMPLETED,
			(event: any) => {
				if (event.payload?.type === "interval_sync") {
					const timestamp = event.payload.timestamp;
					setLastSyncTime(timestamp);
					saveLastSyncTime(timestamp); // 持久化保存
					addLog(
						"info",
						`🕐 间隔同步完成，时间: ${new Date(timestamp).toLocaleString()}`,
					);
				}
			},
		);

		// 加载持久化的同步时间
		const savedLastSyncTime = loadLastSyncTime();
		if (savedLastSyncTime > 0) {
			setLastSyncTime(savedLastSyncTime);
		}

		// 加载配置
		loadServerConfig();
		loadSyncMode();

		// 清理函数
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [loadLastSyncTime, saveLastSyncTime, loadSyncMode, addLog]);

	// 更新同步引擎的同步模式配置
	useEffect(() => {
		if (syncModeConfig) {
			syncEngine.setSyncModeConfig(syncModeConfig);
		}
	}, [syncModeConfig]);

	// 同步配置到开关状态
	useEffect(() => {
		if (syncModeConfig) {
			setFavoritesModeEnabled(syncModeConfig.settings.onlyFavorites);
			setLightweightModeEnabled(
				!syncModeConfig.settings.includeImages &&
					!syncModeConfig.settings.includeFiles,
			);
		}
	}, [
		syncModeConfig,
		syncModeConfig.settings.includeImages,
		syncModeConfig.settings.includeFiles,
		syncModeConfig.settings.onlyFavorites,
	]);

	// 初始化开关状态
	useEffect(() => {
		// 根据初始syncModeConfig设置开关状态
		if (syncModeConfig) {
			setFavoritesModeEnabled(syncModeConfig.settings.onlyFavorites);
			setLightweightModeEnabled(
				!syncModeConfig.settings.includeImages &&
					!syncModeConfig.settings.includeFiles,
			);
		}
	}, [syncModeConfig]);

	// 持久化连接状态
	const saveConnectionState = async (
		status: "idle" | "testing" | "success" | "failed",
		config?: WebDAVConfig,
	) => {
		try {
			const connectionState = {
				status,
				timestamp: Date.now(),
				config: config
					? {
							url: config.url,
							username: config.username,
							path: config.path,
							// 不保存密码到连接状态中
						}
					: undefined,
			};

			// 使用localStorage作为前端临时存储
			localStorage.setItem(
				"ecopaste-webdav-connection-state",
				JSON.stringify(connectionState),
			);

			addLog("info", `连接状态已持久化保存: ${status}`);
		} catch (error) {
			console.warn("保存连接状态失败:", error);
		}
	};

	// 加载持久化的连接状态
	const loadConnectionState = () => {
		try {
			const savedState = localStorage.getItem(
				"ecopaste-webdav-connection-state",
			);
			if (savedState) {
				const state = JSON.parse(savedState);
				return state;
			}
		} catch (error) {
			console.warn("加载连接状态失败:", error);
		}
		return null;
	};

	// 加载服务器配置
	const loadServerConfig = async () => {
		setIsConfigLoading(true);
		try {
			const config = await getServerConfig();
			if (config) {
				setWebdavConfig(config);
				form.setFieldsValue(config);
				addLog("info", "📁 已加载保存的WebDAV配置", config);

				// 先检查持久化的连接状态
				const savedConnectionState = loadConnectionState();
				const now = Date.now();
				const STATE_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

				if (
					savedConnectionState?.config &&
					savedConnectionState.config.url === config.url &&
					savedConnectionState.config.username === config.username &&
					savedConnectionState.config.path === config.path &&
					now - savedConnectionState.timestamp < STATE_CACHE_DURATION
				) {
					// 使用持久化的连接状态
					setConnectionStatus(savedConnectionState.status);
					if (isDev()) {
						addLog(
							"info",
							`🔄 已恢复持久化的连接状态: ${savedConnectionState.status}`,
						);
					}
					if (isDev()) {
						addLog("info", "🔍 同步引擎状态检查", {
							canSync: syncEngine.canSync(),
							syncStatus: syncEngine.getSyncStatus(),
						});
					}

					if (savedConnectionState.status === "success") {
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
								if (isDev()) {
									addLog(
										"info",
										`🔄 间隔同步已自动启用，间隔: ${syncInterval}小时`,
									);
								}
							}

							if (isDev()) {
								addLog(
									"info",
									"🎉 云同步已就绪（基于缓存状态），可以开始使用！",
								);
							}
						} catch (_initError) {
							// 如果初始化失败，重新测试连接
							addLog("warning", "⚠️ 同步引擎初始化失败，重新测试连接");
							await validateConnectionStatus(config);
						}
					} else {
						addLog("info", "📝 之前连接失败，将在后台尝试重新连接");
					}
				} else {
					// 缓存过期或配置不匹配，将在后台重新验证连接状态
					if (isDev()) {
						addLog("info", "🔄 将在后台验证连接状态...");
					}
				}

				// 延迟验证连接状态，避免启动时的网络问题
				setTimeout(async () => {
					if (isDev()) {
						addLog("info", "🔄 后台验证连接状态...");
					}
					await validateConnectionStatus(config, false); // 不显示用户消息
				}, 3000); // 延迟3秒进行连接测试
			} else {
				if (isDev()) {
					addLog("info", "🌟 欢迎使用云同步功能，请配置您的WebDAV服务器信息");
				}
				setConnectionStatus("idle");
			}
		} catch (error) {
			addLog("error", "❌ 加载配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			setConnectionStatus("failed");
			message.error("加载配置失败");
		} finally {
			setIsConfigLoading(false);
		}
	};

	// 验证连接状态并初始化同步引擎
	const validateConnectionStatus = async (
		config: WebDAVConfig,
		showMessage = true,
	) => {
		if (!config || !config.url || !config.username || !config.password) {
			return;
		}

		setConnectionStatus("testing");

		try {
			const result = await testConnection(config);

			if (result.success) {
				setConnectionStatus("success");
				addLog("success", "✅ 配置有效，连接状态正常", {
					url: config.url,
					path: config.path,
					latency: `${result.latency_ms}ms`,
					status_code: result.status_code,
					server_info: result.server_info,
				});

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
					if (isDev()) {
						addLog("info", `🔄 间隔同步已自动启用，间隔: ${syncInterval}小时`);
					}
				}

				if (isDev()) {
					addLog("info", "🎉 云同步已就绪，可以开始使用！");
				}
				if (showMessage) {
					message.success("连接验证成功，云同步已就绪");
				}
			} else {
				setConnectionStatus("failed");
				await saveConnectionState("failed", config);

				addLog("warning", "⚠️ 配置已加载但连接失败", {
					url: config.url,
					path: config.path,
					error: result.error_message,
					status_code: result.status_code,
				});
				if (showMessage) {
					message.warning("连接失败，请检查网络或服务器配置");
				}
			}
		} catch (testError) {
			setConnectionStatus("failed");
			await saveConnectionState("failed", config);

			addLog("error", "❌ 连接验证出现异常", {
				error:
					testError instanceof Error ? testError.message : String(testError),
			});
			if (showMessage) {
				message.error("连接验证失败");
			}
		}
	};

	// 保存服务器配置
	const saveServerConfig = async (config: WebDAVConfig) => {
		try {
			await setServerConfig(config);
			addLog("success", "WebDAV配置已保存", config);
			return true;
		} catch (error) {
			addLog("error", "保存配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	// 测试WebDAV连接 - 优化版本：测试成功后持久化连接状态
	const testWebDAVConnection = async () => {
		addLog("info", "开始测试WebDAV连接...");
		addLog("info", `检查同步路径: ${webdavConfig.path}`);
		setConnectionStatus("testing");

		try {
			const result = await testConnection(webdavConfig);

			if (result.success) {
				setConnectionStatus("success");
				addLog("success", "WebDAV连接测试成功", {
					url: webdavConfig.url,
					path: webdavConfig.path,
					latency: `${result.latency_ms}ms`,
					status_code: result.status_code,
					server_info: result.server_info,
				});

				if (webdavConfig.path !== "/" && webdavConfig.path !== "") {
					addLog("info", "同步目录已就绪，可以进行文件操作");
				}

				// 连接成功后，持久化连接状态
				// 这里可以保存一个连接状态标记到配置文件中
				addLog("info", "📡 连接状态已保存，下次启动时自动恢复");
			} else {
				setConnectionStatus("failed");
				addLog("error", "WebDAV连接测试失败", {
					url: webdavConfig.url,
					path: webdavConfig.path,
					error: result.error_message,
					status_code: result.status_code,
				});
			}
		} catch (error) {
			setConnectionStatus("failed");
			addLog("error", "WebDAV连接测试出现异常", {
				error: error instanceof Error ? error.message : String(error),
			});
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
				message.error("配置保存失败");
				return;
			}

			addLog("info", "📝 配置已保存，开始自动测试连接...");

			// 自动测试连接并初始化同步引擎
			await validateConnectionStatus(config);
		} catch (error) {
			setConnectionStatus("failed");
			message.error("配置保存失败");
			addLog("error", "❌ 配置处理失败", {
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
			message.error("请先确保网络连接正常");
			return;
		}

		setIsSyncing(true);
		addLog("info", "🚀 开始智能同步...");

		try {
			// 双向智能同步
			addLog("info", "🔄 开始双向智能同步...");
			addLog("info", "💡 同步策略：双向合并，智能冲突解决，删除同步");

			const syncResult = await syncEngine.performBidirectionalSync();

			if (syncResult.success) {
				const timestamp = syncResult.timestamp;

				// 更新同步时间
				setLastSyncTime(timestamp);
				saveLastSyncTime(timestamp);

				// 显示成功消息
				let successMessage = "双向同步完成";
				if (syncResult.downloaded > 0 && syncResult.uploaded > 0) {
					successMessage += `，下载 ${syncResult.downloaded} 条，上传 ${syncResult.uploaded} 条`;
				} else if (syncResult.downloaded > 0) {
					successMessage += `，下载 ${syncResult.downloaded} 条数据`;
				} else if (syncResult.uploaded > 0) {
					successMessage += `，上传 ${syncResult.uploaded} 条数据`;
				} else {
					successMessage += "，数据已是最新的";
				}

				message.success(successMessage);
				addLog("success", "双向同步完成", {
					uploaded: syncResult.uploaded,
					downloaded: syncResult.downloaded,
					conflicts: syncResult.conflicts.length,
					duration: `${syncResult.duration}ms`,
				});

				// 触发界面刷新，确保列表显示最新数据
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					addLog("info", "🔄 已触发界面刷新");
				} catch (error) {
					addLog("warning", "⚠️ 触发界面刷新失败", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				throw new Error("双向同步失败");
			}
		} catch (error) {
			addLog("error", "❌ 同步失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			message.error("同步出错，请查看日志");
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
				if (isDev()) {
					addLog("info", `🔄 间隔同步已启用，间隔: ${syncInterval}小时`);
				}
				message.success(`间隔同步已启用，每${syncInterval}小时自动同步`);
			} else {
				realtimeSync.setEnabled(false);
				if (isDev()) {
					addLog("info", "⏸️ 间隔同步已禁用");
				}
				message.info("间隔同步已禁用");
			}
		} catch (error) {
			addLog("error", "间隔同步操作失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			message.error("间隔同步操作失败");
		}
	};

	// 处理同步间隔变更
	const handleSyncIntervalChange = async (hours: SyncInterval) => {
		setSyncInterval(hours);

		if (intervalSyncEnabled) {
			try {
				realtimeSync.setIntervalHours(hours);
				addLog("info", `📊 同步间隔已更新: ${hours}小时`, { hours });
				message.success(`同步间隔已更新为每${hours}小时`);
			} catch (error) {
				addLog("error", "更新同步间隔失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				message.error("更新同步间隔失败");
			}
		}
	};

	// 清空日志
	const clearLogs = () => {
		setLogs([]);
		addLog("info", "日志已清空");
	};

	// 复制所有日志
	const copyAllLogs = () => {
		const logText = logs
			.map((log) => {
				const dataStr = log.data ? `\n数据:\n${log.data}` : "";
				return `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}${dataStr}`;
			})
			.join("\n\n");

		navigator.clipboard
			.writeText(logText)
			.then(() => {
				message.success("日志已复制到剪贴板");
				addLog("info", "日志已复制到剪贴板", { logCount: logs.length });
			})
			.catch((error) => {
				message.error("复制失败");
				addLog("error", "复制日志失败", { error: error.message });
			});
	};

	// 获取日志级别颜色
	const getLogLevelColor = (level: string) => {
		switch (level) {
			case "error":
				return "#ff4d4f";
			case "warning":
				return "#faad14";
			case "success":
				return "#52c41a";
			default:
				return "#1890ff";
		}
	};

	// 获取日志级别图标
	const getLogLevelIcon = (level: string) => {
		switch (level) {
			case "error":
				return "i-material-symbols:error-outline";
			case "warning":
				return "i-material-symbols:warning-outline";
			case "success":
				return "i-material-symbols:check-circle-outline";
			default:
				return "i-material-symbols:info-outline";
		}
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
					size="small"
				>
					<List.Item>
						<List.Item.Meta
							title="服务器地址"
							description="WebDAV服务器的完整URL地址"
						/>
						<Form.Item
							name="url"
							rules={[
								{ required: true, message: "请输入服务器地址" },
								{ type: "url", message: "请输入有效的URL" },
							]}
							noStyle
						>
							<Input
								placeholder="https://example.com/sync"
								style={{ width: 200 }}
							/>
						</Form.Item>
					</List.Item>

					<List.Item>
						<List.Item.Meta
							title="用户名"
							description="WebDAV服务器的登录用户名"
						/>
						<Form.Item
							name="username"
							rules={[{ required: true, message: "请输入用户名" }]}
							noStyle
						>
							<Input placeholder="webdav" style={{ width: 200 }} />
						</Form.Item>
					</List.Item>

					<List.Item>
						<List.Item.Meta title="密码" description="WebDAV服务器的登录密码" />
						<Form.Item
							name="password"
							rules={[{ required: true, message: "请输入密码" }]}
							noStyle
						>
							<Input.Password placeholder="•••" style={{ width: 200 }} />
						</Form.Item>
					</List.Item>

					<List.Item>
						<List.Item.Meta title="同步路径" description="云端存储的目录路径" />
						<Form.Item
							name="path"
							rules={[{ required: true, message: "请输入同步路径" }]}
							noStyle
						>
							<Input placeholder="/EcoPaste" style={{ width: 200 }} />
						</Form.Item>
					</List.Item>

					<List.Item>
						{/* 使用相对定位确保右侧状态对齐到输入框右边缘 */}
						<div style={{ position: "relative", width: "100%" }}>
							{/* 左侧按钮组 */}
							<Flex gap="12px" align="center" style={{ padding: "2px 0" }}>
								<Button
									type="primary"
									htmlType="submit"
									loading={isConfigLoading}
									icon={<UnoIcon name="i-material-symbols:save" />}
									size="middle"
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: "0px",
									}}
								>
									保存配置
								</Button>

								<Button
									icon={<UnoIcon name="i-material-symbols:cloud-sync" />}
									onClick={testWebDAVConnection}
									disabled={isConfigLoading}
									size="middle"
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										gap: "0px",
									}}
								>
									测试连接
								</Button>
							</Flex>

							{/* 右侧状态信息 - 只显示连接状态 */}
							<div
								style={{
									position: "absolute",
									right: "4px",
									top: "50%",
									transform: "translateY(-50%)",
									display: "flex",
									alignItems: "center",
									gap: "8px",
								}}
							>
								<Flex align="center" gap="8px">
									{connectionStatus === "success" ? (
										<CheckCircleOutlined
											style={{ fontSize: "14px", color: "#52c41a" }}
										/>
									) : connectionStatus === "failed" ? (
										<CloudSyncOutlined
											style={{ fontSize: "14px", color: "#ff4d4f" }}
										/>
									) : (
										<CloudOutlined
											style={{ fontSize: "14px", color: "#4d4d4dff" }}
										/>
									)}
									<Flex align="center" gap="4px">
										<Text
											type="secondary"
											style={{ fontSize: "14px", whiteSpace: "nowrap" }}
										>
											{connectionStatus === "testing" ? (
												<>
													<LoadingOutlined
														style={{
															fontSize: "12px",
															color: "#1890ff",
															marginRight: "4px",
														}}
													/>
													正在测试连接...
												</>
											) : connectionStatus === "success" ? (
												<>连接成功</>
											) : connectionStatus === "failed" ? (
												<>连接失败</>
											) : (
												<>未连接</>
											)}
										</Text>
									</Flex>
								</Flex>
							</div>
						</div>
					</List.Item>
				</Form>
			</ProList>

			{/* 同步设置 */}
			<ProList header="同步设置">
				{/* 收藏模式开关 */}
				<ProSwitch
					title="收藏模式"
					description="开启后仅同步收藏的剪贴板内容"
					value={favoritesModeEnabled}
					onChange={handleFavoritesModeChange}
					disabled={connectionStatus !== "success"}
				/>

				{/* 轻量同步开关 */}
				<ProSwitch
					title="轻量同步"
					description="开启后仅同步文本和富文本，不包含图片和文件"
					value={lightweightModeEnabled}
					onChange={handleLightweightModeChange}
					disabled={connectionStatus !== "success"}
				/>

				<ProSwitch
					title="自动同步"
					description="启用后将按设定间隔自动同步剪贴板数据"
					value={intervalSyncEnabled}
					onChange={handleIntervalSyncToggle}
					disabled={connectionStatus !== "success"}
				/>

				{intervalSyncEnabled && (
					<List.Item>
						<List.Item.Meta
							title="同步间隔"
							description="设置自动同步的时间间隔"
						/>
						<Select
							value={syncInterval}
							onChange={handleSyncIntervalChange}
							size="small"
							style={{ width: 200 }}
						>
							<Select.Option value={1}>每小时</Select.Option>
							<Select.Option value={2}>每2小时</Select.Option>
							<Select.Option value={6}>每6小时</Select.Option>
							<Select.Option value={12}>每12小时</Select.Option>
							<Select.Option value={24}>每天</Select.Option>
						</Select>
					</List.Item>
				)}

				{/* 立即同步按钮 - 简化版本 */}
				<List.Item>
					<div style={{ position: "relative", width: "100%" }}>
						{/* 左侧按钮 */}
						<Flex align="center" style={{ padding: "2px 0" }}>
							<Button
								type="primary"
								size="middle"
								icon={<CloudSyncOutlined />}
								loading={isSyncing}
								onClick={handleImmediateSync}
								disabled={connectionStatus !== "success"}
							>
								立即同步
							</Button>
						</Flex>

						{/* 右侧同步时间显示 */}
						{lastSyncTime > 0 && (
							<div
								style={{
									position: "absolute",
									right: "2px",
									top: "50%",
									transform: "translateY(-50%)",
									display: "flex",
									alignItems: "center",
									gap: "8px",
									padding: "2px 8px",
									backgroundColor: "rgba(82, 196, 26, 0.05)",
									borderRadius: "4px",
									border: "1px solid rgba(82, 196, 26, 0.15)",
								}}
							>
								<ScheduleOutlined
									style={{ fontSize: "14px", color: "#52c41a" }}
								/>
								<Text type="secondary" style={{ fontSize: "12px" }}>
									{formatSyncTime(lastSyncTime)}
								</Text>
							</div>
						)}
					</div>
				</List.Item>
			</ProList>

			{/* 开发模式专用：测试工具与日志 */}
			{isDev() && (
				<>
					<ProList header="测试工具与日志">
						<Collapse size="small" ghost>
							<Panel header="连接测试与日志" key="logs">
								{logs.length > 0 && (
									<>
										<Flex
											gap="small"
											justify="end"
											style={{ marginBottom: 12 }}
										>
											<Button
												size="small"
												icon={
													<UnoIcon name="i-material-symbols:content-copy" />
												}
												onClick={copyAllLogs}
											>
												复制日志
											</Button>
											<Button
												size="small"
												icon={<UnoIcon name="i-material-symbols:clear-all" />}
												onClick={clearLogs}
											>
												清空日志
											</Button>
										</Flex>

										<Card
											size="small"
											title="连接日志"
											bodyStyle={{
												padding: 0,
												maxHeight: 200,
												overflow: "hidden",
											}}
										>
											<div
												ref={logContainerRef}
												style={{
													height: 200,
													overflowY: "auto",
													backgroundColor: "#000",
													color: "#fff",
													padding: "8px",
													fontFamily: "Monaco, Consolas, monospace",
													fontSize: "11px",
													lineHeight: "1.4",
												}}
											>
												{logs.map((log) => (
													<div
														key={log.id}
														style={{
															marginBottom: "4px",
															padding: "2px 0",
															borderBottom: "1px solid #333",
														}}
													>
														<div
															style={{
																display: "flex",
																alignItems: "center",
																gap: "4px",
															}}
														>
															<UnoIcon
																name={getLogLevelIcon(log.level)}
																size={12}
																color={getLogLevelColor(log.level)}
															/>
															<span style={{ color: "#666", fontSize: "10px" }}>
																{log.timestamp}
															</span>
															<span
																style={{
																	color: getLogLevelColor(log.level),
																	fontWeight: "bold",
																	fontSize: "10px",
																}}
															>
																[{log.level.toUpperCase()}]
															</span>
														</div>
														<div
															style={{
																marginTop: "1px",
																color: "#fff",
																fontSize: "11px",
															}}
														>
															{log.message}
														</div>
													</div>
												))}
											</div>
										</Card>
									</>
								)}
							</Panel>
						</Collapse>
					</ProList>

					<ProList header="关于云同步">
						<Alert
							message={
								<div>
									<Text strong>云同步功能说明</Text>
									<br />
									<Text>
										基于 WebDAV
										协议实现多设备间的剪贴板数据同步，支持间隔自动同步和冲突解决。
									</Text>
								</div>
							}
							type="info"
							showIcon
						/>

						<List.Item>
							<List.Item.Meta
								title="使用说明"
								description={
									<div>
										<div>📁 请配置您的WebDAV服务器信息</div>
										<div>🔄 支持间隔同步和手动同步两种模式</div>
										<div>📊 自动处理数据冲突和去重</div>
										<div>🔒 所有数据在您自己的服务器上，安全可靠</div>
									</div>
								}
							/>
						</List.Item>
					</ProList>
				</>
			)}
		</>
	);
};

export default CloudSync;
