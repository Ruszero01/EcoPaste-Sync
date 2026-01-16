import { useShortcutSubscription } from "@/hooks/useShortcutSubscription";
import { hideWindow } from "@/plugins/window";
import { HappyProvider } from "@ant-design/happy-work-theme";
import { error } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import { isString } from "lodash-es";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { useSnapshot } from "valtio";

const { defaultAlgorithm, darkAlgorithm } = theme;

const App = () => {
	const { appearance } = useSnapshot(globalStore);
	const { restoreState } = useWindowState();
	const [ready, { toggle }] = useBoolean();

	useMount(async () => {
		await restoreState();

		await restoreStore();

		toggle();

		// 生成 antd 的颜色变量
		generateColorVars();

		// 初始化托盘 - 使用更强的防护机制
		// TODO: 临时注释掉托盘，测试 WebView2 进程能否正常关闭
		// 后续托盘需要迁移到后端实现
		/*
		try {
			const { TrayIcon } = await import("@tauri-apps/api/tray");

			// 先检查是否已存在托盘
			const existingTray = await TrayIcon.getById("app-tray");
			if (existingTray) {
				return;
			}

			// 只有在没有托盘时才创建
			await createTray();
		} catch (error) {
			console.error("托盘初始化失败:", error);
		}
		*/
	});

	// 监听快捷键变化并自动重新注册
	const unsubscribeShortcuts = useShortcutSubscription();

	// 组件卸载时清理订阅
	useEffect(() => {
		return unsubscribeShortcuts;
	}, [unsubscribeShortcuts]);

	// 监听语言的变化
	useImmediateKey(globalStore.appearance, "language", (language) => {
		if (typeof language === "string") {
			i18n.changeLanguage(language);
		}
	});

	// 监听是否是暗黑模式
	useImmediateKey(globalStore.appearance, "isDark", (value) => {
		if (value) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	});

	// 数据库插件现在由后端自动管理，无需手动关闭

	// 链接跳转到系统浏览器
	useEventListener("click", (event) => {
		const link = (event.target as HTMLElement).closest("a");

		if (!link) return;

		const { href, target } = link;

		if (target === "_blank") return;

		event.preventDefault();

		if (!isURL(href)) return;

		openUrl(href);
	});

	// 隐藏窗口
	useKeyPress(["esc", PRESET_SHORTCUT.HIDE_WINDOW], () => {
		hideWindow("main");
	});

	// 监听 promise 的错误，输出到日志
	useEventListener("unhandledrejection", ({ reason }) => {
		const message = isString(reason) ? reason : JSON.stringify(reason);

		error(message);
	});

	// 自定义亮色主题配置，减少过白的色调
	const lightThemeConfig = {
		algorithm: defaultAlgorithm,
		token: {
			colorBgBase: "#f5f5f5", // 基础背景色，从纯白改为浅灰
			colorBgContainer: "#ffffff", // 容器背景保持白色但稍微柔和
			colorBgElevated: "#ffffff", // 浮层背景
			colorBgLayout: "#f5f5f5", // 布局背景
			colorText: "#262626", // 文字颜色，使用更深的灰色
			colorTextSecondary: "#595959", // 次要文字颜色
			colorBorder: "#d9d9d9", // 边框颜色
			colorBorderSecondary: "#f0f0f0", // 次要边框颜色
		},
	};

	return (
		<ConfigProvider
			locale={getAntdLocale(appearance.language)}
			theme={{
				algorithm: appearance.isDark
					? darkAlgorithm
					: lightThemeConfig.algorithm,
				token: appearance.isDark ? undefined : lightThemeConfig.token,
			}}
		>
			<AntdApp>
				<HappyProvider>
					{ready && <RouterProvider router={router} />}
				</HappyProvider>
			</AntdApp>
		</ConfigProvider>
	);
};

export default App;
