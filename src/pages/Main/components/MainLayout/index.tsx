import UnoIcon from "@/components/UnoIcon";
import { clipboardStore } from "@/stores/clipboard";
import { isWin } from "@/utils/is";
import { Flex } from "antd";
import clsx from "clsx";
import { useSnapshot } from "valtio";
import BottomStatusBar from "../BottomStatusBar";
import FavoriteToggle from "../FavoriteToggle";
import Group from "../Group";
import List from "../List";
import Pin from "../Pin";
import Search from "../Search";
import SidebarGroup from "../SidebarGroup";

const MainLayout = () => {
	const { search } = useSnapshot(clipboardStore);
	const [hasGroups, setHasGroups] = useState(false);

	// TODO: mica 效果在新版 webview 上存在 BUG，暂时禁用
	// 初始化主窗口的 Mica 效果
	// useMount(async () => {
	// 	await initializeMicaEffect();
	// });

	// 监听主题变化并更新当前窗口的 Mica 效果
	// useImmediateKey(globalStore.appearance, "isDark", (value) =>
	// 	updateMicaTheme(value as boolean),
	// );
	return (
		<div
			className={clsx("flex h-screen flex-col", {
				"bg-color-1": !isWin,
				"bg-transparent": isWin,
			})}
		>
			{/* 主内容区 - 分组和搜索栏固定，只有列表滚动 */}
			<Flex
				data-tauri-drag-region
				vertical
				gap={12}
				className={clsx("h-full flex-1 overflow-hidden py-3", {
					"flex-col-reverse": search.position === "bottom",
				})}
			>
				<Flex
					data-tauri-drag-region
					align="center"
					justify="space-between"
					gap="small"
					className="px-3"
				>
					{/* 固定分组 - 始终保持水平排列 */}
					<Group />

					<Flex align="center" gap={4} className="text-color-2 text-lg">
						<FavoriteToggle />
						<Pin />

						<UnoIcon
							hoverable
							name="i-lets-icons:setting-alt-line"
							onClick={() => {
								toggleWindow("preference", undefined);
							}}
						/>
					</Flex>
				</Flex>

				<Search />
				{/* 列表区域 + 左侧书签栏 - 统一容器管理边距 */}
				<div
					className={clsx("flex flex-1 overflow-hidden", {
						"pr-3": hasGroups,
						"px-3": !hasGroups,
					})}
				>
					{/* 自定义分组书签栏 - 紧贴左边缘 */}
					<SidebarGroup onHasGroupsChange={setHasGroups} />
					{/* 剪贴板列表 */}
					<List />
				</div>
			</Flex>

			{/* 底部状态栏 */}
			<BottomStatusBar />
		</div>
	);
};

export default MainLayout;
