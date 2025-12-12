import ProList from "@/components/ProList";
import ProListItem from "@/components/ProListItem";
import { LISTEN_KEY } from "@/constants";
import {
	getSaveDataPath,
	getSaveDatabasePath,
	getSaveImagePath,
	joinPath,
} from "@/utils/path";
import { wait } from "@/utils/shared";
import { NodeIndexOutlined, ReloadOutlined } from "@ant-design/icons";
import { emit } from "@tauri-apps/api/event";
import { appLogDir, dataDir as tauriDataDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { openPath } from "@tauri-apps/plugin-opener";
import { Button, Modal, Space, Tooltip, message } from "antd";
import { isEqual, isString } from "lodash-es";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { fullName, transfer } from "tauri-plugin-fs-pro-api";
import type { State } from "../..";

const SavePath: FC<{ state: State }> = (props) => {
	const { state } = props;
	const { t } = useTranslation();
	const [dataDir, setDataDir] = useState("");
	const [logDir, setLogDir] = useState("");

	useMount(async () => {
		setDataDir(await tauriDataDir());
		setLogDir(await appLogDir());
	});

	// 检查目标路径中是否已存在数据文件
	const checkExistingData = async (dstPath: string): Promise<boolean> => {
		try {
			// 检查目标路径中是否存在数据库文件
			const dbPath = await getSaveDatabasePath();
			const dbName = dbPath.split(/[/\\]/).pop() || "";
			const targetDbPath = joinPath(dstPath, dbName);

			// 检查数据库文件是否存在
			const dbExists = await exists(targetDbPath);

			// 检查图片目录是否存在
			const imageDir = joinPath(dstPath, "images");
			const imageDirExists = await exists(imageDir);

			return dbExists || imageDirExists;
		} catch (error) {
			console.error("检查现有数据时出错:", error);
			return false;
		}
	};

	// 显示确认对话框，询问用户如何处理现有数据
	const showDataExistsDialog = (): Promise<boolean> => {
		return new Promise((resolve) => {
			Modal.confirm({
				title: t("preference.data_backup.storage_settings.existing_data_title"),
				content: t(
					"preference.data_backup.storage_settings.existing_data_content",
				),
				okText: t("preference.data_backup.storage_settings.use_existing_data"),
				cancelText: t(
					"preference.data_backup.storage_settings.overwrite_existing_data",
				),
				onOk: () => resolve(true), // 使用现有数据
				onCancel: () => resolve(false), // 覆盖现有数据
			});
		});
	};

	const handleChange = async (isDefault = false) => {
		try {
			const dstDir = isDefault ? dataDir : await open({ directory: true });

			if (!isString(dstDir) || isEqualPath(dstDir)) return;

			const dstPath = joinPath(dstDir, getSaveDataDirName());

			state.spinning = true;

			emit(LISTEN_KEY.CLOSE_DATABASE);

			await wait();

			// 检查目标路径中是否已存在数据文件
			const hasExistingData = await checkExistingData(dstPath);

			if (hasExistingData) {
				// 如果存在数据，询问用户如何处理
				const useExisting = await showDataExistsDialog();

				if (useExisting) {
					// 使用现有数据，直接更新路径
					globalStore.env.saveDataDir = dstPath;
					emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);
					message.success(
						t("preference.data_backup.storage_settings.hints.change_success"),
					);
					return;
				}
				// 否则继续执行覆盖操作
			}

			// 没有现有数据或用户选择覆盖，执行原有的转移逻辑
			await transfer(getSaveDataPath(), dstPath, {
				includes: [
					await fullName(getSaveImagePath()),
					await fullName(await getSaveDatabasePath()),
				],
			});

			globalStore.env.saveDataDir = dstPath;

			emit(LISTEN_KEY.REFRESH_CLIPBOARD_LIST);

			message.success(
				t("preference.data_backup.storage_settings.hints.change_success"),
			);
		} catch (error: any) {
			message.error(error);
		} finally {
			state.spinning = false;
		}
	};

	const isEqualPath = (dstDir = dataDir) => {
		const dstPath = joinPath(dstDir, getSaveDataDirName());

		return isEqual(dstPath, getSaveDataPath());
	};

	const description = (path = getSaveDataPath()) => {
		return (
			<span
				className="hover:color-primary cursor-pointer break-all transition"
				onMouseDown={() => openPath(path)}
			>
				{joinPath(path)}
			</span>
		);
	};

	return (
		<ProList header={t("preference.data_backup.storage_settings.title")}>
			<ProListItem
				title={t(
					"preference.data_backup.storage_settings.label.data_storage_path",
				)}
				description={description()}
			>
				<Space.Compact>
					<Tooltip
						title={t(
							"preference.data_backup.storage_settings.hints.custom_path",
						)}
					>
						<Button
							icon={<NodeIndexOutlined />}
							onClick={() => handleChange()}
						/>
					</Tooltip>

					<Tooltip
						title={t(
							"preference.data_backup.storage_settings.hints.default_path",
						)}
					>
						<Button
							disabled={isEqualPath()}
							icon={<ReloadOutlined />}
							onClick={() => handleChange(true)}
						/>
					</Tooltip>
				</Space.Compact>
			</ProListItem>

			<ProListItem
				title={t(
					"preference.data_backup.storage_settings.label.log_storage_path",
				)}
				description={description(logDir)}
			/>
		</ProList>
	);
};

export default SavePath;
