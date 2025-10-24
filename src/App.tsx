import { LISTEN_KEY } from "@/constants";
import { HappyProvider } from "@ant-design/happy-work-theme";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { error } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ConfigProvider, theme } from "antd";
import { isString } from "lodash-es";
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
	});

	// 监听语言的变化
	useImmediateKey(globalStore.appearance, "language", i18n.changeLanguage);

	// 监听是否是暗黑模式
	useImmediateKey(globalStore.appearance, "isDark", (value) => {
		if (value) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	});

	// 监听显示窗口的事件
	useTauriListen(LISTEN_KEY.SHOW_WINDOW, ({ payload }) => {
		const appWindow = getCurrentWebviewWindow();

		if (appWindow.label !== payload) {
			return;
		}

		showWindow();
	});

	// 监听关闭数据库的事件
	useTauriListen(LISTEN_KEY.CLOSE_DATABASE, closeDatabase);

	// 监听托盘重建事件（同步后修复托盘点击事件）
	useTauriListen("rebuild-tray", async () => {
		try {
			// 先检查托盘是否存在
			const { TrayIcon } = await import("@tauri-apps/api/tray");
			const existingTray = TrayIcon.getById("app-tray");

			if (existingTray) {
				try {
					await existingTray.close();
					// 等待一下确保托盘完全关闭
					await new Promise((resolve) => setTimeout(resolve, 200));
				} catch (closeError) {
					console.error("App: 关闭托盘时出错", closeError);
					// 即使关闭失败也继续，托盘可能已经无效
				}
			}

			// 重新创建托盘
			globalStore.app.showMenubarIcon = false;
			setTimeout(() => {
				globalStore.app.showMenubarIcon = true;
			}, 100);
		} catch (error) {
			console.error("App: 托盘重建过程中出错", error);
		}
	});

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
	useKeyPress(["esc", PRESET_SHORTCUT.HIDE_WINDOW], hideWindow);

	// 监听 promise 的错误，输出到日志
	useEventListener("unhandledrejection", ({ reason }) => {
		const message = isString(reason) ? reason : JSON.stringify(reason);

		error(message);
	});

	return (
		<ConfigProvider
			locale={getAntdLocale(appearance.language)}
			theme={{
				algorithm: appearance.isDark ? darkAlgorithm : defaultAlgorithm,
			}}
		>
			<HappyProvider>
				{ready && <RouterProvider router={router} />}
			</HappyProvider>
		</ConfigProvider>
	);
};

export default App;
