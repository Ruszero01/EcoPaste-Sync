import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { isDev } from "@/utils/is";
import { invoke } from "@tauri-apps/api/core";
import { Avatar, Button, Modal, message } from "antd";
import { useTranslation } from "react-i18next";
import { useSnapshot } from "valtio";
import Thank from "./components/Thank";

const About = () => {
	const { env } = useSnapshot(globalStore);
	const { t } = useTranslation();

	// 测试关闭 WebView2
	const handleTestCloseWebview = async () => {
		Modal.confirm({
			title: "测试关闭 WebView2",
			content:
				"这将关闭主窗口的 WebView2，用于测试内存释放功能。确定要继续吗？",
			okText: "确定",
			cancelText: "取消",
			onOk: async () => {
				try {
					await invoke("plugin:eco-window|close_webview_for_test");
					message.success("已发送关闭 WebView2 命令");
				} catch (error) {
					console.error("关闭 WebView2 失败:", error);
					message.error("关闭失败");
				}
			},
		});
	};

	// 测试重建窗口
	const handleTestRecreateWindow = async () => {
		try {
			// 获取当前窗口位置设置
			const windowPosition = globalStore.window.position;
			await invoke("plugin:eco-window|create_window", {
				label: "main",
				position_mode: windowPosition,
			});
			message.success("已发送创建窗口命令");
		} catch (error) {
			console.error("创建窗口失败:", error);
			message.error("创建失败");
		}
	};

	return (
		<>
			<ProList header={t("preference.about.about_software.title")}>
				<ProListItem
					avatar={<Avatar src="/logo.png" size={44} shape="square" />}
					title={env.appName}
					description={`${t("preference.about.about_software.label.version")}v${env.appVersion}`}
				/>
			</ProList>

			<Thank />

			{/* 开发环境专用：WebView2 测试工具 */}
			{isDev() && (
				<ProList header="WebView2 测试工具（仅限开发环境）">
					<ProListItem
						title="销毁窗口"
						description="销毁主窗口，释放 WebView2 进程"
					>
						<Button
							type="primary"
							size="small"
							onClick={handleTestCloseWebview}
						>
							销毁窗口
						</Button>
					</ProListItem>

					<ProListItem title="创建主窗口" description="重新创建主窗口">
						<Button
							type="primary"
							size="small"
							onClick={handleTestRecreateWindow}
						>
							创建主窗口
						</Button>
					</ProListItem>
				</ProList>
			)}
		</>
	);
};

export default About;
