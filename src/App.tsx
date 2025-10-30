import { LISTEN_KEY } from "@/constants";
import { useTray } from "@/hooks/useTray";
import { HappyProvider } from "@ant-design/happy-work-theme";
import { error } from "@tauri-apps/plugin-log";
import { openUrl } from "@tauri-apps/plugin-opener";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import { isString } from "lodash-es";
import { RouterProvider } from "react-router-dom";
import { useSnapshot } from "valtio";

const { defaultAlgorithm, darkAlgorithm } = theme;

const App = () => {
	const { appearance } = useSnapshot(globalStore);
	const { restoreState } = useWindowState();
	const { createTray } = useTray();
	const [ready, { toggle }] = useBoolean();

	useMount(async () => {
		await restoreState();

		await restoreStore();

		toggle();

		// 生成 antd 的颜色变量
		generateColorVars();

		// 初始化托盘 - 使用更强的防护机制
		try {
			const { TrayIcon } = await import("@tauri-apps/api/tray");

			// 先检查是否已存在托盘
			const existingTray = await TrayIcon.getById("app-tray");
			if (existingTray) {
				console.info("托盘已存在，跳过创建");
				return;
			}

			// 只有在没有托盘时才创建
			await createTray();
		} catch (error) {
			console.error("托盘初始化失败:", error);
		}
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

	// 监听关闭数据库的事件
	useTauriListen(LISTEN_KEY.CLOSE_DATABASE, closeDatabase);

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
			<AntdApp>
				<HappyProvider>
					{ready && <RouterProvider router={router} />}
				</HappyProvider>
			</AntdApp>
		</ConfigProvider>
	);
};

export default App;
