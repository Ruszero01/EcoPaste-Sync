import { FileStatusIndicator } from "@/components/FileStatusIndicator";
import type { HistoryTablePayload } from "@/types/database";
import { getGlobalSyncErrorTracker } from "@/utils/syncErrorTracker";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type FC, memo, useEffect, useState } from "react";

interface ImageProps extends Partial<HistoryTablePayload> {
	className?: string;
}

const Image: FC<ImageProps> = (props) => {
	const { value, className = "max-h-full", fileSize, fileType, id } = props;
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncedImagePath, setSyncedImagePath] = useState<string | null>(null);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [retryCount, setRetryCount] = useState(0);

	// 检查是否为包模式的图片（JSON格式的包信息）
	const isPackageMode = typeof value === "string" && value.startsWith("{");

	let packageInfo = null;
	if (isPackageMode) {
		try {
			const parsed = JSON.parse(value);
			if (parsed.packageId && parsed.originalPaths) {
				packageInfo = parsed;
			}
		} catch (parseError) {
			console.error("解析包信息失败:", parseError);
		}
	}

	// 处理智能同步的异步操作
	useEffect(() => {
		const handlePackageSync = async () => {
			// 检查是否需要同步
			if (!isPackageMode || !packageInfo || syncedImagePath || isSyncing) {
				return;
			}

			// 检查重试次数限制
			const MAX_RETRY_COUNT = 3;
			if (retryCount >= MAX_RETRY_COUNT) {
				console.error(
					`❌ 智能同步重试次数已达上限 (${MAX_RETRY_COUNT}次)，停止重试:`,
					packageInfo.packageId,
				);
				setSyncError("同步失败次数过多，已停止重试");
				return;
			}

			// 检查全局错误状态
			const globalErrorTracker = getGlobalSyncErrorTracker();
			if (globalErrorTracker.hasFailedTooManyTimes(packageInfo.packageId)) {
				console.error(
					"❌ 全局错误跟踪器显示该包已失败过多，停止同步:",
					packageInfo.packageId,
				);
				setSyncError("该文件同步失败次数过多，已暂时停止");
				return;
			}

			setIsSyncing(true);
			setSyncError(null);

			try {
				// 动态导入文件包管理器以避免循环依赖
				const { filePackageManager } = await import(
					"@/utils/filePackageManager"
				);

				// 尝试智能同步文件
				const syncResult =
					await filePackageManager.syncFilesIntelligently(packageInfo);

				if (syncResult.hasChanges && syncResult.paths.length > 0) {
					// 同步成功，使用第一个路径显示图片
					const syncedPath = syncResult.paths[0];
					// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
					console.log("🔄 智能同步成功，显示解压后的图片:", syncedPath);
					setSyncedImagePath(syncedPath);
					setRetryCount(0); // 重置重试计数
					globalErrorTracker.clearError(packageInfo.packageId); // 清除错误记录
				} else if (!syncResult.hasChanges && syncResult.paths.length === 0) {
					// 同步没有变化且没有路径，可能是WebDAV未配置或文件不存在
					// 不设置错误状态，让组件继续尝试使用本地文件
					// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
					console.log("ℹ️ 智能同步无变化，可能是WebDAV未配置或文件已在本地");
				}
			} catch (syncError) {
				console.error("❌ 智能同步失败:", syncError);
				const newRetryCount = retryCount + 1;
				setRetryCount(newRetryCount);

				// 记录到全局错误跟踪器
				globalErrorTracker.recordError(
					packageInfo.packageId,
					syncError instanceof Error ? syncError.message : String(syncError),
				);

				// 如果达到重试上限，设置错误信息
				if (newRetryCount >= MAX_RETRY_COUNT) {
					setSyncError(`同步失败 ${newRetryCount} 次，已停止重试`);
				}
			} finally {
				setIsSyncing(false);
			}
		};

		handlePackageSync();
	}, [isPackageMode, packageInfo, syncedImagePath, isSyncing, retryCount]);

	// 如果是包模式且有有效的包信息，优先显示同步后的图片
	if (isPackageMode && packageInfo && packageInfo.originalPaths) {
		// 如果已经同步成功，显示同步后的图片
		if (syncedImagePath) {
			return (
				<img src={convertFileSrc(syncedImagePath)} className={className} />
			);
		}

		// 尝试从包信息中获取可用的图片路径
		let imagePath = null;

		// 处理可能的数组格式路径
		if (Array.isArray(packageInfo.originalPaths)) {
			for (const path of packageInfo.originalPaths) {
				if (
					typeof path === "string" &&
					(path.includes(":") || path.includes("/") || path.includes("\\"))
				) {
					imagePath = path;
					break;
				}
			}
		}

		// 如果找到了有效的图片路径，尝试显示图片
		if (imagePath) {
			try {
				// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
				console.log("🖼️ 显示包模式图片:", {
					imagePath,
					packageId: packageInfo.packageId,
				});
				return <img src={convertFileSrc(imagePath)} className={className} />;
			} catch (error) {
				console.error("显示包模式图片失败:", error);
			}
		} else {
			console.error("❌ 无法从包信息中提取有效的图片路径:", {
				packageId: packageInfo.packageId,
				originalPaths: packageInfo.originalPaths,
			});
		}

		// 如果无法直接显示图片，显示包模式占位符或同步状态
		const syncItem = {
			id: id || "",
			type: "image" as const,
			group: "image" as const,
			value,
			search: "", // 添加必需的search属性
			count: 0, // 添加必需的count属性
			favorite: false, // 添加必需的favorite属性
			createTime: new Date().toISOString(), // 添加必需的createTime属性
			note: "", // 添加必需的note属性
			lastModified: Date.now(), // 添加必需的lastModified属性
			deviceId: "", // 添加必需的deviceId属性
			fileSize: fileSize || 0,
			fileType: fileType || "image",
			lazyDownload: true, // 标记为按需下载
		};

		return (
			<div className="flex w-full flex-col items-center gap-2 p-2">
				{/* 包模式图片占位符 */}
				<div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border-2 border-gray-300 border-dashed bg-gray-100">
					<div className="text-center">
						{isSyncing ? (
							<>
								<div className="mb-1 text-blue-500 text-xs">解压中...</div>
								<div className="text-blue-400 text-xs">请稍候</div>
							</>
						) : syncError ? (
							<>
								<div className="mb-1 text-red-500 text-xs">同步失败</div>
								<div className="max-w-16 truncate text-red-400 text-xs text-xs">
									{syncError}
								</div>
							</>
						) : (
							<>
								<div className="mb-1 text-gray-400 text-xs">已打包</div>
								<div className="text-gray-500 text-xs">点击复制自动解压</div>
							</>
						)}
					</div>
				</div>

				{/* 文件状态指示器 */}
				<FileStatusIndicator
					syncItem={syncItem}
					showDetails={true}
					size="small"
				/>
			</div>
		);
	}

	// 常规图片显示逻辑
	if (!value) {
		return null;
	}

	// 检查value是否是JSON数组（新的存储格式）
	if (typeof value === "string" && value.startsWith("[")) {
		try {
			const filePaths = JSON.parse(value);
			if (Array.isArray(filePaths) && filePaths.length > 0) {
				// 使用第一个文件路径显示图片
				const imagePath = filePaths[0];

				// 验证路径格式
				if (
					typeof imagePath === "string" &&
					(imagePath.includes(":") ||
						imagePath.includes("/") ||
						imagePath.includes("\\"))
				) {
					// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
					console.log("🖼️ 显示数组格式图片:", {
						imagePath,
						totalPaths: filePaths.length,
					});
					return <img src={convertFileSrc(imagePath)} className={className} />;
				}

				console.error("❌ 数组中的图片路径格式无效:", { imagePath, filePaths });
			}
		} catch (parseError) {
			console.error("❌ 解析图片路径数组失败:", parseError, { value });
		}
	}

	// 检查value是否是JSON对象（包模式或其他异常情况）
	if (typeof value === "string" && value.startsWith("{")) {
		console.error("❌ 图片组件收到JSON对象而不是文件路径:", value);

		// 尝试解析JSON对象，看是否是包信息
		try {
			const parsed = JSON.parse(value);
			if (parsed.packageId && parsed.originalPaths) {
				console.error("❌ 检测到包信息但未在包模式处理中正确处理:", {
					packageId: parsed.packageId,
					originalPaths: parsed.originalPaths,
					itemId: parsed.itemId,
				});

				// 尝试从originalPaths中提取路径
				if (
					Array.isArray(parsed.originalPaths) &&
					parsed.originalPaths.length > 0
				) {
					const firstPath = parsed.originalPaths[0];
					if (
						typeof firstPath === "string" &&
						(firstPath.includes(":") ||
							firstPath.includes("/") ||
							firstPath.includes("\\"))
					) {
						// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
						console.log("🔧 尝试使用包信息中的第一个路径:", firstPath);
						try {
							return (
								<img src={convertFileSrc(firstPath)} className={className} />
							);
						} catch (pathError) {
							console.error("❌ 使用包路径显示图片失败:", pathError);
						}
					}
				}
			}
		} catch (parseError) {
			console.error("❌ 解析JSON对象失败:", parseError);
		}

		return (
			<div className="flex items-center justify-center p-4 text-red-500 text-xs">
				图片数据格式错误
			</div>
		);
	}

	// 正常的图片显示（单个文件路径）
	try {
		// 验证路径格式
		if (
			typeof value === "string" &&
			(value.includes("%7B") ||
				value.includes("%22") ||
				value.includes("packageId"))
		) {
			console.error("❌ 检测到URL编码的JSON数据而不是文件路径:", value);

			// 尝试解码URL编码的JSON数据
			try {
				const decodedValue = decodeURIComponent(value);
				// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
				console.log("🔧 尝试解码URL编码的数据:", decodedValue);

				// 检查解码后的数据是否是JSON
				if (decodedValue.startsWith("{")) {
					const parsed = JSON.parse(decodedValue);
					if (parsed.packageId && parsed.originalPaths) {
						// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
						console.log("✅ 成功解码并解析包信息:", {
							packageId: parsed.packageId,
							originalPaths: parsed.originalPaths,
						});

						// 尝试从originalPaths中提取路径
						if (
							Array.isArray(parsed.originalPaths) &&
							parsed.originalPaths.length > 0
						) {
							const firstPath = parsed.originalPaths[0];
							if (
								typeof firstPath === "string" &&
								(firstPath.includes(":") ||
									firstPath.includes("/") ||
									firstPath.includes("\\"))
							) {
								// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
								console.log("🖼️ 使用解码后的路径显示图片:", firstPath);
								return (
									<img src={convertFileSrc(firstPath)} className={className} />
								);
							}
						}
					}
				}
			} catch (decodeError) {
				console.error("❌ 解码URL编码数据失败:", decodeError);
			}

			return (
				<div className="flex items-center justify-center p-4 text-red-500 text-xs">
					图片URL格式错误
				</div>
			);
		}

		// biome-ignore lint/suspicious/noConsoleLog: 调试日志需要输出到控制台
		console.log("🖼️ 显示普通路径图片:", value);
		return <img src={convertFileSrc(value)} className={className} />;
	} catch (error) {
		console.error("❌ 图片显示失败:", error, { value });
		return (
			<div className="flex items-center justify-center p-4 text-gray-400 text-xs">
				图片加载失败
			</div>
		);
	}
};

export default memo(Image);
