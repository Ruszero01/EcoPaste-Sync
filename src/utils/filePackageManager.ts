import type { WebDAVConfig } from "@/plugins/webdav";
import { downloadSyncData, uploadSyncData } from "@/plugins/webdav";
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
	 */
	async syncFilesIntelligently(
		packageInfo: PackageInfo,
		config?: WebDAVConfig,
	): Promise<{ paths: string[]; hasChanges: boolean }> {
		const webdavConfig = await this.getWebDAVConfig(config);

		try {
			this.addLog("info", `🔄 开始智能同步文件包: ${packageInfo.packageId}`, {
				itemId: packageInfo.itemId,
				itemType: packageInfo.itemType,
				fileName: packageInfo.fileName,
				originalPathsCount: packageInfo.originalPaths.length,
				originalPaths: packageInfo.originalPaths,
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

				const cachedFileName = `${packageInfo.itemId}_${i}_${this.getFileExtension(originalPath)}`;
				const cachedPath = await join(cacheDir, cachedFileName);
				this.addLog("info", `📝 缓存文件名: ${cachedFileName}`);
				this.addLog("info", `💾 缓存路径: ${cachedPath}`);

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
					this.addLog(
						"info",
						`🚀 开始下载文件 ${i + 1}/${packageInfo.originalPaths.length}`,
					);
					const downloadSuccess = await this.downloadSingleFile(
						packageInfo,
						i,
						finalPath,
						webdavConfig,
					);
					if (downloadSuccess) {
						hasChanges = true;
						this.addLog("success", `✅ 文件下载成功: ${finalPath}`);
					} else {
						// 移除失败的路径
						resultPaths.pop();
						this.addLog("error", `❌ 文件下载失败: ${finalPath}`, {
							packageInfo: {
								packageId: packageInfo.packageId,
								fileName: packageInfo.fileName,
								itemId: packageInfo.itemId,
							},
							fileIndex: i,
							targetPath: finalPath,
						});
					}
				}
			}

			this.addLog("info", "🎯 智能同步完成:", {
				resultPathsCount: resultPaths.length,
				hasChanges,
				resultPaths,
			});

			return { paths: resultPaths, hasChanges };
		} catch (error) {
			this.addLog("error", "❌ 智能同步失败", {
				error: error instanceof Error ? error.message : String(error),
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
				this.addLog("success", `✅ 文件下载并保存成功: ${targetPath}`);
				return true;
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
}

// 导出单例实例
export const filePackageManager = new FilePackageManager();
