import { hideWindow } from "@/plugins/window";
import { HappyProvider } from "@ant-design/happy-work-theme";
import { error } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import { isString } from "lodash-es";
import { RouterProvider } from "react-router-dom";
import { useSnapshot } from "valtio";

const { defaultAlgorithm, darkAlgorithm } = theme;

// 初始化系统主题检测
const initTheme = async () => {
	if (globalStore.appearance.theme === "auto") {
		try {
			const { getCurrentWebviewWindow } = await import(
				"@tauri-apps/api/webviewWindow"
			);
			const appWindow = getCurrentWebviewWindow();
			const actualTheme = await appWindow.theme();
			globalStore.appearance.isDark = actualTheme === "dark";
		} catch {
			// 如果获取系统主题失败，默认使用浅色
			globalStore.appearance.isDark = false;
		}
	}
};

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

		// 初始化系统主题
		await initTheme();

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
		// 重新生成颜色变量
		generateColorVars();
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
			colorBgBase: "#eeeeee", // 基础背景色，更灰一点
			colorBgContainer: "#f5f5f5", // 容器背景
			colorBgElevated: "#ffffff", // 浮层背景
			colorBgLayout: "#ececec", // 布局背景
			colorText: "#262626", // 文字颜色，使用更深的灰色
			colorTextSecondary: "#595959", // 次要文字颜色
			colorBorder: "#bfbfbf", // 边框颜色
			colorBorderSecondary: "#bfbfbf", // 次要边框颜色
		},
	};

	// 自定义暗色主题配置，避免纯黑死黑
	const darkThemeConfig = {
		algorithm: darkAlgorithm,
		token: {
			colorBgBase: "#1f1f1f", // 基础背景色，深灰
			colorBgContainer: "#262626", // 容器背景，深灰偏浅
			colorBgElevated: "#2d2d2d", // 浮层背景
			colorBgLayout: "#1f1f1f", // 布局背景
			colorText: "#e6e6e6", // 文字颜色，浅灰
			colorTextSecondary: "#a6a6a6", // 次要文字颜色
			colorBorder: "#434343", // 边框颜色
			colorBorderSecondary: "#303030", // 次要边框颜色
		},
	};

	return (
		<ConfigProvider
			locale={getAntdLocale(appearance.language)}
			theme={{
				algorithm: appearance.isDark
					? darkThemeConfig.algorithm
					: lightThemeConfig.algorithm,
				token: appearance.isDark
					? darkThemeConfig.token
					: lightThemeConfig.token,
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
