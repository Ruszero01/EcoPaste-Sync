import UnoIcon from "@/components/UnoIcon";
// import UpdateApp from "@/components/UpdateApp"; // fork分支不需要更新功能
import {
	initializeMicaEffect,
	toggleWindow,
	updateMicaTheme,
} from "@/plugins/window";
import { isWin } from "@/utils/is";
import { emit } from "@tauri-apps/api/event";
import { useKeyPress } from "ahooks";
import { Flex } from "antd";
import clsx from "clsx";
import { MacScrollbar } from "mac-scrollbar";
import { useSnapshot } from "valtio";
import About from "./components/About";
import Backup from "./components/Backup";
import Clipboard from "./components/Clipboard";
import CloudSync from "./components/CloudSync";
import General from "./components/General";
import History from "./components/History";
import Shortcut from "./components/Shortcut";

const Preference = () => {
	const { t } = useTranslation();
	const { appearance } = useSnapshot(globalStore);
	const [activeKey, setActiveKey] = useState("clipboard");
	const contentRef = useRef<HTMLElement>(null);

	// ESC 销毁窗口
	useKeyPress("esc", () => {
		toggleWindow("preference", undefined);
	});

	useMount(async () => {
		const autostart = await isAutostart();

		if (!autostart) {
			toggleWindow("preference", undefined);
		}

		// 初始化偏好设置窗口的 Mica 效果
		await initializeMicaEffect();
	});

	// 监听主题变化并更新当前窗口的 Mica 效果
	useImmediateKey(globalStore.appearance, "isDark", (isDark) => {
		if (typeof isDark === "boolean") {
			updateMicaTheme(isDark);
		}
	});

	// 监听全局配置项变化
	useSubscribe(globalStore, () => handleStoreChanged());

	// 监听剪贴板配置项变化
	useSubscribe(clipboardStore, () => handleStoreChanged());

	// 配置项变化通知其它窗口和本地存储
	const handleStoreChanged = () => {
		emit(LISTEN_KEY.STORE_CHANGED, { globalStore, clipboardStore });

		saveStore();
	};

	const menuItems = useCreation(() => {
		return [
			{
				key: "clipboard",
				label: t("preference.menu.title.clipboard"),
				icon: "i-lucide:clipboard-list",
				content: <Clipboard />,
			},
			{
				key: "history",
				label: t("preference.menu.title.history"),
				icon: "i-lucide:history",
				content: <History />,
			},
			{
				key: "general",
				label: t("preference.menu.title.general"),
				icon: "i-lucide:bolt",
				content: <General />,
			},
			{
				key: "shortcut",
				label: t("preference.menu.title.shortcut"),
				icon: "i-lucide:keyboard",
				content: <Shortcut />,
			},
			{
				key: "backup",
				label: t("preference.menu.title.backup"),
				icon: "i-lucide:database-backup",
				content: <Backup />,
			},
			{
				key: "cloud_sync",
				label: t("preference.menu.title.cloud_sync"),
				icon: "i-lucide:cloud-cog",
				content: <CloudSync />,
			},
			{
				key: "about",
				label: t("preference.menu.title.about"),
				icon: "i-lucide:info",
				content: <About />,
			},
		];
	}, [appearance.language]);

	const handleMenuClick = (key: string) => {
		setActiveKey(key);

		raf(() => {
			contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
		});
	};

	return (
		<Flex
			className={clsx("h-screen", {
				"bg-color-1": !isWin,
				"bg-transparent": isWin, // Windows 上使用透明背景以显示 Mica 效果
			})}
		>
			<Flex
				data-tauri-drag-region
				vertical
				gap="small"
				className={clsx("h-full w-50 p-3", [isMac ? "pt-8" : "bg-color-1"])}
			>
				{menuItems.map((item) => {
					const { key, label, icon } = item;

					return (
						<Flex
							key={key}
							align="center"
							gap="small"
							className={clsx(
								"cursor-pointer rounded-lg p-3 p-r-0 text-color-2 transition hover:bg-color-4",
								{
									"bg-primary! text-white!": activeKey === key,
								},
							)}
							onClick={() => handleMenuClick(key)}
						>
							<UnoIcon name={icon} size={20} />

							<span className="font-bold">{label}</span>
						</Flex>
					);
				})}
			</Flex>

			<MacScrollbar
				data-tauri-drag-region
				ref={contentRef}
				skin={appearance.isDark ? "dark" : "light"}
				className="h-full flex-1 bg-color-2 p-4"
			>
				{menuItems.map((item) => {
					const { key, content } = item;

					return (
						<div key={key} hidden={key !== activeKey}>
							{content}
						</div>
					);
				})}
			</MacScrollbar>

			{/* <UpdateApp /> // fork分支不需要更新功能 */}
		</Flex>
	);
};

export default Preference;
