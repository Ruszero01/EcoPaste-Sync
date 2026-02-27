import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { LISTEN_KEY } from "@/constants";
import * as backendDatabase from "@/plugins/database";
import * as backendSync from "@/plugins/sync";
import { globalStore } from "@/stores/global";
import type { SyncModeConfig } from "@/types/sync.d";
import { isDev } from "@/utils/is";
import { invoke } from "@tauri-apps/api/core";

// WebDAV配置类型（与后端 BackendSyncConfig 对应）
type WebDAVConfig = {
	url: string;
	username: string;
	password: string;
	path: string;
	timeout: number;
};

// 获取默认配置（与后端对齐）
const getDefaultSyncModeConfig = (): SyncModeConfig => {
	return {
		autoSync: false,
		autoSyncIntervalMinutes: 60,
		onlyFavorites: false,
		includeImages: false,
		includeFiles: false,
		includeBookmarks: false,
		contentTypes: {
			includeText: true,
			includeHtml: true,
			includeRtf: true,
			includeMarkdown: true,
		},
		conflictResolution: "local",
		deviceId: "",
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
	const [lastSyncTime, setLastSyncTime] = useState<number>(() => {
		try {
			const saved = localStorage.getItem("ecopaste-last-sync-time");
			return saved ? Number.parseInt(saved, 10) : 0;
		} catch {
			return 0;
		}
	});
	const [renderKey, setRenderKey] = useState(0); // 用于强制重新渲染
	const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
	const [syncInterval, setSyncInterval] = useState(60); // 默认60分钟
	const [syncModeConfig, setSyncModeConfig] = useState<SyncModeConfig>(
		getDefaultSyncModeConfig(),
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

	// 从后端获取同步状态（统一状态管理）
	const fetchBackendSyncStatus = useCallback(async () => {
		try {
			const status = await backendSync.backendGetSyncStatus();
			// 处理 null 值（Rust 的 Option<u64> 序列化为 null）
			const syncTime = status?.last_sync_time ?? 0;
			if (syncTime > 0) {
				setLastSyncTime(syncTime);
				// 持久化同步时间
				saveLastSyncTime(syncTime);
			}
			// 更新同步状态
			setIsSyncing(status?.is_syncing || false);
		} catch (error) {
			console.warn("获取后端同步状态失败:", error);
		}
	}, [saveLastSyncTime]);

	// 加载同步模式配置
	const loadSyncMode = useCallback(() => {
		try {
			// 从globalStore读取同步模式配置
			const storeSyncModeConfig = cloudSyncStore.syncModeConfig;

			// 转换为SyncModeConfig格式（与后端对齐）
			const config: SyncModeConfig = {
				autoSync: cloudSyncStore.autoSyncSettings.enabled,
				autoSyncIntervalMinutes:
					cloudSyncStore.autoSyncSettings.intervalHours * 60,
				onlyFavorites: storeSyncModeConfig.settings.onlyFavorites,
				includeImages: storeSyncModeConfig.settings.includeImages,
				includeFiles: storeSyncModeConfig.settings.includeFiles,
				includeBookmarks: storeSyncModeConfig.settings.includeBookmarks,
				contentTypes: {
					includeText: storeSyncModeConfig.settings.includeText,
					includeHtml: storeSyncModeConfig.settings.includeHtml,
					includeRtf: storeSyncModeConfig.settings.includeRtf,
					includeMarkdown: storeSyncModeConfig.settings.includeMarkdown,
				},
				conflictResolution: "local",
				deviceId: "",
			};

			setSyncModeConfig(config);
		} catch (error) {
			console.error("加载同步模式配置失败:", error);
			// 发生错误时使用默认配置
			const defaultConfig = getDefaultSyncModeConfig();
			setSyncModeConfig(defaultConfig);
		}
	}, [cloudSyncStore.syncModeConfig, cloudSyncStore.autoSyncSettings]);

	// 服务器配置状态
	const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig | null>(null);

	// 从单独文件加载服务器配置（不参与云同步）
	const loadServerConfig = useCallback(async () => {
		try {
			// 从单独文件加载服务器配置
			const serverData = await backendSync.backendLoadServerConfig();

			if (serverData.url) {
				const webdavConfig: WebDAVConfig = {
					url: serverData.url,
					username: serverData.username,
					password: serverData.password,
					path: serverData.path,
					timeout: serverData.timeout,
				};
				setWebdavConfig(webdavConfig);
				form.setFieldsValue(webdavConfig);

				// 更新全局状态
				globalStore.cloudSync.serverConfig = {
					url: serverData.url,
					username: serverData.username,
					password: serverData.password,
					path: serverData.path,
					timeout: serverData.timeout,
				};

				// 检查后端同步引擎是否已初始化
				try {
					await backendSync.backendGetSyncStatus();
					setConnectionStatus("success");
				} catch {
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
	}, [form, appMessage.error, t]);

	// 处理收藏模式开关变更（使用防抖优化）
	const handleFavoritesModeChange = useCallback(
		async (enabled: boolean) => {
			try {
				// 检查状态是否已经相同，避免不必要的更新
				if (syncModeConfig.onlyFavorites === enabled) {
					return;
				}

				const currentConfig = syncModeConfig;
				const newConfig = {
					...currentConfig,
					onlyFavorites: enabled,
				};

				// 直接更新globalStore中的同步模式配置（双开关模式）
				globalStore.cloudSync.syncModeConfig = {
					settings: {
						includeText: newConfig.contentTypes.includeText,
						includeHtml: newConfig.contentTypes.includeHtml,
						includeRtf: newConfig.contentTypes.includeRtf,
						includeMarkdown: newConfig.contentTypes.includeMarkdown,
						includeImages: newConfig.includeImages,
						includeFiles: newConfig.includeFiles,
						onlyFavorites: enabled,
						includeBookmarks: newConfig.includeBookmarks,
					},
				};

				// 更新组件状态
				setSyncModeConfig(newConfig);

				// 更新后端同步配置
				if (connectionStatus === "success" && webdavConfig) {
					try {
						await backendSync.backendUpdateSyncConfig({
							server_url: webdavConfig.url,
							username: webdavConfig.username,
							password: webdavConfig.password,
							path: webdavConfig.path,
							auto_sync: autoSyncEnabled,
							auto_sync_interval_minutes: syncInterval,
							only_favorites: enabled,
							include_images: newConfig.includeImages,
							include_files: newConfig.includeFiles,
							include_bookmarks: newConfig.includeBookmarks,
							timeout: 30000,
						});
					} catch (updateError) {
						console.error("更新后端配置失败:", updateError);
						// 不阻断UI更新，只记录错误
					}
				}

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
		[
			syncModeConfig,
			connectionStatus,
			webdavConfig,
			autoSyncEnabled,
			syncInterval,
			appMessage,
			t,
		],
	);

	// 处理文件模式开关变更（新版本：文件模式 = 包含图片和文件）
	const handleFileModeChange = useCallback(
		async (enabled: boolean) => {
			try {
				// 检查是否真的需要变更（避免重复操作）
				const currentMode =
					syncModeConfig.includeImages && syncModeConfig.includeFiles;
				if (currentMode === enabled) {
					return; // 状态未变化，直接返回
				}

				const currentConfig = syncModeConfig;
				const newConfig = {
					...currentConfig,
					includeImages: enabled,
					includeFiles: enabled,
				};

				// 直接更新globalStore中的同步模式配置（双开关模式）
				globalStore.cloudSync.syncModeConfig = {
					settings: {
						includeText: newConfig.contentTypes.includeText,
						includeHtml: newConfig.contentTypes.includeHtml,
						includeRtf: newConfig.contentTypes.includeRtf,
						includeMarkdown: newConfig.contentTypes.includeMarkdown,
						includeImages: enabled,
						includeFiles: enabled,
						onlyFavorites: newConfig.onlyFavorites,
						includeBookmarks: newConfig.includeBookmarks,
					},
				};

				// 更新组件状态
				setSyncModeConfig(newConfig);

				// 更新后端同步配置
				if (connectionStatus === "success" && webdavConfig) {
					try {
						await backendSync.backendUpdateSyncConfig({
							server_url: webdavConfig.url,
							username: webdavConfig.username,
							password: webdavConfig.password,
							path: webdavConfig.path,
							auto_sync: autoSyncEnabled,
							auto_sync_interval_minutes: syncInterval,
							only_favorites: newConfig.onlyFavorites,
							include_images: enabled,
							include_files: enabled,
							include_bookmarks: newConfig.includeBookmarks,
							timeout: 30000,
						});
					} catch (updateError) {
						console.error("更新后端配置失败:", updateError);
						// 不阻断UI更新，只记录错误
					}
				}

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
		[
			syncModeConfig,
			connectionStatus,
			webdavConfig,
			autoSyncEnabled,
			syncInterval,
			appMessage,
			t,
		],
	);

	// 处理书签同步开关变更
	const handleBookmarkSyncChange = useCallback(
		async (enabled: boolean) => {
			try {
				// 检查状态是否已经相同，避免不必要的更新
				if (syncModeConfig.includeBookmarks === enabled) {
					return;
				}

				const currentConfig = syncModeConfig;
				const newConfig = {
					...currentConfig,
					includeBookmarks: enabled,
				};

				// 直接更新globalStore中的同步模式配置
				globalStore.cloudSync.syncModeConfig = {
					settings: {
						includeText: newConfig.contentTypes.includeText,
						includeHtml: newConfig.contentTypes.includeHtml,
						includeRtf: newConfig.contentTypes.includeRtf,
						includeMarkdown: newConfig.contentTypes.includeMarkdown,
						includeImages: newConfig.includeImages,
						includeFiles: newConfig.includeFiles,
						onlyFavorites: newConfig.onlyFavorites,
						includeBookmarks: enabled,
					},
				};

				// 更新组件状态
				setSyncModeConfig(newConfig);

				// 更新后端同步配置
				if (connectionStatus === "success" && webdavConfig) {
					try {
						await backendSync.backendUpdateSyncConfig({
							server_url: webdavConfig.url,
							username: webdavConfig.username,
							password: webdavConfig.password,
							path: webdavConfig.path,
							auto_sync: autoSyncEnabled,
							auto_sync_interval_minutes: syncInterval,
							only_favorites: newConfig.onlyFavorites,
							include_images: newConfig.includeImages,
							include_files: newConfig.includeFiles,
							include_bookmarks: enabled,
							timeout: 30000,
						});
					} catch (updateError) {
						console.error("更新后端配置失败:", updateError);
					}
				}

				appMessage.success(
					enabled
						? t("preference.cloud_sync.bookmark_sync_enabled")
						: t("preference.cloud_sync.bookmark_sync_disabled"),
				);
			} catch (error) {
				console.error("处理书签同步变更失败:", error);
				appMessage.error(t("preference.cloud_sync.update_config_failed"));
			}
		},
		[
			syncModeConfig,
			connectionStatus,
			webdavConfig,
			autoSyncEnabled,
			syncInterval,
			appMessage,
			t,
		],
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

		// 从后端获取同步状态（统一状态管理）
		fetchBackendSyncStatus();

		// 加载自动同步状态
		try {
			// 从globalStore读取自动同步设置
			const autoSyncSettings = cloudSyncStore.autoSyncSettings;
			setAutoSyncEnabled(autoSyncSettings.enabled);
			setSyncInterval(autoSyncSettings.intervalHours * 60); // 转换为分钟

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
	}, [fetchBackendSyncStatus, cloudSyncStore.autoSyncSettings]);

	// 监听页面可见性变化，当页面重新可见时刷新同步状态
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				// 从后端获取最新的同步状态
				fetchBackendSyncStatus();
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
	}, [fetchBackendSyncStatus]);

	// 保存服务器配置到单独文件（不参与云同步）
	const saveServerConfig = async (config: WebDAVConfig) => {
		try {
			// 保存到全局状态
			globalStore.cloudSync.serverConfig = {
				url: config.url,
				username: config.username,
				password: config.password,
				path: config.path,
				timeout: config.timeout,
			};

			// 持久化到主配置文件（同步设置等）
			const { saveStore } = await import("@/utils/store");
			await saveStore();

			// 保存服务器配置到单独文件
			const result = await backendSync.backendSaveServerConfig({
				url: config.url,
				username: config.username,
				password: config.password,
				path: config.path,
				timeout: config.timeout,
			});

			if ("type" in result && result.type === "Error") {
				console.error("保存服务器配置失败:", result.data);
				return false;
			}

			// 通知后端重新加载配置
			try {
				await invoke("plugin:eco-sync|reload_config_from_file");
			} catch (reloadError) {
				console.warn("通知后端重新加载配置失败:", reloadError);
			}

			return true;
		} catch (error) {
			console.error("保存配置失败", {
				error: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	// 测试WebDAV连接 - 使用后端API
	const testWebDAVConnection = async () => {
		if (
			!webdavConfig?.url ||
			!webdavConfig?.username ||
			!webdavConfig?.password
		) {
			appMessage.warning(t("preference.cloud_sync.please_fill_server_config"));
			return;
		}

		setConnectionStatus("testing");
		try {
			// 使用后端API测试连接（后端使用已初始化的同步引擎）
			const result = await backendSync.backendTestWebdavConnection();

			if (result.success) {
				setConnectionStatus("success");

				// 初始化后端同步引擎
				const syncConfig = {
					server_url: webdavConfig.url,
					username: webdavConfig.username,
					password: webdavConfig.password,
					path: webdavConfig.path || "/EcoPaste-Sync",
					auto_sync: autoSyncEnabled,
					auto_sync_interval_minutes: syncInterval,
					only_favorites: syncModeConfig.onlyFavorites,
					include_images: syncModeConfig.includeImages,
					include_files: syncModeConfig.includeFiles,
					timeout: 30000,
				};
				await backendSync.backendInitSync(syncConfig);

				appMessage.success(
					`${t("preference.cloud_sync.connection_success")} (延迟: ${result.latency_ms}ms)`,
				);
			} else {
				setConnectionStatus("failed");

				appMessage.error(
					t("preference.cloud_sync.connection_failed") +
						(result.error_message ? `: ${result.error_message}` : ""),
				);
			}
		} catch (error) {
			setConnectionStatus("failed");

			console.error("❌ 连接测试异常", {
				error: error instanceof Error ? error.message : String(error),
			});
			appMessage.error(t("preference.cloud_sync.connection_test_failed"));
		}
	};

	// 处理表单提交 - 先保存配置，不自动测试连接
	const handleConfigSubmit = async (values: any) => {
		setIsConfigLoading(true);
		try {
			// 确保包含默认超时时间
			const config: WebDAVConfig = {
				...values,
				timeout: 60000, // 增加默认超时时间到60秒
			};

			// 保存配置到本地
			const saved = await saveServerConfig(config);
			if (!saved) {
				appMessage.error(t("preference.cloud_sync.save_failed"));
				return;
			}

			// 更新前端状态，确保测试连接能获取到最新配置
			setWebdavConfig(config);

			// 通知后端重新加载配置
			try {
				await invoke("plugin:eco-sync|reload_config_from_file");
			} catch (reloadError) {
				// 后端可能还没有这个命令，静默处理
				console.warn("通知后端重新加载配置失败:", reloadError);
			}

			appMessage.success(t("preference.cloud_sync.config_saved"));
		} catch (error) {
			setConnectionStatus("failed");
			appMessage.error(t("preference.cloud_sync.save_failed"));
			// 详细打印错误信息
			console.error("❌ 配置处理失败", {
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
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

		setIsSyncing(true);

		try {
			// 使用后端同步引擎触发同步
			const result = await backendSync.backendTriggerSync();

			if (result?.success) {
				// 从后端获取最新的同步状态
				await fetchBackendSyncStatus();

				appMessage.success(result.message || "同步成功");

				// 触发界面刷新，确保列表显示最新数据
				try {
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
				} catch (_error) {
					// 静默处理刷新失败
				}
			} else {
				throw new Error(result?.message || "同步失败");
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
				// 使用后端自动同步API
				await backendSync.backendStartAutoSync(syncInterval);
				appMessage.success(t("preference.cloud_sync.auto_sync_enabled"));
			} else {
				// 停止后端自动同步
				await backendSync.backendStopAutoSync();
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
		if (connectionStatus !== "success") {
			appMessage.error(t("preference.cloud_sync.check_network_first"));
			return;
		}

		try {
			const result = await backendSync.backendUploadLocalConfig();
			if (result.success) {
				appMessage.success(t("preference.cloud_sync.upload_config_success"));
			} else {
				appMessage.error(
					result.message || t("preference.cloud_sync.upload_config_failed"),
				);
			}
		} catch (error) {
			console.error("上传配置失败", error);
			appMessage.error(t("preference.cloud_sync.upload_config_failed"));
		}
	};

	// 应用云端配置
	const handleApplyRemoteConfig = async () => {
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
				try {
					const result = await backendSync.backendApplyRemoteConfig();
					if (result.success) {
						appMessage.success(t("preference.cloud_sync.apply_config_success"));
					} else {
						appMessage.error(
							result.message || t("preference.cloud_sync.apply_config_failed"),
						);
					}
				} catch (error) {
					console.error("应用配置失败", error);
					appMessage.error(t("preference.cloud_sync.apply_config_failed"));
				}
			},
		});
	};

	// 处理同步间隔变更
	const handleSyncIntervalChange = async (minutes: number) => {
		const oldInterval = syncInterval;
		setSyncInterval(minutes);

		// 直接更新globalStore（转换为小时）
		globalStore.cloudSync.autoSyncSettings.intervalHours = minutes / 60;

		if (autoSyncEnabled) {
			try {
				// 使用后端API更新间隔
				await backendSync.backendUpdateAutoSyncInterval(minutes);
				appMessage.success(t("preference.cloud_sync.sync_interval_updated"));
			} catch (error) {
				console.error("更新同步间隔失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				// 回滚状态
				setSyncInterval(oldInterval);
				globalStore.cloudSync.autoSyncSettings.intervalHours = oldInterval / 60;
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
					const success = await backendDatabase.backendResetDatabase();
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
			const dbInfo = await backendDatabase.backendGetDatabaseInfo();
			if (dbInfo) {
				console.group("📊 数据库信息");
				console.info("=== 基本统计 ===");
				console.info("总记录数:", dbInfo.total_count);
				console.info("活跃记录数:", dbInfo.active_count);
				console.info("已删除记录数:", dbInfo.deleted_count);
				console.info("收藏记录数:", dbInfo.favorite_count);

				console.info("\n=== 类型分布 ===");
				for (const [type, count] of Object.entries(dbInfo.type_counts)) {
					console.info(`${type}: ${count} 条`);
				}

				console.info("\n=== 同步状态分布 ===");
				for (const [status, count] of Object.entries(
					dbInfo.sync_status_counts,
				)) {
					console.info(`${status}: ${count} 条`);
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
						checked={syncModeConfig.onlyFavorites}
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
								syncModeConfig.includeImages && syncModeConfig.includeFiles
							}
							onChange={handleFileModeChange}
						/>
						{syncModeConfig.includeImages && syncModeConfig.includeFiles && (
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

				{/* 书签同步 */}
				<ProListItem
					title={t("preference.cloud_sync.bookmark_sync")}
					description={t("preference.cloud_sync.bookmark_sync_desc")}
				>
					<Switch
						checked={syncModeConfig.includeBookmarks}
						onChange={handleBookmarkSyncChange}
					/>
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
								<Select.Option value={60}>
									{t("preference.cloud_sync.1_hour")}
								</Select.Option>
								<Select.Option value={120}>
									{t("preference.cloud_sync.2_hours")}
								</Select.Option>
								<Select.Option value={360}>
									{t("preference.cloud_sync.6_hours")}
								</Select.Option>
								<Select.Option value={720}>
									{t("preference.cloud_sync.12_hours")}
								</Select.Option>
								<Select.Option value={1440}>
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

										const date = new Date(lastSyncTime * 1000); // 转换为毫秒
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
