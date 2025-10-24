import { showWindow } from "@/plugins/window";
import { emit } from "@tauri-apps/api/event";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { resolveResource } from "@tauri-apps/api/path";
import { TrayIcon, type TrayIconOptions } from "@tauri-apps/api/tray";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit, relaunch } from "@tauri-apps/plugin-process";

export const useTray = () => {
	const [startListen, { toggle }] = useBoolean(true);
	const { t } = useTranslation();

	// 修复托盘点击事件的函数
	const fixTrayClick = async () => {
		try {
			const tray = await getTrayById();
			if (tray) {
				try {
					// 关闭当前托盘并重新创建来重置事件
					await tray.close();
					await new Promise((resolve) => setTimeout(resolve, 200)); // 增加等待时间
				} catch (_closeError) {
					// 修复托盘点击事件时出错
					// 即使关闭失败也继续，托盘可能已经无效
				}
			} else {
			}
		} catch (_error) {
			// 修复托盘点击事件过程中出错
		}
	};

	// 强制关闭所有托盘图标
	const closeAllTrays = async () => {
		try {
			const tray = await getTrayById();
			if (tray) {
				try {
					await tray.close();
					await new Promise((resolve) => setTimeout(resolve, 300));
				} catch (_closeError) {
					// 关闭托盘图标时出错
					// 即使关闭失败也继续，托盘可能已经无效
				}
			} else {
			}
		} catch (_error) {
			// 关闭托盘过程中出错
		}
	};

	// 监听是否显示菜单栏图标
	useSubscribeKey(globalStore.app, "showMenubarIcon", async (value) => {
		try {
			// 如果设置为显示，先强制关闭所有现有托盘
			if (value) {
				await closeAllTrays();
			}

			const tray = await getTrayById();

			if (tray) {
				if (value) {
					// 这里不应该到达，因为我们已经强制关闭了
				} else {
					// 关闭托盘来隐藏
					try {
						await tray.close();
					} catch (_closeError) {
						// 关闭托盘图标时出错
					}
				}
			} else if (value) {
				// 托盘不存在且需要显示，创建新托盘
				await new Promise((resolve) => setTimeout(resolve, 300)); // 确保旧托盘完全关闭
				createTray();
			}
		} catch (_error) {
			// 处理 showMenubarIcon 变更时出错
		}
	});

	// 监听语言变更
	useSubscribeKey(globalStore.appearance, "language", () => {
		updateTrayMenu();
	});

	useUpdateEffect(() => {
		updateTrayMenu();

		emit(LISTEN_KEY.TOGGLE_LISTEN_CLIPBOARD, startListen);
	}, [startListen]);

	// 通过 id 获取托盘图标
	const getTrayById = () => {
		return TrayIcon.getById(TRAY_ID);
	};

	// 创建托盘
	const createTray = async () => {
		// 开始创建托盘图标

		if (!globalStore.app.showMenubarIcon) {
			return;
		}

		const tray = await getTrayById();

		if (tray) {
			return;
		}

		const { appName, appVersion } = globalStore.env;

		const menu = await getTrayMenu();

		const iconPath = isMac ? "assets/tray-mac.ico" : "assets/tray.ico";
		const icon = await resolveResource(iconPath);

		const options: TrayIconOptions = {
			menu,
			icon,
			id: TRAY_ID,
			tooltip: `${appName} v${appVersion}`,
			iconAsTemplate: true,
			menuOnLeftClick: isMac,
			action: (event) => {
				// 托盘事件触发

				if (isMac) return;

				if (event.type === "Click" && event.button === "Left") {
					showWindow("main");
				}
			},
		};

		const newTray = await TrayIcon.new(options);
		return newTray;
	};

	// 获取托盘菜单
	const getTrayMenu = async () => {
		const { appVersion } = globalStore.env;

		const items = await Promise.all([
			MenuItem.new({
				text: t("component.tray.label.preference"),
				accelerator: isMac ? "Cmd+," : void 0,
				action: () => showWindow("preference"),
			}),
			MenuItem.new({
				text: startListen
					? t("component.tray.label.stop_listening")
					: t("component.tray.label.start_listening"),
				action: toggle,
			}),
			PredefinedMenuItem.new({ item: "Separator" }),
			MenuItem.new({
				text: t("component.tray.label.check_update"),
				action: () => {
					showWindow();

					emit(LISTEN_KEY.UPDATE_APP, true);
				},
			}),
			MenuItem.new({
				text: t("component.tray.label.open_source_address"),
				action: () => openUrl(GITHUB_LINK),
			}),
			PredefinedMenuItem.new({ item: "Separator" }),
			MenuItem.new({
				text: `${t("component.tray.label.version")} ${appVersion}`,
				enabled: false,
			}),
			MenuItem.new({
				text: t("component.tray.label.relaunch"),
				action: relaunch,
			}),
			MenuItem.new({
				text: t("component.tray.label.exit"),
				accelerator: isMac ? "Cmd+Q" : void 0,
				action: () => exit(0),
			}),
		]);

		return Menu.new({ items });
	};

	// 更新托盘菜单
	const updateTrayMenu = async () => {
		const tray = await getTrayById();

		if (!tray) return;

		const menu = await getTrayMenu();

		tray.setMenu(menu);
	};

	return {
		createTray,
		fixTrayClick,
		closeAllTrays,
	};
};
