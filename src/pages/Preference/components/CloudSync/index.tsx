import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { LISTEN_KEY } from "@/constants";
import { getDatabaseInfo, resetDatabase } from "@/database";
import { type WebDAVConfig, testConnection } from "@/plugins/webdav";
import { globalStore } from "@/stores/global";
import type { SyncModeConfig } from "@/types/sync.d";
import { type SyncInterval, autoSync } from "@/utils/autoSync";
import { configSync } from "@/utils/configSync";
import { isDev } from "@/utils/is";
import { syncEngine } from "@/utils/syncEngine";

// 获取默认配置（双开关模式）
const getDefaultSyncModeConfig = (): SyncModeConfig => {
	return {
		settings: {
			includeText: true, // 总是启用
			includeHtml: true, // 总是启用
			includeRtf: true, // 总是启用
			includeMarkdown: true, // 总是启用
			includeImages: false, // 文件模式开关，默认关闭
			includeFiles: false, // 文件模式开关，默认关闭
			onlyFavorites: false, // 收藏模式开关，默认关闭
		},
	};
};
import {
	CheckCircleOutlined,
	CloudOutlined,
	CloudSyncOutlined,
	DeleteOutlined,
	DownloadOutlined,
	InfoCircleOutlined,
	ScheduleOutlined,
	UploadOutlined,
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
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";

const { Text } = Typography;

const CloudSync = () => {
	const { t } = useTranslation();
	// 安全获取消息 API 实例
	let appMessage: any;
	let modal: any;
	let modalContextHolder: React.ReactNode;

	try {
		const app = App.useApp();
		appMessage = app.message;
		[modal, modalContextHolder] = Modal.useModal();
	} catch (_error) {
		// 如果 App.useApp() 失败，使用静态方法
		appMessage = {
			success: (content: string) => message.success(content),
			error: (content: string) => message.error(content),
			warning: (content: string) => message.warning(content),
			info: (content: string) => message.info(content),
			loading: (content: string) => message.loading(content),
		};
		[modal, modalContextHolder] = Modal.useModal();
	}
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
	const [syncModeConfig, setSyncModeConfig] = useState<SyncModeConfig>(
		getDefaultSyncModeConfig(),
	);
	const [isConfigSyncing, setIsConfigSyncing] = useState(false);
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
						appMessage.success(
							t("preference.cloud_sync.connection_success_ready"),
						);
					}
				} else {
					setConnectionStatus("failed");
					await saveConnectionState("failed", config);

					if (showMessage) {
						appMessage.warning(
							t("preference.cloud_sync.connection_failed_check"),
						);
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
					appMessage.error(
						t("preference.cloud_sync.connection_validation_failed"),
					);
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
			t,
		], // 移除 syncModeConfig 依赖，使用 ref 代替
	);

	// 加载同步模式配置
	const loadSyncMode = useCallback(() => {
		try {
			// 从globalStore读取同步模式配置
			const storeSyncModeConfig = cloudSyncStore.syncModeConfig;

			// 转换为SyncModeConfig格式（双开关模式）
			const config: SyncModeConfig = {
				settings: {
					includeText: storeSyncModeConfig.settings.includeText,
					includeHtml: storeSyncModeConfig.settings.includeHtml,
					includeRtf: storeSyncModeConfig.settings.includeRtf,
					includeMarkdown: storeSyncModeConfig.settings.includeMarkdown || true,
					includeImages: storeSyncModeConfig.settings.includeImages,
					includeFiles: storeSyncModeConfig.settings.includeFiles,
					onlyFavorites: storeSyncModeConfig.settings.onlyFavorites,
				},
			};

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
			const defaultConfig = getDefaultSyncModeConfig();
			setSyncModeConfig(defaultConfig);
		}
	}, [cloudSyncStore.syncModeConfig]);

	// 使用 useRef 存储 syncModeConfig，避免循环依赖
	const syncModeConfigRef = useRef(syncModeConfig);
	useEffect(() => {
		syncModeConfigRef.current = syncModeConfig;
	}, [syncModeConfig]);

	// 服务器配置状态
	const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig | null>(null);

	// 加载服务器配置
	const loadServerConfig = useCallback(async () => {
		try {
			// 从后端读取WebDAV配置
			const { getServerConfig } = await import("@/plugins/webdav");
			const backendConfig = await getServerConfig();

			if (backendConfig?.url) {
				setWebdavConfig(backendConfig);
				form.setFieldsValue(backendConfig);

				// 检查缓存的连接状态是否仍然有效
				const savedConnectionState = localStorage.getItem(
					"ecopaste-connection-state",
				);
				if (savedConnectionState) {
					try {
						const { status, configHash } = JSON.parse(savedConnectionState);

						// 检查配置是否变化（移除时间限制，让连接状态持久化）
						const currentConfigHash = btoa(
							JSON.stringify(backendConfig),
						).substring(0, 16);

						if (configHash === currentConfigHash && status === "success") {
							setConnectionStatus("success");

							// 如果之前连接成功，直接初始化同步引擎
							try {
								await syncEngine.initialize(backendConfig);
								// 设置同步模式配置 - 使用 ref 避免循环依赖
								setTimeout(() => {
									syncEngine.setSyncModeConfig(syncModeConfigRef.current);
								}, 100);
							} catch (initError) {
								// 如果初始化失败，重新测试连接
								console.warn("同步引擎初始化失败，重新测试连接:", initError);
								await validateConnectionStatus(backendConfig);
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
				setWebdavConfig(null);
				setConnectionStatus("idle");
			}
		} catch (error) {
			console.error("❌ 加载配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			setWebdavConfig(null);
			setConnectionStatus("failed");
			appMessage.error(t("preference.cloud_sync.load_config_failed"));
		} finally {
			setIsConfigLoading(false);
		}
	}, [form, validateConnectionStatus, appMessage.error, t]);

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
					settings: {
						...currentConfig.settings,
						onlyFavorites: enabled,
					},
				};

				// 直接更新globalStore中的同步模式配置（双开关模式）
				globalStore.cloudSync.syncModeConfig = {
					settings: {
						includeText: newConfig.settings.includeText,
						includeHtml: newConfig.settings.includeHtml,
						includeRtf: newConfig.settings.includeRtf,
						includeMarkdown: newConfig.settings.includeMarkdown,
						includeImages: newConfig.settings.includeImages,
						includeFiles: newConfig.settings.includeFiles,
						onlyFavorites: enabled,
					},
				};

				// 更新组件状态
				setSyncModeConfig(newConfig);

				appMessage.success(
					enabled
						? t("preference.cloud_sync.favorite_mode_enabled")
						: t("preference.cloud_sync.favorite_mode_disabled"),
				);
			} catch (error) {
				console.error("处理收藏模式变更失败:", error);
				appMessage.error(t("preference.cloud_sync.update_config_failed"));
			}
		},
		[syncModeConfig, appMessage, t],
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

				// 直接更新globalStore中的同步模式配置（双开关模式）
				globalStore.cloudSync.syncModeConfig = {
					settings: {
						includeText: newConfig.settings.includeText,
						includeHtml: newConfig.settings.includeHtml,
						includeRtf: newConfig.settings.includeRtf,
						includeMarkdown: newConfig.settings.includeMarkdown,
						includeImages: enabled,
						includeFiles: enabled,
						onlyFavorites: newConfig.settings.onlyFavorites,
					},
				};

				// 更新组件状态
				setSyncModeConfig(newConfig);

				appMessage.success(
					enabled
						? t("preference.cloud_sync.file_mode_enabled")
						: t("preference.cloud_sync.file_mode_disabled"),
				);
			} catch (error) {
				console.error("处理文件模式变更失败", error);
				appMessage.error("更新配置失败");
			}
		},
		[syncModeConfig, appMessage, t],
	);

	// 处理文件大小限制变更
	const handleMaxFileSizeChange = useCallback(
		(value: number | null) => {
			if (value === null || value < 1) return;

			try {
				globalStore.cloudSync.fileSync.maxFileSize = value;
				appMessage.success(
					t("preference.cloud_sync.file_limit_updated", { 0: value }),
				);
			} catch (error) {
				console.error("处理文件限制变更失败", error);
				appMessage.error(t("preference.cloud_sync.update_config_failed"));
			}
		},
		[appMessage, t],
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

		// 加载自动同步状态
		try {
			// 从globalStore读取自动同步设置
			const autoSyncSettings = cloudSyncStore.autoSyncSettings;
			setAutoSyncEnabled(autoSyncSettings.enabled);
			setSyncInterval(autoSyncSettings.intervalHours as SyncInterval);

			// 迁移旧的localStorage设置（如果存在）
			const savedAutoSyncEnabled = localStorage.getItem(
				"ecopaste-auto-sync-enabled",
			);
			const savedSyncInterval = localStorage.getItem("ecopaste-sync-interval");

			if (savedAutoSyncEnabled !== null) {
				globalStore.cloudSync.autoSyncSettings.enabled =
					savedAutoSyncEnabled === "true";
				localStorage.removeItem("ecopaste-auto-sync-enabled");
			}
			if (savedSyncInterval !== null) {
				globalStore.cloudSync.autoSyncSettings.intervalHours =
					Number.parseFloat(savedSyncInterval);
				localStorage.removeItem("ecopaste-sync-interval");
			}
		} catch (error) {
			console.warn("加载同步配置失败:", error);
		}

		// 加载配置
		loadServerConfigRef.current();
		loadSyncModeRef.current();

		// 清理函数
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refreshLastSyncTime, cloudSyncStore.autoSyncSettings]); // 添加依赖

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
		const initializeAutoSync = async () => {
			if (connectionStatus === "success") {
				// 从后端读取配置检查是否有效
				const { getServerConfig } = await import("@/plugins/webdav");
				const config = await getServerConfig();

				if (config?.url) {
					try {
						if (autoSyncEnabled) {
							await autoSync.initialize({
								enabled: true,
								intervalHours: syncInterval,
							});
						} else {
							await autoSync.setEnabled(false);
						}
					} catch (error) {
						console.error("❌ CloudSync: 自动同步初始化失败:", error);
					}
				}
			}
		};

		initializeAutoSync();
	}, [connectionStatus, autoSyncEnabled, syncInterval]); // 移除对全局store的依赖

	// 配置同步初始化
	useEffect(() => {
		if (connectionStatus === "success") {
			const initializeConfigSync = async () => {
				try {
					// 从后端读取配置
					const { getServerConfig } = await import("@/plugins/webdav");
					const config = await getServerConfig();

					if (config?.url) {
						configSync.initialize(config);
					}
				} catch (error) {
					console.error("配置同步初始化失败:", error);
				}
			};

			initializeConfigSync();
		}
	}, [connectionStatus]);

	// 保存服务器配置
	const saveServerConfig = async (config: WebDAVConfig) => {
		try {
			// 通过后端API保存配置
			const { setServerConfig } = await import("@/plugins/webdav");
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
			// 从后端读取WebDAV配置
			const { getServerConfig } = await import("@/plugins/webdav");
			const backendConfig = await getServerConfig();

			if (!backendConfig) {
				appMessage.error(t("preference.cloud_sync.webdav_config_empty"));
				setConnectionStatus("failed");
				return;
			}
			const result = await testConnection(backendConfig);
			if (result.success) {
				setConnectionStatus("success");
				appMessage.success(t("preference.cloud_sync.connection_success"));
			} else {
				setConnectionStatus("failed");
				appMessage.error(t("preference.cloud_sync.connection_failed"));
			}
		} catch (_error) {
			setConnectionStatus("failed");
			appMessage.error(t("preference.cloud_sync.connection_test_failed"));
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

			// 保存配置到本地
			const saved = await saveServerConfig(config);
			if (!saved) {
				appMessage.error(t("preference.cloud_sync.save_failed"));
				return;
			}

			// 自动测试连接并初始化同步引擎
			await validateConnectionStatus(config);
		} catch (error) {
			setConnectionStatus("failed");
			appMessage.error(t("preference.cloud_sync.save_failed"));
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
			appMessage.error(t("preference.cloud_sync.check_network_first"));
			return;
		}

		// 从后端读取WebDAV配置并检查是否有效
		const { getServerConfig } = await import("@/plugins/webdav");
		const config = await getServerConfig();

		if (!config || !config.url || !config.username || !config.password) {
			appMessage.error(t("preference.cloud_sync.config_incomplete"));
			return;
		}

		setIsSyncing(true);

		try {
			// 确保同步引擎已初始化配置
			await syncEngine.initialize(config);

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

				// 显示简洁的成功消息
				const totalChanges =
					syncResult.downloaded + syncResult.uploaded + syncResult.deleted;

				let successMessage: string;
				if (totalChanges === 0) {
					successMessage = t("preference.cloud_sync.already_up_to_date");
				} else {
					successMessage = t("preference.cloud_sync.updated_items", {
						0: totalChanges,
					});
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
			appMessage.error(t("preference.cloud_sync.sync_failed"));
		} finally {
			setIsSyncing(false);
		}
	};

	// 处理自动同步开关
	const handleAutoSyncToggle = async (enabled: boolean) => {
		setAutoSyncEnabled(enabled);
		try {
			// 直接更新globalStore
			globalStore.cloudSync.autoSyncSettings.enabled = enabled;

			if (enabled) {
				// 使用新的后端自动同步API
				await autoSync.initialize({
					enabled: true,
					intervalHours: syncInterval,
				});
				appMessage.success(t("preference.cloud_sync.auto_sync_enabled"));
			} else {
				// 停止后端定时器
				await autoSync.setEnabled(false);
				appMessage.info(t("preference.cloud_sync.auto_sync_disabled"));
			}
		} catch (error) {
			console.error("自动同步操作失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			// 回滚UI状态
			setAutoSyncEnabled(!enabled);
			globalStore.cloudSync.autoSyncSettings.enabled = !enabled;
			appMessage.error(t("preference.cloud_sync.auto_sync_operation_failed"));
		}
	};

	// 上传本地配置
	const handleUploadConfig = async () => {
		if (isConfigSyncing) return;

		if (connectionStatus !== "success") {
			appMessage.error(t("preference.cloud_sync.check_network_first"));
			return;
		}

		setIsConfigSyncing(true);
		try {
			const result = await configSync.uploadLocalConfig();
			if (result.success) {
				appMessage.success(result.message);
			} else {
				appMessage.error(result.message);
			}
		} catch (error) {
			console.error("上传配置失败", error);
			appMessage.error(t("preference.cloud_sync.upload_config_failed"));
		} finally {
			setIsConfigSyncing(false);
		}
	};

	// 应用云端配置
	const handleApplyRemoteConfig = async () => {
		if (isConfigSyncing) return;

		if (connectionStatus !== "success") {
			appMessage.error(t("preference.cloud_sync.check_network_first"));
			return;
		}

		// 确认对话框
		modal.confirm({
			title: t("preference.cloud_sync.apply_cloud_config_confirm_title"),
			content: t("preference.cloud_sync.apply_cloud_config_confirm_content"),
			okText: t("preference.cloud_sync.confirm"),
			cancelText: t("preference.cloud_sync.cancel"),
			onOk: async () => {
				setIsConfigSyncing(true);
				try {
					const result = await configSync.applyRemoteConfig();
					if (result.success) {
						appMessage.success(result.message);
						// 提示用户重启应用以完全应用配置
						setTimeout(() => {
							appMessage.info(
								t("preference.cloud_sync.restart_app_suggestion"),
							);
						}, 1000);
					} else {
						appMessage.error(result.message);
					}
				} catch (error) {
					console.error("应用配置失败", error);
					appMessage.error(t("preference.cloud_sync.apply_config_failed"));
				} finally {
					setIsConfigSyncing(false);
				}
			},
		});
	};

	// 处理同步间隔变更
	const handleSyncIntervalChange = async (hours: SyncInterval) => {
		const oldInterval = syncInterval;
		setSyncInterval(hours);

		// 直接更新globalStore
		globalStore.cloudSync.autoSyncSettings.intervalHours = hours;

		if (autoSyncEnabled) {
			try {
				// 使用新的后端API更新间隔
				await autoSync.setIntervalHours(hours);
				appMessage.success(t("preference.cloud_sync.sync_interval_updated"));
			} catch (error) {
				console.error("更新同步间隔失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				// 回滚状态
				setSyncInterval(oldInterval);
				globalStore.cloudSync.autoSyncSettings.intervalHours = oldInterval;
				appMessage.error(t("preference.cloud_sync.update_interval_failed"));
			}
		}
	};

	// 开发环境专用：重置配置文件
	const handleResetConfig = async () => {
		modal.confirm({
			title: "重置配置文件",
			content:
				"确定要重置所有配置吗？这将删除本地配置文件并恢复到初始设置，模拟软件重新安装。此操作无法撤销。",
			okText: "确定",
			cancelText: "取消",
			okType: "danger",
			onOk: async () => {
				try {
					const { getSaveStorePath } = await import("@/utils/path");
					const { remove } = await import("@tauri-apps/plugin-fs");

					// 删除本地配置文件
					const configPath = await getSaveStorePath();
					await remove(configPath);

					// 重新加载配置（会使用默认配置）
					const { restoreStore } = await import("@/utils/store");
					await restoreStore();

					appMessage.success("配置已重置，建议重启应用");
				} catch (error) {
					console.error("重置配置失败:", error);
					appMessage.error("操作失败");
				}
			},
		});
	};

	// 开发环境专用：重置数据库
	const handleResetDatabase = async () => {
		modal.confirm({
			title: "重置数据库",
			content:
				"确定要重置数据库吗？这将清空所有剪贴板历史数据并重新创建数据库。此操作无法撤销。",
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

	// 开发环境专用：显示数据库信息
	const handleShowDatabaseInfo = async () => {
		try {
			const dbInfo = await getDatabaseInfo();
			if (dbInfo) {
				console.group("📊 数据库信息");
				console.info("=== 基本统计 ===");
				console.info("总记录数:", dbInfo.totalCount);
				console.info("活跃记录数:", dbInfo.activeCount);
				console.info("已删除记录数:", dbInfo.deletedCount);
				console.info("收藏记录数:", dbInfo.favoriteCount);
				console.info("数据库文件大小:", dbInfo.dbSize);

				console.info("\n=== 类型分布 ===");
				for (const [type, count] of Object.entries(dbInfo.typeCounts)) {
					console.info(`${type}: ${count} 条`);
				}

				console.info("\n=== 同步状态分布 ===");
				for (const [status, count] of Object.entries(dbInfo.syncStatusCounts)) {
					console.info(`${status}: ${count} 条`);
				}

				console.info("\n=== 最近10条记录 ===");
				for (const [index, record] of dbInfo.recentRecords.entries()) {
					const sourceInfo = record.sourceAppName
						? ` 来源: ${record.sourceAppName}${record.sourceAppIcon ? " [有图标]" : ""}`
						: " 无来源信息";

					console.info(
						`#${index + 1} [${record.type}] ${record.createTime} - ${record.value} (收藏: ${record.favorite}, 同步: ${record.syncStatus}, 云端: ${record.isCloudData}${sourceInfo})`,
					);
				}

				console.groupEnd();

				appMessage.success("数据库信息已打印到控制台");
			} else {
				appMessage.error("获取数据库信息失败");
			}
		} catch (error) {
			console.error("显示数据库信息失败:", error);
			appMessage.error("操作失败");
		}
	};

	return (
		<>
			{modalContextHolder}
			{/* 服务器配置 */}
			<ProList header={t("preference.cloud_sync.server_config")}>
				<Form
					form={form}
					layout="vertical"
					onFinish={handleConfigSubmit}
					initialValues={{ path: "/EcoPaste-Sync", ...webdavConfig }}
				>
					{/* 服务器地址 */}
					<ProListItem title={t("preference.cloud_sync.server_address")}>
						<Form.Item
							name="url"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="https://webdav/sync" />
						</Form.Item>
					</ProListItem>

					{/* 用户名 */}
					<ProListItem title={t("preference.cloud_sync.username")}>
						<Form.Item
							name="username"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="username" />
						</Form.Item>
					</ProListItem>

					{/* 密码 */}
					<ProListItem title={t("preference.cloud_sync.password")}>
						<Form.Item
							name="password"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input.Password placeholder="password" />
						</Form.Item>
					</ProListItem>

					{/* 同步路径 */}
					<ProListItem title={t("preference.cloud_sync.sync_path")}>
						<Form.Item
							name="path"
							style={{ margin: 0, minWidth: 300, maxWidth: 400 }}
						>
							<Input placeholder="/path" />
						</Form.Item>
					</ProListItem>

					{/* 操作按钮 */}
					<ProListItem
						title={
							connectionStatus !== "idle" ? (
								<Alert
									message={
										connectionStatus === "testing"
											? t("preference.cloud_sync.testing_connection")
											: connectionStatus === "success"
												? t("preference.cloud_sync.connection_success")
												: t("preference.cloud_sync.connection_failed")
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
								{t("preference.cloud_sync.test_connection")}
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
								{t("preference.cloud_sync.save_config")}
							</Button>
						</Flex>
					</ProListItem>
				</Form>
			</ProList>

			{/* 数据同步 */}
			<ProList header={t("preference.cloud_sync.data_sync")}>
				{/* 收藏模式 */}
				<ProListItem
					title={t("preference.cloud_sync.favorite_mode")}
					description={t("preference.cloud_sync.favorite_mode_desc")}
				>
					<Switch
						checked={syncModeConfig.settings.onlyFavorites}
						onChange={handleFavoritesModeChange}
					/>
				</ProListItem>

				{/* 文件模式 */}
				<ProListItem
					title={t("preference.cloud_sync.file_mode")}
					description={t("preference.cloud_sync.file_mode_desc")}
				>
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
										{t("preference.cloud_sync.file_limit")}
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
				<ProListItem
					title={t("preference.cloud_sync.auto_sync")}
					description={t("preference.cloud_sync.auto_sync_desc")}
				>
					<Flex vertical gap={8} align="flex-end">
						<Switch checked={autoSyncEnabled} onChange={handleAutoSyncToggle} />
						{autoSyncEnabled && (
							<Select
								value={syncInterval}
								onChange={handleSyncIntervalChange}
								style={{ width: 120 }}
							>
								<Select.Option value={1}>
									{t("preference.cloud_sync.1_hour")}
								</Select.Option>
								<Select.Option value={2}>
									{t("preference.cloud_sync.2_hours")}
								</Select.Option>
								<Select.Option value={6}>
									{t("preference.cloud_sync.6_hours")}
								</Select.Option>
								<Select.Option value={12}>
									{t("preference.cloud_sync.12_hours")}
								</Select.Option>
								<Select.Option value={24}>
									{t("preference.cloud_sync.1_day")}
								</Select.Option>
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
									{t("preference.cloud_sync.last_sync")}
									{(() => {
										if (!lastSyncTime || lastSyncTime === 0) return "";

										const date = new Date(lastSyncTime);
										const now = new Date();
										const diffMs = now.getTime() - date.getTime();
										const diffMins = Math.floor(diffMs / (1000 * 60));
										const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
										const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

										if (diffMins < 1) {
											return t("preference.cloud_sync.just_now");
										}
										if (diffMins < 60) {
											return `${diffMins}${t("preference.cloud_sync.minutes_ago")}`;
										}
										if (diffHours < 24) {
											return `${diffHours}${t("preference.cloud_sync.hours_ago")}`;
										}
										if (diffDays < 7) {
											return `${diffDays}${t("preference.cloud_sync.days_ago")}`;
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
							{t("preference.cloud_sync.sync_now")}
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
							{t("preference.cloud_sync.sync_now")}
						</Button>
					</div>
				)}
			</ProList>

			{/* 配置同步 */}
			<ProList header={t("preference.cloud_sync.config_sync")}>
				<ProListItem
					title={t("preference.cloud_sync.upload_config")}
					description={t("preference.cloud_sync.upload_config_desc")}
				>
					<Button
						type="default"
						icon={<UploadOutlined />}
						loading={isConfigSyncing}
						onClick={handleUploadConfig}
						disabled={connectionStatus !== "success"}
					>
						{t("preference.cloud_sync.upload_config")}
					</Button>
				</ProListItem>

				<ProListItem
					title={t("preference.cloud_sync.apply_remote_config")}
					description={t("preference.cloud_sync.apply_remote_config_desc")}
				>
					<Button
						type="default"
						icon={<DownloadOutlined />}
						loading={isConfigSyncing}
						onClick={handleApplyRemoteConfig}
						disabled={connectionStatus !== "success"}
					>
						{t("preference.cloud_sync.apply_remote_config")}
					</Button>
				</ProListItem>
			</ProList>

			{/* 开发环境专用：数据库管理工具 */}
			{isDev() && (
				<ProList header="开发工具（仅限开发环境）">
					<ProListItem
						title="重置数据库"
						description="清空所有剪贴板历史数据并重新创建数据库，强制删除避免锁定"
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

					<ProListItem
						title="重置配置文件"
						description="删除本地配置文件并恢复初始设置，模拟软件重新安装"
					>
						<Button
							type="primary"
							danger
							size="small"
							icon={<DeleteOutlined />}
							onClick={handleResetConfig}
						>
							重置配置文件
						</Button>
					</ProListItem>

					<ProListItem
						title="显示数据库信息"
						description="在控制台打印数据库条目数量和每条数据的关键信息"
					>
						<Button
							type="primary"
							size="small"
							icon={<InfoCircleOutlined />}
							onClick={handleShowDatabaseInfo}
						>
							显示数据库信息
						</Button>
					</ProListItem>
				</ProList>
			)}
		</>
	);
};

export default CloudSync;
