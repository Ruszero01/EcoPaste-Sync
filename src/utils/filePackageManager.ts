import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
import { getGlobalSyncErrorTracker } from "@/utils/syncErrorTracker";
import { downloadDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import JSZip from "jszip";

interface PackageInfo {
	packageId: string;
	itemId: string;
	itemType: string;
	fileName: string;
	originalPaths: string[];
	size: number;
	checksum: string;
	compressedSize: number;
}

/**
 * 文件打包管理器 - 按条目打包文件为ZIP
 */
export class FilePackageManager {
	private readonly DEFAULT_MAX_PACKAGE_SIZE = 50 * 1024 * 1024; // 50MB per package
	private config: WebDAVConfig | null = null;
	private syncModeConfig: any = null;
	private logCallback?: (
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) => void;

	/**
	 * 设置WebDAV配置
	 */
	setWebDAVConfig(config: WebDAVConfig): void {
		this.config = config;
	}

	/**
	 * 设置日志回调
	 */
	setLogCallback(
		callback: (
			level: "info" | "success" | "warning" | "error",
			message: string,
			data?: any,
		) => void,
	): void {
		this.logCallback = callback;
	}

	/**
	 * 设置同步模式配置
	 */
	setSyncModeConfig(config: any): void {
		this.syncModeConfig = config;
	}

	/**
	 * 获取最大包大小限制
	 */
	private getMaxPackageSize(): number {
		if (this.syncModeConfig?.fileLimits?.maxPackageSize) {
			// 前端配置的单位是MB，需要转换为字节
			return this.syncModeConfig.fileLimits.maxPackageSize * 1024 * 1024;
		}
		return this.DEFAULT_MAX_PACKAGE_SIZE;
	}

	/**
	 * 添加日志
	 */
	private addLog(
		level: "info" | "success" | "warning" | "error",
		message: string,
		data?: any,
	) {
		if (this.logCallback) {
			this.logCallback(level, message, data);
		} else {
		}
	}

	/**
	 * 将条目的文件打包并上传（兼容性方法，内部使用智能上传）
	 */
	async packageAndUploadFiles(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		// 直接使用智能上传方法
		return this.smartUploadPackage(itemId, itemType, paths, config);
	}
	/**
	 * 智能同步文件（本地优先，缓存下载）
	 *
	 * 设备间文件同步机制说明：
	 * 1. 所有设备共享同一个云端同步池（WebDAV服务器）
	 * 2. 每个设备有自己的本地缓存目录，用于存储从云端下载的文件
	 * 3. 文件上传：每个设备上传的文件都会上传到同一个云端位置，以包模式存储
	 * 4. 文件下载：不同设备下载时，都会从同一个云端包中解压文件到各自的本地缓存
	 * 5. 冲突避免：通过唯一的packageId确保云端文件不冲突，通过本地缓存文件名格式确保本地文件不冲突
	 * 6. 缓存文件名格式：${packageId}_${itemId}_${fileIndex}_${extension}，不包含设备ID，因为所有设备共享云端同步池
	 */
	async syncFilesIntelligently(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<{ paths: string[]; hasChanges: boolean }> {
		const globalErrorTracker = getGlobalSyncErrorTracker();

		// 检查全局错误状态
		if (globalErrorTracker.hasFailedTooManyTimes(packageInfo.packageId)) {
			this.addLog(
				"warning",
				`⚠️ 包 ${packageInfo.packageId} 已失败过多，跳过同步`,
				{
					packageId: packageInfo.packageId,
					itemId: packageInfo.itemId,
				},
			);
			return { paths: [], hasChanges: false };
		}

		// 首先检查WebDAV配置是否可用
		const isConfigAvailable = await this.isWebDAVConfigAvailable(config);
		const webdavConfig = isConfigAvailable
			? await this.getWebDAVConfig(config)
			: null;

		try {
			this.addLog("info", `🔄 开始智能同步文件包: ${packageInfo.packageId}`, {
				itemId: packageInfo.itemId,
				itemType: packageInfo.itemType,
				fileName: packageInfo.fileName,
				originalPathsCount: packageInfo.originalPaths.length,
				originalPaths: packageInfo.originalPaths,
				hasWebDAVConfig: isConfigAvailable,
			});

			// 记录设备间同步机制的关键信息
			this.addLog("info", "🌐 设备间同步机制说明:", {
				云端同步池: "所有设备共享同一个WebDAV服务器上的文件池",
				本地缓存: "每个设备有独立的本地缓存目录",
				文件上传: "文件以包模式上传到云端，使用唯一的packageId避免冲突",
				文件下载:
					"从云端包中解压文件到本地缓存，所有设备使用相同的缓存文件名格式",
				冲突避免: "云端通过packageId避免冲突，本地通过缓存文件名格式避免冲突",
			});

			const resultPaths: string[] = [];
			const cacheDir = await this.getCacheDirectory();
			const filesDir = await this.getFilesDirectory();
			let hasChanges = false;

			// 确保缓存目录存在
			await mkdir(cacheDir, { recursive: true });
			this.addLog("info", `📁 缓存目录: ${cacheDir}`);
			this.addLog("info", `📂 文件目录: ${filesDir}`);

			// 检查每个文件的本地存在性
			for (let i = 0; i < packageInfo.originalPaths.length; i++) {
				let originalPath = packageInfo.originalPaths[i];
				this.addLog(
					"info",
					`🔍 处理文件 ${i + 1}/${packageInfo.originalPaths.length}: ${JSON.stringify(originalPath)}`,
				);

				// 确保originalPath是字符串，处理嵌套数组的情况
				if (Array.isArray(originalPath)) {
					this.addLog("info", "🔧 检测到数组格式，尝试提取有效路径");
					// 如果是数组，查找有效的文件路径
					const foundPath = originalPath.find(
						(item) =>
							typeof item === "string" &&
							(item.includes(":") || item.includes("/") || item.includes("\\")),
					);
					if (foundPath) {
						originalPath = foundPath;
						this.addLog("info", `✅ 从数组中提取到有效路径: ${originalPath}`);
					} else {
						originalPath = originalPath[0];
						this.addLog(
							"warning",
							`⚠️ 未找到有效路径，使用第一个元素: ${originalPath}`,
						);
					}
				}
				// 确保originalPath是字符串
				if (typeof originalPath !== "string") {
					this.addLog(
						"error",
						`❌ 跳过无效的文件路径: ${JSON.stringify(originalPath)}`,
						{
							type: typeof originalPath,
							index: i,
						},
					);
					continue;
				}

				// 缓存文件名格式：${packageId}_${itemId}_${fileIndex}_${extension}
				// 注意：此格式不包含设备ID，因为所有设备共享同一个云端同步池
				// 不同设备下载的文件会使用相同的缓存文件名，这是正确的行为
				// 因为它们是从同一个云端ZIP包中解压的相同内容
				const cachedFileName = `${packageInfo.packageId}_${packageInfo.itemId}_${i}_${this.getFileExtension(originalPath)}`;
				const cachedPath = await join(cacheDir, cachedFileName);
				this.addLog("info", `📝 缓存文件名: ${cachedFileName}`);
				this.addLog("info", `💾 缓存路径: ${cachedPath}`);
				this.addLog(
					"info",
					"🌐 设备间同步机制: 所有设备共享同一个云端同步池，使用相同的缓存文件名格式",
				);

				// 提取原始文件名
				const { basename } = await import("@tauri-apps/api/path");
				const originalFileName = await basename(originalPath);
				const potentialLocalPath = await join(filesDir, originalFileName);
				this.addLog("info", `📄 原始文件名: ${originalFileName}`);
				this.addLog("info", `📍 潜在本地路径: ${potentialLocalPath}`);

				let finalPath = originalPath;
				let needsDownload = false;

				try {
					const { exists } = await import("@tauri-apps/plugin-fs");
					const originalExists = await exists(originalPath);
					const potentialLocalExists = await exists(potentialLocalPath);
					const cachedExists = await exists(cachedPath);

					this.addLog("info", "🔍 文件存在性检查:", {
						originalExists,
						potentialLocalExists,
						cachedExists,
						originalPath,
						potentialLocalPath,
						cachedPath,
					});

					if (originalExists) {
						// 原始路径文件存在，直接使用
						finalPath = originalPath;
						this.addLog("info", `✅ 使用原始路径: ${finalPath}`);
					} else if (potentialLocalExists) {
						// 用户文件目录中有同名文件，使用本地文件
						finalPath = potentialLocalPath;
						this.addLog("info", `✅ 使用本地文件: ${finalPath}`);
					} else if (cachedExists) {
						// 缓存文件存在，使用缓存文件
						finalPath = cachedPath;
						this.addLog("info", `✅ 使用缓存文件: ${finalPath}`);
					} else {
						// 都不存在，需要下载
						needsDownload = true;
						finalPath = cachedPath;
						this.addLog("info", `⬇️ 需要下载文件到: ${finalPath}`);
					}
				} catch (error) {
					this.addLog("error", "❌ 检查文件存在性失败", {
						error: error instanceof Error ? error.message : String(error),
						originalPath,
						potentialLocalPath,
						cachedPath,
					});
					needsDownload = true;
					finalPath = cachedPath;
				}

				resultPaths.push(finalPath);

				// 如果需要下载，立即下载（单个文件）
				if (needsDownload) {
					// 检查是否有WebDAV配置
					if (!isConfigAvailable || !webdavConfig) {
						this.addLog(
							"info",
							`ℹ️ WebDAV配置未设置，跳过文件下载: ${finalPath}`,
							{
								packageId: packageInfo.packageId,
								fileIndex: i,
							},
						);
						// 移除失败的路径
						resultPaths.pop();
						continue;
					}

					this.addLog(
						"info",
						`🚀 开始下载文件 ${i + 1}/${packageInfo.originalPaths.length}`,
					);

					// 添加重试机制
					const MAX_RETRY_ATTEMPTS = 2;
					let downloadSuccess = false;
					let lastError: Error | null = null;

					for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
						try {
							downloadSuccess = await this.downloadSingleFile(
								packageInfo,
								i,
								finalPath,
								webdavConfig,
							);

							if (downloadSuccess) {
								break; // 下载成功，跳出重试循环
							}
						} catch (error) {
							lastError =
								error instanceof Error ? error : new Error(String(error));
							this.addLog(
								"warning",
								`⚠️ 文件下载第 ${attempt} 次尝试失败: ${finalPath}`,
								{
									error: lastError.message,
									attempt,
									maxAttempts: MAX_RETRY_ATTEMPTS,
								},
							);

							// 如果不是最后一次尝试，等待一段时间再重试
							if (attempt < MAX_RETRY_ATTEMPTS) {
								await new Promise((resolve) =>
									setTimeout(resolve, 1000 * attempt),
								); // 递增延迟
							}
						}
					}

					if (downloadSuccess) {
						hasChanges = true;
						this.addLog("success", `✅ 文件下载成功: ${finalPath}`);
					} else {
						// 移除失败的路径
						resultPaths.pop();
						const errorMessage = lastError?.message || "未知错误";

						// 记录到全局错误跟踪器
						globalErrorTracker.recordError(
							packageInfo.packageId,
							`文件下载失败: ${errorMessage}`,
						);

						this.addLog(
							"error",
							`❌ 文件下载失败（已重试 ${MAX_RETRY_ATTEMPTS} 次）: ${finalPath}`,
							{
								packageInfo: {
									packageId: packageInfo.packageId,
									fileName: packageInfo.fileName,
									itemId: packageInfo.itemId,
								},
								fileIndex: i,
								targetPath: finalPath,
								error: errorMessage,
								retryAttempts: MAX_RETRY_ATTEMPTS,
							},
						);
					}
				}
			}

			// 修复：如果有成功同步的文件，更新数据库中的路径
			if (hasChanges && resultPaths.length > 0) {
				try {
					// 动态导入数据库函数以避免循环依赖
					const { updateSQL } = await import("@/database");

					// 更新数据库中的文件路径为解压后的路径
					await updateSQL("history", {
						id: packageInfo.itemId,
						value: JSON.stringify(resultPaths),
					});

					this.addLog("success", "✅ 已更新数据库中的文件路径", {
						itemId: packageInfo.itemId,
						newPaths: resultPaths,
					});

					// 同步成功，清除错误记录
					globalErrorTracker.clearError(packageInfo.packageId);
				} catch (dbError) {
					this.addLog("error", "❌ 更新数据库失败", {
						error: dbError instanceof Error ? dbError.message : String(dbError),
						itemId: packageInfo.itemId,
						paths: resultPaths,
					});

					// 记录数据库更新错误
					globalErrorTracker.recordError(
						packageInfo.packageId,
						`数据库更新失败: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
					);
				}
			}

			this.addLog("info", "🎯 智能同步完成:", {
				resultPathsCount: resultPaths.length,
				hasChanges,
				resultPaths,
			});

			return { paths: resultPaths, hasChanges };
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// 记录到全局错误跟踪器
			globalErrorTracker.recordError(
				packageInfo.packageId,
				`智能同步失败: ${errorMessage}`,
			);

			this.addLog("error", "❌ 智能同步失败", {
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
				packageInfo: {
					packageId: packageInfo.packageId,
					itemId: packageInfo.itemId,
					fileName: packageInfo.fileName,
				},
			});
			return { paths: [], hasChanges: false };
		}
	}
	/**
	 * 下载单个文件（从ZIP包中提取）
	 */
	private async downloadSingleFile(
		packageInfo: PackageInfo,
		fileIndex: number,
		targetPath: string,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			this.addLog("info", "🔄 开始下载单个文件", {
				packageInfo: {
					packageId: packageInfo.packageId,
					fileName: packageInfo.fileName,
					itemId: packageInfo.itemId,
				},
				fileIndex,
				targetPath,
			});

			// 验证目标路径格式
			if (typeof targetPath !== "string" || targetPath.length === 0) {
				this.addLog("error", `❌ 目标路径无效: ${JSON.stringify(targetPath)}`);
				return false;
			}

			// 检查目标路径是否包含JSON片段（这是问题的根源）
			if (
				targetPath.includes('["') ||
				targetPath.includes('"]') ||
				targetPath.includes('":{"')
			) {
				this.addLog("error", "❌ 目标路径包含JSON片段，这表明路径拼接有问题", {
					targetPath,
					packageInfo,
					fileIndex,
				});
				return false;
			}

			// 下载ZIP包
			this.addLog("info", `📦 开始下载ZIP包: ${packageInfo.fileName}`);
			const zipData = await this.downloadPackage(
				packageInfo.fileName,
				webdavConfig,
			);
			if (!zipData) {
				this.addLog("error", `❌ ZIP包下载失败: ${packageInfo.fileName}`);
				return false;
			}

			// 解压ZIP包
			this.addLog("info", "🗜️ 开始解压ZIP包");
			const zip = await JSZip.loadAsync(zipData);

			// 找到对应的文件
			const files = Object.entries(zip.files);
			this.addLog(
				"info",
				"📋 ZIP包中的文件列表:",
				files.map(([filename, file]) => ({
					filename,
					isDirectory: file.dir,
					size: (file as any)._data?.uncompressedSize || 0,
				})),
			);

			const fileEntry = files.find(
				([_filename, file], index) => !file.dir && index === fileIndex,
			);

			if (!fileEntry) {
				this.addLog("error", `❌ 在ZIP包中找不到索引 ${fileIndex} 的文件`, {
					totalFiles: files.length,
					fileIndex,
					availableIndexes: files
						.filter(([_filename, file]) => !file.dir)
						.map(([_filename, _file], index) => index),
				});
				return false;
			}

			const [_filename, file] = fileEntry;
			this.addLog("info", `📄 找到目标文件: ${_filename}`);

			const fileData = await file.async("arraybuffer");
			this.addLog("info", `📊 文件数据大小: ${fileData.byteLength} bytes`);

			// 确保目标目录存在
			this.addLog("info", `📁 确保目标目录存在: ${targetPath}`);
			await this.ensureDirectoryExists(targetPath);

			// 保存文件
			this.addLog("info", `💾 开始保存文件到: ${targetPath}`);
			await writeFile(targetPath, new Uint8Array(fileData));

			// 验证文件是否成功保存
			const { exists } = await import("@tauri-apps/plugin-fs");
			const fileExists = await exists(targetPath);
			if (fileExists) {
				// 额外验证：检查文件大小是否合理
				try {
					const { lstat } = await import("@tauri-apps/plugin-fs");
					const stat = await lstat(targetPath);
					const fileSize = stat.size || 0;

					if (fileSize > 0) {
						this.addLog(
							"success",
							`✅ 文件下载并保存成功: ${targetPath} (${fileSize} bytes)`,
						);
						return true;
					}

					this.addLog("error", `❌ 文件保存后大小为0: ${targetPath}`);
					return false;
				} catch (statError) {
					this.addLog(
						"warning",
						`⚠️ 无法验证文件大小，但文件存在: ${targetPath}`,
						{
							error:
								statError instanceof Error
									? statError.message
									: String(statError),
						},
					);
					return true; // 即使无法验证大小，也认为成功
				}
			}

			this.addLog("error", `❌ 文件保存后验证失败: ${targetPath}`);
			return false;
		} catch (error) {
			this.addLog("error", `❌ 单个文件下载失败: ${targetPath}`, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				packageInfo: {
					packageId: packageInfo.packageId,
					fileName: packageInfo.fileName,
					itemId: packageInfo.itemId,
				},
				fileIndex,
				targetPath,
			});

			// 尝试清理可能的部分下载文件
			try {
				const { exists, remove } = await import("@tauri-apps/plugin-fs");
				if (await exists(targetPath)) {
					await remove(targetPath);
					this.addLog("info", `🧹 已清理部分下载的文件: ${targetPath}`);
				}
			} catch (cleanupError) {
				this.addLog("warning", `⚠️ 清理部分下载文件失败: ${targetPath}`, {
					error:
						cleanupError instanceof Error
							? cleanupError.message
							: String(cleanupError),
				});
			}

			return false;
		}
	}

	/**
	 * 下载并解包文件（保持向后兼容）
	 */
	async downloadAndUnpackFiles(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
		_localOnly = false,
	): Promise<string[] | null> {
		const syncResult = await this.syncFilesIntelligently(packageInfo, config);
		return syncResult.paths.length > 0 ? syncResult.paths : null;
	}

	/**
	 * 智能上传文件包（带跨设备唯一性检查）
	 *
	 * 跨设备文件同步机制：
	 * 1. 所有设备上传的文件都会存储到同一个云端同步池
	 * 2. 使用itemId作为包名，确保相同条目的文件在不同设备间共享
	 * 3. 通过校验和检查避免重复上传相同内容的文件包
	 * 4. 不同设备上传的相同内容会共享同一个云端文件包，避免存储冗余
	 */
	async smartUploadPackage(
		itemId: string,
		itemType: string,
		paths: string[],
		config?: WebDAVConfig,
	): Promise<PackageInfo | null> {
		const startTime = Date.now();
		this.addLog(
			"info",
			`📦 开始智能上传文件包: itemId=${itemId}, type=${itemType}, paths=${JSON.stringify(paths)}`,
		);

		// 首先检查WebDAV配置是否可用
		const isConfigAvailable = await this.isWebDAVConfigAvailable(config);
		if (!isConfigAvailable) {
			this.addLog("info", "ℹ️ WebDAV配置未设置或无效，跳过智能上传", {
				itemId,
				itemType,
			});
			return null;
		}

		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			// 1. 检查文件大小限制
			const sizeCheckStartTime = Date.now();
			const totalSize = await this.calculateTotalSize(paths);
			const maxPackageSize = this.getMaxPackageSize();
			this.addLog(
				"info",
				`📏 文件大小检查完成: ${this.formatFileSize(totalSize)}, 耗时: ${Date.now() - sizeCheckStartTime}ms`,
			);

			if (totalSize > maxPackageSize) {
				this.addLog(
					"warning",
					`📦 文件包大小超限: ${this.formatFileSize(totalSize)} > ${this.formatFileSize(maxPackageSize)}`,
				);
				this.addLog("warning", "📦 文件包大小超限，返回null");
				return null;
			}

			// 2. 生成本地包信息用于唯一性检查
			const packageInfoStartTime = Date.now();
			const localPackageInfo = await this.createLocalPackageInfo(
				itemId,
				itemType,
				paths,
				totalSize,
			);
			this.addLog(
				"info",
				`📋 本地包信息创建完成，耗时: ${Date.now() - packageInfoStartTime}ms`,
			);

			// 3. 优化：对于小文件，跳过云端检查以提高性能
			const skipCloudCheck = totalSize < 1024 * 1024; // 小于1MB的文件跳过云端检查
			if (skipCloudCheck) {
				this.addLog("info", "⚡ 文件较小，跳过云端检查以提高性能");
			} else {
				// 3. 检查云端是否已存在相同内容的包
				const cloudCheckStartTime = Date.now();
				this.addLog("info", "🔍 开始检查云端包是否存在...");
				const cloudExists = await this.checkCloudPackageExists(
					localPackageInfo,
					webdavConfig,
				);
				this.addLog(
					"info",
					`🔍 云端包检查完成，耗时: ${Date.now() - cloudCheckStartTime}ms, exists=${cloudExists.exists}`,
				);

				if (cloudExists.exists) {
					this.addLog("info", "✅ 云端已存在相同包，直接返回");
					return cloudExists.existingPackage || null;
				}
			}

			// 4. 创建并上传ZIP包
			this.addLog("info", "📦 开始创建ZIP包...");
			const zip = new JSZip();

			// 扁平化路径数组，处理嵌套数组的情况
			const flatPaths: string[] = [];
			for (const path of paths) {
				// 检查路径是否包含JSON片段（这是问题的根源）
				if (
					typeof path === "string" &&
					(path.includes('{"') ||
						path.includes('"}') ||
						path.includes("packageId"))
				) {
					this.addLog("error", "❌ 检测到路径包含JSON片段，跳过该路径", {
						path,
						pathType: typeof path,
					});
					continue;
				}

				if (Array.isArray(path)) {
					// 如果path是数组，查找有效的文件路径
					for (const item of path) {
						if (typeof item === "string" && item.length > 0) {
							// 检查是否包含JSON片段
							if (
								item.includes('{"') ||
								item.includes('"}') ||
								item.includes("packageId")
							) {
								this.addLog("error", "❌ 检测到数组项包含JSON片段，跳过该项", {
									item,
									itemType: typeof item,
								});
								continue;
							}

							// 如果是有效的文件路径字符串
							if (
								item.includes(":") ||
								item.includes("/") ||
								item.includes("\\")
							) {
								flatPaths.push(item);
							}
						}
					}
				} else if (typeof path === "string" && path.length > 0) {
					// 如果path是字符串，直接添加
					flatPaths.push(path);
				}
			}

			this.addLog("info", `📂 扁平化路径完成，共 ${flatPaths.length} 个文件`);

			let fileReadErrors = 0;
			for (let i = 0; i < flatPaths.length; i++) {
				const filePath = flatPaths[i];
				const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;

				try {
					const fileReadStartTime = Date.now();
					// 确保路径格式正确，特别是在Windows系统上
					const normalizedPath = this.normalizePath(filePath);
					const data = await readFile(normalizedPath);
					this.addLog(
						"info",
						`📖 文件读取完成: ${filePath}, 大小: ${data.byteLength}, 耗时: ${Date.now() - fileReadStartTime}ms`,
					);
					// 将ArrayBuffer转换为Uint8Array以避免类型错误
					zip.file(fileName, new Uint8Array(data));
				} catch (error) {
					fileReadErrors++;
					this.addLog("error", `❌ 读取文件失败: ${filePath}`, error);
					// 继续处理其他文件，而不是直接返回null
				}
			}

			if (fileReadErrors > 0) {
				this.addLog(
					"warning",
					`⚠️ 文件读取错误数: ${fileReadErrors}/${flatPaths.length}`,
				);
			}

			// 生成ZIP文件
			const zipGenerationStartTime = Date.now();
			this.addLog("info", "🗜️ 开始生成ZIP缓冲区...");
			const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
			this.addLog(
				"info",
				`🗜️ ZIP生成完成，大小: ${zipBuffer.byteLength}, 耗时: ${Date.now() - zipGenerationStartTime}ms`,
			);

			const checksumStartTime = Date.now();
			const checksum = await this.calculateChecksum(zipBuffer);
			this.addLog(
				"info",
				`🔐 校验和计算完成，耗时: ${Date.now() - checksumStartTime}ms`,
			);

			// 最终包信息
			const finalPackageInfo: PackageInfo = {
				...localPackageInfo,
				checksum,
				compressedSize: zipBuffer.byteLength,
			};

			// 上传ZIP包
			const uploadStartTime = Date.now();
			this.addLog("info", "⬆️ 开始上传ZIP包...");
			const uploadSuccess = await this.uploadPackage(
				finalPackageInfo,
				zipBuffer,
				webdavConfig,
			);
			this.addLog(
				"info",
				`⬆️ ZIP包上传完成，耗时: ${Date.now() - uploadStartTime}ms, 成功: ${uploadSuccess}`,
			);

			if (!uploadSuccess) {
				this.addLog("error", "❌ 上传失败，返回null");
				return null;
			}

			this.addLog(
				"success",
				`✅ 智能上传完成，总耗时: ${Date.now() - startTime}ms`,
			);
			return finalPackageInfo;
		} catch (error) {
			this.addLog("error", "❌ 智能上传异常", error);
			return null;
		}
	}

	/**
	 * 检查云端是否已存在相同内容的包（优化版）
	 */
	private async checkCloudPackageExists(
		localPackageInfo: PackageInfo,
		webdavConfig: WebDAVConfig,
	): Promise<{ exists: boolean; existingPackage?: PackageInfo | null }> {
		const startTime = Date.now();
		this.addLog(
			"info",
			`🔍 开始检查云端包是否存在: itemId=${localPackageInfo.itemId}`,
		);

		try {
			const webdavDir = `${webdavConfig.path}/files/`;

			// 1. 使用固定的包名模式进行检测
			const priorityNames = [`${localPackageInfo.itemId}.zip`];

			// 2. 预计算本地校验和以供对比
			const checksumStartTime = Date.now();
			this.addLog("info", "🔐 开始计算本地包校验和...");
			const localChecksum =
				await this.calculateLocalPackageChecksum(localPackageInfo);
			this.addLog(
				"info",
				`🔐 本地包校验和计算完成，耗时: ${Date.now() - checksumStartTime}ms`,
			);

			// 3. 检查优先包名
			for (const packageName of priorityNames) {
				const webdavPath = `${webdavDir}${packageName}`;
				this.addLog("info", `🔍 检查包匹配: ${webdavPath}`);
				const matchStartTime = Date.now();
				const matchResult = await this.checkPackageMatch(
					webdavPath,
					packageName,
					localPackageInfo,
					localChecksum,
					webdavConfig,
				);
				this.addLog(
					"info",
					`🔍 包匹配检查完成，耗时: ${Date.now() - matchStartTime}ms, found=${matchResult.found}`,
				);

				if (matchResult.found) {
					this.addLog(
						"success",
						`✅ 找到匹配包，总耗时: ${Date.now() - startTime}ms`,
					);
					return { exists: true, existingPackage: matchResult.package };
				}
			}

			this.addLog(
				"info",
				`🔍 未找到匹配包，总耗时: ${Date.now() - startTime}ms`,
			);
			return { exists: false };
		} catch (error) {
			this.addLog("error", "❌ 检查云端包存在性异常", error);
			return { exists: false };
		}
	}

	/**
	 * 预计算本地包的校验和
	 */
	private async calculateLocalPackageChecksum(
		localPackageInfo: PackageInfo,
	): Promise<string> {
		try {
			const localZip = new JSZip();

			for (let i = 0; i < localPackageInfo.originalPaths.length; i++) {
				let filePath = localPackageInfo.originalPaths[i];
				// 确保filePath是字符串，处理嵌套数组的情况
				if (Array.isArray(filePath)) {
					// 如果是数组，查找有效的文件路径
					filePath =
						filePath.find(
							(item) =>
								typeof item === "string" &&
								(item.includes(":") ||
									item.includes("/") ||
									item.includes("\\")),
						) || filePath[0];
				}
				// 确保filePath是字符串
				if (typeof filePath !== "string") {
					this.addLog("error", "❌ 跳过无效的文件路径:", filePath);
					continue;
				}
				try {
					// 确保路径格式正确，特别是在Windows系统上
					const normalizedPath = this.normalizePath(filePath);
					const data = await readFile(normalizedPath);
					const fileName = `file_${i + 1}.${this.getFileExtension(filePath)}`;
					// 将ArrayBuffer转换为Uint8Array以避免类型错误
					localZip.file(fileName, new Uint8Array(data));
				} catch (error) {
					this.addLog("error", `❌ 读取本地文件失败: ${filePath}`, error);
					// 继续处理其他文件，而不是中断整个流程
				}
			}

			const localZipBuffer = await localZip.generateAsync({
				type: "arraybuffer",
			});
			return await this.calculateChecksum(localZipBuffer);
		} catch (error) {
			this.addLog("error", "❌ 计算本地包校验和失败", error);
			return "";
		}
	}

	/**
	 * 检查单个包是否匹配
	 */
	private async checkPackageMatch(
		webdavPath: string,
		packageName: string,
		localPackageInfo: PackageInfo,
		localChecksum: string,
		webdavConfig: WebDAVConfig,
	): Promise<{ found: boolean; package?: PackageInfo }> {
		try {
			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);

			if (downloadResult.success && downloadResult.data) {
				const cloudPackageData = this.base64ToArrayBuffer(downloadResult.data);
				const cloudChecksum = await this.calculateChecksum(cloudPackageData);

				// 快速校验和对比
				if (cloudChecksum === localChecksum) {
					const existingPackage: PackageInfo = {
						packageId: localPackageInfo.packageId,
						itemId: localPackageInfo.itemId,
						itemType: localPackageInfo.itemType,
						fileName: packageName,
						originalPaths: localPackageInfo.originalPaths,
						size: localPackageInfo.size,
						checksum: cloudChecksum,
						compressedSize: cloudPackageData.byteLength,
					};

					return { found: true, package: existingPackage };
				}
			}

			return { found: false };
		} catch (error) {
			this.addLog("error", `❌ 检查包匹配失败: ${packageName}`, error);
			return { found: false };
		}
	}

	/**
	 * 创建本地包信息
	 *
	 * 包信息创建机制：
	 * 1. 使用itemId作为packageId和文件名，确保跨设备一致性
	 * 2. 所有设备对相同条目使用相同的包名，实现文件共享
	 * 3. 不包含设备特定信息，确保不同设备可以访问同一个文件包
	 */
	private async createLocalPackageInfo(
		itemId: string,
		itemType: string,
		paths: string[],
		totalSize: number,
	): Promise<PackageInfo> {
		// 使用固定的包名，避免时间戳导致的重复问题
		const fixedName = `${itemId}`;
		return {
			packageId: fixedName,
			itemId,
			itemType,
			fileName: `${fixedName}.zip`,
			originalPaths: paths,
			size: totalSize,
			checksum: "", // 稍后计算
			compressedSize: 0, // 稍后计算
		};
	}

	/**
	 * 上传文件包
	 */
	private async uploadPackage(
		packageInfo: PackageInfo,
		packageData: ArrayBuffer,
		webdavConfig: WebDAVConfig,
	): Promise<boolean> {
		try {
			const base64Content = this.arrayBufferToBase64(packageData);
			const webdavPath = `${webdavConfig.path}/files/${packageInfo.fileName}`;

			// 确保files目录存在
			const filesDirPath = `${webdavConfig.path}/files`;
			try {
				const { createDirectory } = await import("@/plugins/webdav");
				await createDirectory(webdavConfig, filesDirPath);
			} catch (_dirError) {
				// 目录创建失败，继续尝试上传
			}

			// 检查文件是否已存在（二次确认）
			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);
			if (downloadResult.success && downloadResult.data) {
				this.addLog(
					"info",
					`📦 检测到文件包已存在，跳过上传: ${packageInfo.fileName}`,
				);
				return true;
			}

			// 上传文件包
			const uploadResult = await uploadSyncData(
				webdavConfig,
				webdavPath,
				base64Content,
			);

			if (uploadResult.success) {
				return true;
			}
			// 如果遇到409错误，尝试删除后重新上传
			if (uploadResult.error_message?.includes("409")) {
				try {
					const { deleteFile } = await import("@/plugins/webdav");
					await deleteFile(webdavConfig, webdavPath);

					// 重新上传
					const retryResult = await uploadSyncData(
						webdavConfig,
						webdavPath,
						base64Content,
					);
					if (retryResult.success) {
						return true;
					}
				} catch (_deleteError) {
					// 删除失败，返回失败
				}
			}

			return false;
		} catch (error) {
			this.addLog("error", "❌ 上传包异常", error);
			return false;
		}
	}

	/**
	 * 下载文件包
	 */
	private async downloadPackage(
		packageFileName: string,
		webdavConfig: WebDAVConfig,
	): Promise<ArrayBuffer | null> {
		try {
			const webdavPath = `${webdavConfig.path}/files/${packageFileName}`;
			const result = await downloadSyncData(webdavConfig, webdavPath);

			if (result.success && result.data) {
				return this.base64ToArrayBuffer(result.data);
			}

			return null;
		} catch (error) {
			this.addLog("error", `❌ 下载文件包失败: ${packageFileName}`, error);
			return null;
		}
	}

	/**
	 * 格式化文件大小
	 */
	private formatFileSize(bytes: number): string {
		const sizes = ["B", "KB", "MB", "GB"];
		if (bytes === 0) return "0 B";
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${Math.round((bytes / 1024 ** i) * 100) / 100} ${sizes[i]}`;
	}

	/**
	 * 计算文件总大小
	 */
	private async calculateTotalSize(paths: string[]): Promise<number> {
		let totalSize = 0;
		const { lstat } = await import("@tauri-apps/plugin-fs");

		// 扁平化路径数组，处理嵌套数组的情况
		const flatPaths: string[] = [];
		for (const path of paths) {
			// 检查路径是否包含JSON片段（这是问题的根源）
			if (
				typeof path === "string" &&
				(path.includes('{"') ||
					path.includes('"}') ||
					path.includes("packageId"))
			) {
				this.addLog("error", "❌ 检测到路径包含JSON片段，跳过该路径", {
					path,
					pathType: typeof path,
				});
				continue;
			}

			if (Array.isArray(path)) {
				// 如果path是数组，检查是否包含字符串路径
				for (const item of path) {
					// 检查是否包含JSON片段
					if (
						typeof item === "string" &&
						(item.includes('{"') ||
							item.includes('"}') ||
							item.includes("packageId"))
					) {
						this.addLog("error", "❌ 检测到数组项包含JSON片段，跳过该项", {
							item,
							itemType: typeof item,
						});
						continue;
					}

					if (typeof item === "string" && item.length > 0) {
						// 如果是有效的文件路径字符串
						if (
							item.includes(":") ||
							item.includes("/") ||
							item.includes("\\")
						) {
							flatPaths.push(item);
						}
					}
				}
			} else if (typeof path === "string" && path.length > 0) {
				// 如果path是字符串，直接添加
				flatPaths.push(path);
			}
		}

		for (const path of flatPaths) {
			try {
				// 确保路径格式正确，特别是在Windows系统上
				const normalizedPath = this.normalizePath(path);
				const stat = await lstat(normalizedPath);
				totalSize += stat.size || 0;
			} catch (error) {
				this.addLog("error", `❌ 获取文件大小失败: ${path}`, error);
				// 继续处理其他文件，而不是直接返回0
			}
		}

		return totalSize;
	}

	/**
	 * 获取文件扩展名
	 */
	private getFileExtension(filePath: string): string {
		const parts = filePath.split(".");
		return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "bin";
	}

	/**
	 * 计算校验和
	 */
	private async calculateChecksum(data: ArrayBuffer): Promise<string> {
		if (typeof crypto !== "undefined" && crypto.subtle) {
			try {
				const hashBuffer = await crypto.subtle.digest("SHA-256", data);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
			} catch {
				// 回退到简单哈希
			}
		}

		// 简单哈希算法
		let hash1 = 5381;
		let hash2 = 5273;
		const bytes = new Uint8Array(data);
		for (let i = 0; i < bytes.length; i++) {
			hash1 = ((hash1 << 5) + hash1) ^ bytes[i];
			hash2 = ((hash2 << 5) + hash2) ^ bytes[i];
		}
		return `${Math.abs(hash1).toString(16)}${Math.abs(hash2).toString(16)}`;
	}

	/**
	 * ArrayBuffer转Base64
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * Base64转ArrayBuffer
	 */
	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}

	/**
	 * 获取WebDAV配置
	 */
	private async getWebDAVConfig(config?: WebDAVConfig): Promise<WebDAVConfig> {
		const effectiveConfig = config || this.config;
		if (!effectiveConfig) {
			throw new Error("WebDAV配置未设置");
		}
		return effectiveConfig;
	}

	/**
	 * 检查WebDAV配置是否可用
	 */
	private async isWebDAVConfigAvailable(
		config?: WebDAVConfig,
	): Promise<boolean> {
		const effectiveConfig = config || this.config;
		if (!effectiveConfig) {
			return false;
		}

		// 检查必要的配置字段
		if (
			!effectiveConfig.url ||
			!effectiveConfig.username ||
			!effectiveConfig.password
		) {
			return false;
		}

		return true;
	}

	/**
	 * 获取文件存储目录
	 */
	private async getFilesDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const filesDir = await join(ecoPasteDir, "files");
		return filesDir;
	}

	/**
	 * 获取缓存目录
	 */
	private async getCacheDirectory(): Promise<string> {
		const downloadsPath = await downloadDir();
		const ecoPasteDir = await join(downloadsPath, "EcoPaste");
		const cacheDir = await join(ecoPasteDir, "cache");
		return cacheDir;
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDirectoryExists(filePath: string): Promise<void> {
		const { dirname } = await import("@tauri-apps/api/path");
		const dir = await dirname(filePath);
		await mkdir(dir, { recursive: true });
	}

	/**
	 * 清理状态
	 */
	clearCurrentState(): void {}

	/**
	 * 规范化文件路径，确保在不同操作系统上都能正确处理
	 */
	private normalizePath(filePath: string): string {
		if (!filePath || typeof filePath !== "string") {
			return filePath;
		}

		// 处理Windows路径
		let normalizedPath = filePath.replace(/\\/g, "/");

		// 处理多个连续的斜杠
		normalizedPath = normalizedPath.replace(/\/+/g, "/");

		// 处理Windows盘符
		if (normalizedPath.match(/^[a-zA-Z]:\//)) {
			// Windows路径，保持盘符不变
			return normalizedPath;
		}

		// 处理相对路径
		if (
			!normalizedPath.startsWith("/") &&
			!normalizedPath.match(/^[a-zA-Z]:\//)
		) {
			// 相对路径，可能需要进一步处理
			return normalizedPath;
		}

		return normalizedPath;
	}

	/**
	 * 删除远程文件包
	 */
	async deleteRemotePackage(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<boolean> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			this.addLog("info", `🗑️ 开始删除远程文件包: ${packageInfo.fileName}`, {
				itemId: packageInfo.itemId,
				itemType: packageInfo.itemType,
				packageId: packageInfo.packageId,
				size: this.formatFileSize(packageInfo.size),
				webdavUrl: webdavConfig.url,
				webdavBasePath: webdavConfig.path,
			});

			// 修复：确保路径格式正确
			const basePath = webdavConfig.path.startsWith("/")
				? webdavConfig.path.substring(1)
				: webdavConfig.path;
			const webdavPath = basePath.endsWith("/")
				? `${basePath}files/${packageInfo.fileName}`
				: `${basePath}/files/${packageInfo.fileName}`;

			this.addLog("info", `📍 删除目标路径: ${webdavPath}`, {
				basePath,
				fileName: packageInfo.fileName,
				fullUrl: `${webdavConfig.url}/${webdavPath}`,
			});

			// 检查文件是否存在
			this.addLog("info", `🔍 检查远程文件包是否存在: ${packageInfo.fileName}`);
			const downloadResult = await downloadSyncData(webdavConfig, webdavPath);

			this.addLog("info", `📋 文件存在性检查结果: ${packageInfo.fileName}`, {
				success: downloadResult.success,
				errorMessage: downloadResult.error_message,
				dataSize: downloadResult.data ? downloadResult.data.length : 0,
			});

			if (!downloadResult.success) {
				this.addLog(
					"warning",
					`⚠️ 远程文件包不存在，无需删除: ${packageInfo.fileName}`,
					{
						reason: downloadResult.error_message || "未知原因",
					},
				);
				return true; // 文件不存在，认为删除成功
			}

			this.addLog(
				"info",
				`✅ 远程文件包存在，准备删除: ${packageInfo.fileName}`,
				{
					fileSize: downloadResult.data
						? this.formatFileSize(downloadResult.data.length)
						: "未知",
				},
			);

			// 删除文件
			this.addLog("info", `🗑️ 执行删除操作: ${packageInfo.fileName}`, {
				deleteUrl: `${webdavConfig.url}/${webdavPath}`,
			});
			const { deleteFile } = await import("@/plugins/webdav");
			const deleteSuccess = await deleteFile(webdavConfig, webdavPath);

			this.addLog("info", `📋 删除操作结果: ${packageInfo.fileName}`, {
				success: deleteSuccess,
			});

			if (deleteSuccess) {
				this.addLog(
					"success",
					`✅ 远程文件包删除成功: ${packageInfo.fileName}`,
					{
						itemId: packageInfo.itemId,
						itemType: packageInfo.itemType,
						deletedPath: webdavPath,
					},
				);
				return true;
			}

			this.addLog("error", `❌ 远程文件包删除失败: ${packageInfo.fileName}`, {
				webdavPath,
				itemId: packageInfo.itemId,
				fullUrl: `${webdavConfig.url}/${webdavPath}`,
			});
			return false;
		} catch (error) {
			this.addLog("error", `❌ 删除远程文件包异常: ${packageInfo.fileName}`, {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				itemId: packageInfo.itemId,
				webdavConfig: {
					url: webdavConfig.url,
					path: webdavConfig.path,
					username: webdavConfig.username,
				},
			});
			return false;
		}
	}

	/**
	 * 批量删除远程文件包
	 */
	async deleteRemotePackages(
		packageInfos: PackageInfo[],
		config?: WebDAVConfig,
	): Promise<{ success: number; failed: number; errors: string[] }> {
		const webdavConfig = await this.getWebDAVConfig(config);
		const results = { success: 0, failed: 0, errors: [] as string[] };

		this.addLog(
			"info",
			`🗑️ 开始批量删除远程文件包，共 ${packageInfos.length} 个`,
		);

		for (const packageInfo of packageInfos) {
			try {
				const success = await this.deleteRemotePackage(
					packageInfo,
					webdavConfig,
				);
				if (success) {
					results.success++;
				} else {
					results.failed++;
					results.errors.push(`删除失败: ${packageInfo.fileName}`);
				}
			} catch (error) {
				results.failed++;
				const errorMsg = `删除异常: ${packageInfo.fileName} - ${error instanceof Error ? error.message : String(error)}`;
				results.errors.push(errorMsg);
				this.addLog("error", errorMsg);
			}
		}

		this.addLog(
			"info",
			`🗑️ 批量删除完成: 成功 ${results.success}，失败 ${results.failed}`,
		);
		return results;
	}

	/**
	 * 解包远程数据中的包模式数据为本地数据
	 * 在双向同步数据合并阶段调用，确保数据在存储到数据库前已正确解包
	 *
	 * 设备间文件解包机制：
	 * 1. 所有设备共享同一个云端同步池，可以访问相同的文件包
	 * 2. 基于设备ID判断文件来源，实现智能路径恢复
	 * 3. 当前设备上传的文件优先尝试本地路径恢复
	 * 4. 其他设备上传的文件从云端下载到本地缓存
	 * 5. 性能优化：添加快速路径和并发控制
	 */
	async unpackRemotePackageData(
		remoteItem: any,
		currentDeviceId: string,
	): Promise<any> {
		// 快速路径：非包模式数据直接返回
		if (!remoteItem._syncType || remoteItem._syncType !== "package_files") {
			return remoteItem;
		}

		// 快速路径：非文件类型直接返回
		if (remoteItem.type !== "image" && remoteItem.type !== "files") {
			return remoteItem;
		}

		const startTime = Date.now();

		try {
			// 减少日志频率，只在调试模式下记录详细信息
			if (process.env.NODE_ENV === "development") {
				this.addLog("info", `🔄 开始解包远程数据: ${remoteItem.id}`, {
					itemId: remoteItem.id,
					itemType: remoteItem.type,
					syncType: remoteItem._syncType,
					deviceId: currentDeviceId,
					remoteDeviceId: remoteItem.deviceId,
				});
			}

			// 解析包信息
			let packageInfo: PackageInfo | null = null;
			try {
				packageInfo = JSON.parse(remoteItem.value) as PackageInfo;
			} catch (parseError) {
				this.addLog("error", `❌ 解析包信息失败: ${remoteItem.id}`, {
					error:
						parseError instanceof Error
							? parseError.message
							: String(parseError),
				});
				return remoteItem;
			}

			if (
				!packageInfo ||
				!packageInfo.packageId ||
				!packageInfo.originalPaths
			) {
				this.addLog("error", `❌ 包信息格式无效: ${remoteItem.id}`);
				return remoteItem;
			}

			// 快速路径：检查WebDAV配置是否可用
			const isConfigAvailable = await this.isWebDAVConfigAvailable();
			if (!isConfigAvailable) {
				this.addLog("info", `ℹ️ WebDAV配置未设置，跳过解包: ${remoteItem.id}`);
				return remoteItem;
			}

			const webdavConfig = await this.getWebDAVConfig();

			// 基于设备ID的智能路径恢复
			const isFromCurrentDevice = remoteItem.deviceId === currentDeviceId;

			// 记录设备间文件处理逻辑
			this.addLog("info", `🔍 设备间文件处理分析: ${remoteItem.id}`, {
				itemId: remoteItem.id,
				当前设备ID: currentDeviceId,
				远程设备ID: remoteItem.deviceId,
				是否来自当前设备: isFromCurrentDevice,
				处理策略: isFromCurrentDevice
					? "优先尝试本地路径恢复"
					: "从云端下载到本地缓存",
				云端同步池: "所有设备共享同一个云端文件池",
				本地缓存: "每个设备有独立的本地缓存目录",
			});

			// 性能优化：对于当前设备的文件，优先尝试快速路径恢复
			if (isFromCurrentDevice) {
				this.addLog(
					"info",
					`🚀 当前设备文件，尝试快速路径恢复: ${remoteItem.id}`,
					{
						策略: "检查原始路径是否仍然有效",
						优势: "避免不必要的网络请求和文件下载",
						适用场景: "文件在当前设备上仍然存在",
					},
				);

				const fastRecoveredPaths = await this.fastRecoverLocalPaths(
					packageInfo.originalPaths,
				);

				if (fastRecoveredPaths.length > 0) {
					// 修复：对于单个图片文件，直接使用路径字符串，而不是数组格式
					let finalValue: string;
					if (remoteItem.type === "image" && fastRecoveredPaths.length === 1) {
						// 对于单个图片文件，直接使用路径字符串
						finalValue = fastRecoveredPaths[0];
					} else {
						// 对于多个文件或文件数组，使用JSON数组格式
						finalValue = JSON.stringify(fastRecoveredPaths);
					}

					// 快速恢复成功，跳过智能同步
					const unpackedItem = {
						...remoteItem,
						value: finalValue,
						_syncType: undefined,
						fileSize: await this.calculatePathsSize(fastRecoveredPaths),
					};

					this.addLog("success", `✅ 快速恢复本地路径成功: ${remoteItem.id}`, {
						itemId: remoteItem.id,
						itemType: remoteItem.type,
						恢复的路径数量: fastRecoveredPaths.length,
						解包后格式:
							remoteItem.type === "image" && fastRecoveredPaths.length === 1
								? "字符串"
								: "数组",
						解包后路径: finalValue,
						耗时: `${Date.now() - startTime}ms`,
						设备间同步: "当前设备文件，无需从云端下载",
					});

					return unpackedItem;
				}

				this.addLog(
					"info",
					`⚠️ 快速路径恢复失败，将尝试云端同步: ${remoteItem.id}`,
					{
						原因: "原始路径已失效",
						下一步: "从云端下载文件到本地缓存",
					},
				);
			}

			this.addLog("info", `🌐 设备间文件处理策略: ${remoteItem.id}`, {
				是否来自当前设备: isFromCurrentDevice,
				处理策略: isFromCurrentDevice
					? "当前设备文件，原始路径失效后从云端恢复"
					: "其他设备文件，从云端下载到本地缓存",
				云端同步池: "所有设备共享同一个文件池",
				本地缓存: "每个设备有独立的缓存目录",
			});

			// 性能优化：对于小文件，使用快速路径
			const isSmallFile = packageInfo.size < 1024 * 1024; // 小于1MB
			if (isSmallFile && isFromCurrentDevice) {
				// 对于当前设备的小文件，尝试更激进的路径恢复
				const aggressiveRecoveredPaths = await this.aggressiveRecoverLocalPaths(
					packageInfo.originalPaths,
				);

				if (aggressiveRecoveredPaths.length > 0) {
					// 修复：对于单个图片文件，直接使用路径字符串，而不是数组格式
					let finalValue: string;
					if (
						remoteItem.type === "image" &&
						aggressiveRecoveredPaths.length === 1
					) {
						// 对于单个图片文件，直接使用路径字符串
						finalValue = aggressiveRecoveredPaths[0];
					} else {
						// 对于多个文件或文件数组，使用JSON数组格式
						finalValue = JSON.stringify(aggressiveRecoveredPaths);
					}

					const unpackedItem = {
						...remoteItem,
						value: finalValue,
						_syncType: undefined,
						fileSize: await this.calculatePathsSize(aggressiveRecoveredPaths),
					};

					if (process.env.NODE_ENV === "development") {
						this.addLog("success", `✅ 激进恢复本地路径: ${remoteItem.id}`, {
							itemId: remoteItem.id,
							itemType: remoteItem.type,
							恢复的路径数量: aggressiveRecoveredPaths.length,
							解包后格式:
								remoteItem.type === "image" &&
								aggressiveRecoveredPaths.length === 1
									? "字符串"
									: "数组",
							解包后路径: finalValue,
							耗时: `${Date.now() - startTime}ms`,
						});
					}

					return unpackedItem;
				}
			}

			// 智能解包文件（最后的备选方案）
			this.addLog("info", `🔄 开始智能解包文件: ${remoteItem.id}`, {
				策略: "从云端同步池下载文件到本地缓存",
				云端文件: `${webdavConfig.url}/files/${packageInfo.fileName}`,
				本地缓存: "下载到当前设备的独立缓存目录",
				设备间共享: "所有设备访问同一个云端文件",
			});

			const syncResult = await this.syncFilesIntelligently(
				packageInfo,
				webdavConfig,
			);

			if (syncResult.hasChanges && syncResult.paths.length > 0) {
				// 修复：对于单个图片文件，直接使用路径字符串，而不是数组格式
				let finalValue: string;
				if (remoteItem.type === "image" && syncResult.paths.length === 1) {
					// 对于单个图片文件，直接使用路径字符串
					finalValue = syncResult.paths[0];
				} else {
					// 对于多个文件或文件数组，使用JSON数组格式
					finalValue = JSON.stringify(syncResult.paths);
				}

				const unpackedItem = {
					...remoteItem,
					value: finalValue,
					_syncType: undefined,
					fileSize:
						syncResult.paths.length > 0
							? await this.calculatePathsSize(syncResult.paths)
							: remoteItem.fileSize,
				};

				this.addLog("success", `✅ 远程数据解包成功: ${remoteItem.id}`, {
					itemId: remoteItem.id,
					itemType: remoteItem.type,
					originalPaths: packageInfo.originalPaths.length,
					unpackedPaths: syncResult.paths.length,
					packageId: packageInfo.packageId,
					是否来自当前设备: isFromCurrentDevice,
					解包后格式:
						remoteItem.type === "image" && syncResult.paths.length === 1
							? "字符串"
							: "数组",
					解包后路径: finalValue,
					耗时: `${Date.now() - startTime}ms`,
					设备间同步机制: isFromCurrentDevice
						? "当前设备文件，原始路径失效后从云端恢复"
						: "其他设备文件，从云端下载到本地缓存",
					云端同步池: "所有设备共享同一个文件池",
					本地缓存: "每个设备有独立的缓存目录",
				});

				return unpackedItem;
			}

			// 解包没有变化，可能是文件已存在本地
			if (syncResult.paths.length > 0) {
				// 修复：对于单个图片文件，直接使用路径字符串，而不是数组格式
				let finalValue: string;
				if (remoteItem.type === "image" && syncResult.paths.length === 1) {
					// 对于单个图片文件，直接使用路径字符串
					finalValue = syncResult.paths[0];
				} else {
					// 对于多个文件或文件数组，使用JSON数组格式
					finalValue = JSON.stringify(syncResult.paths);
				}

				const unpackedItem = {
					...remoteItem,
					value: finalValue,
					_syncType: undefined,
				};

				return unpackedItem;
			}

			return remoteItem;
		} catch (error) {
			this.addLog("error", `❌ 解包远程数据失败: ${remoteItem.id}`, {
				error: error instanceof Error ? error.message : String(error),
				itemId: remoteItem.id,
				itemType: remoteItem.type,
				耗时: `${Date.now() - startTime}ms`,
			});
			return remoteItem;
		}
	}

	/**
	 * 快速恢复本地路径（性能优化版本）
	 * 只检查最常见的路径，减少I/O操作
	 */
	private async fastRecoverLocalPaths(
		originalPaths: string[],
	): Promise<string[]> {
		const recoveredPaths: string[] = [];
		const { exists } = await import("@tauri-apps/plugin-fs");

		// 只检查原始路径，不进行复杂的文件名匹配
		for (const originalPath of originalPaths) {
			if (typeof originalPath === "string" && (await exists(originalPath))) {
				recoveredPaths.push(originalPath);
			}
		}

		return recoveredPaths;
	}

	/**
	 * 激进恢复本地路径（针对小文件）
	 * 根据用户反馈，简化逻辑，只检查原始路径是否有效
	 */
	private async aggressiveRecoverLocalPaths(
		originalPaths: string[],
	): Promise<string[]> {
		const recoveredPaths: string[] = [];
		const { exists } = await import("@tauri-apps/plugin-fs");

		for (let i = 0; i < originalPaths.length; i++) {
			let originalPath = originalPaths[i];

			// 处理嵌套数组的情况
			if (Array.isArray(originalPath)) {
				const foundPath = originalPath.find(
					(item) =>
						typeof item === "string" &&
						(item.includes(":") || item.includes("/") || item.includes("\\")),
				);
				if (foundPath) {
					originalPath = foundPath;
				} else {
					originalPath = originalPath[0];
				}
			}

			if (typeof originalPath !== "string") {
				continue;
			}

			// 只检查原始路径是否有效
			if (await exists(originalPath)) {
				recoveredPaths.push(originalPath);
			}
		}

		return recoveredPaths;
	}

	/**
	 * 恢复本地路径
	 * 对于当前设备上传的文件，只检查原始路径是否仍然有效
	 * 根据用户反馈，不再检查本地同名文件，单纯依赖设备ID判断
	 */
	private async recoverLocalPaths(originalPaths: string[]): Promise<string[]> {
		const recoveredPaths: string[] = [];
		const { exists } = await import("@tauri-apps/plugin-fs");

		this.addLog("info", "🔍 开始恢复本地路径（仅检查原始路径）", {
			原始路径数量: originalPaths.length,
			原始路径: originalPaths,
		});

		for (let i = 0; i < originalPaths.length; i++) {
			let originalPath = originalPaths[i];

			// 处理嵌套数组的情况
			if (Array.isArray(originalPath)) {
				// 如果是数组，查找有效的文件路径
				const foundPath = originalPath.find(
					(item) =>
						typeof item === "string" &&
						(item.includes(":") || item.includes("/") || item.includes("\\")),
				);
				if (foundPath) {
					originalPath = foundPath;
				} else {
					originalPath = originalPath[0];
				}
			}

			// 确保originalPath是字符串
			if (typeof originalPath !== "string") {
				this.addLog(
					"warning",
					`⚠️ 跳过无效的文件路径: ${JSON.stringify(originalPath)}`,
					{
						路径类型: typeof originalPath,
						索引: i,
					},
				);
				continue;
			}

			// 只检查原始路径是否仍然有效
			try {
				if (await exists(originalPath)) {
					recoveredPaths.push(originalPath);
					this.addLog("info", `✅ 原始路径仍然有效: ${originalPath}`);
				} else {
					this.addLog("info", `ℹ️ 原始路径已失效: ${originalPath}`);
				}
			} catch (error) {
				this.addLog("warning", `⚠️ 检查原始路径失败: ${originalPath}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		this.addLog("info", "📊 本地路径恢复完成", {
			原始路径数量: originalPaths.length,
			恢复的路径数量: recoveredPaths.length,
			恢复的路径: recoveredPaths,
		});

		return recoveredPaths;
	}

	/**
	 * 计算多个路径的总大小
	 */
	private async calculatePathsSize(paths: string[]): Promise<number> {
		let totalSize = 0;
		const { lstat } = await import("@tauri-apps/plugin-fs");

		for (const path of paths) {
			try {
				const stat = await lstat(path);
				totalSize += stat.size || 0;
			} catch {
				// 忽略无法获取大小的文件
			}
		}

		return totalSize;
	}
}

// 导出单例实例
export const filePackageManager = new FilePackageManager();
