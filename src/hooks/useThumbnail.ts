import { getServerConfig } from "@/plugins/webdav";
import type { HistoryTablePayload } from "@/types/database";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export const useThumbnail = () => {
	const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>(
		{},
	);
	const [loadingThumbnails, setLoadingThumbnails] = useState<
		Record<string, boolean>
	>({});

	// 创建缩略图的辅助函数
	const createThumbnail = useCallback(
		async (imageData: ArrayBuffer): Promise<string> => {
			return new Promise((resolve, reject) => {
				const img = new Image();

				img.onload = () => {
					try {
						const canvas = document.createElement("canvas");
						const ctx = canvas.getContext("2d");

						if (!ctx) {
							reject(new Error("无法创建Canvas上下文"));
							return;
						}

						// 设置缩略图尺寸（最大80x80）
						const maxSize = 80;
						let { width, height } = img;

						if (width > height) {
							if (width > maxSize) {
								height = (height * maxSize) / width;
								width = maxSize;
							}
						} else {
							if (height > maxSize) {
								width = (width * maxSize) / height;
								height = maxSize;
							}
						}

						canvas.width = width;
						canvas.height = height;

						// 绘制缩略图
						ctx.drawImage(img, 0, 0, width, height);

						// 转换为Blob
						canvas.toBlob(
							(blob) => {
								if (blob) {
									const url = URL.createObjectURL(blob);
									resolve(url);
								} else {
									reject(new Error("缩略图创建失败"));
								}
							},
							"image/jpeg",
							0.8,
						);
					} catch (error) {
						reject(error);
					}
				};

				img.onerror = () => reject(new Error("图片加载失败"));
				img.src = URL.createObjectURL(new Blob([imageData]));
			});
		},
		[],
	);

	// 获取图片缩略图
	const getThumbnail = useCallback(
		async (item: HistoryTablePayload): Promise<string | null> => {
			// 常规图片直接返回
			if (item.type !== "image" || !item.value) {
				return item.value ? convertFileSrc(item.value) : null;
			}

			// 如果已经有缩略图，直接返回
			if (thumbnailUrls[item.id]) {
				return thumbnailUrls[item.id];
			}

			// 如果正在加载，返回null
			if (loadingThumbnails[item.id]) {
				return null;
			}

			try {
				setLoadingThumbnails((prev) => ({ ...prev, [item.id]: true }));

				const webdavConfig = await getServerConfig();
				if (!webdavConfig) {
					console.warn("WebDAV配置未设置，无法获取缩略图");
					return null;
				}

				let imageData: ArrayBuffer | null = null;

				// 检查是否是包模式的图片（JSON格式的包信息）
				if (
					item.value &&
					(item.value.startsWith("{") || item.value.startsWith("["))
				) {
					try {
						// 尝试解析包信息或分段信息
						const data = JSON.parse(item.value);

						if (data.packageId && data.originalPaths) {
							// 包模式的图片，需要从包中提取图片
							console.log(`🖼️ 为缩略图下载包模式图片: ${item.id}`);

							const { filePackageManager } = await import(
								"@/utils/filePackageManager"
							);
							const paths = await filePackageManager.syncFilesIntelligently(
								data,
								webdavConfig,
							);

							if (paths.paths.length > 0) {
								// 使用第一个文件创建缩略图
								const { readFile } = await import("@tauri-apps/plugin-fs");
								const fileData = await readFile(paths.paths[0]);
								imageData = fileData.buffer;
							}
						} else if (Array.isArray(data) && data[0] && data[0].originalPath) {
							// 兼容旧的分段存储方式
							console.log(`🖼️ 为缩略图下载分段图片: ${item.id}`);

							const { imageSyncService } = await import(
								"@/services/imageSyncService"
							);
							const downloadedImagePath =
								await imageSyncService.downloadAndSaveImage(
									data[0],
									webdavConfig,
								);

							if (downloadedImagePath) {
								const { readFile } = await import("@tauri-apps/plugin-fs");
								const fileData = await readFile(downloadedImagePath);
								imageData = fileData.buffer;
							}
						}
					} catch (parseError) {
						console.error("解析图片数据失败:", parseError);
					}
				} else {
					// 常规本地图片文件
					try {
						const { readFile } = await import("@tauri-apps/plugin-fs");
						const fileData = await readFile(item.value);
						imageData = fileData.buffer;
					} catch (fileError) {
						console.error("读取本地图片失败:", fileError);
					}
				}

				if (!imageData) {
					console.warn(`缩略图获取失败: ${item.id}`);
					return null;
				}

				// 创建缩略图
				const thumbnailUrl = await createThumbnail(imageData);

				// 缓存缩略图URL
				setThumbnailUrls((prev) => ({ ...prev, [item.id]: thumbnailUrl }));

				console.log(`缩略图加载成功: ${item.id}`);
				return thumbnailUrl;
			} catch (error) {
				console.error(`获取缩略图失败: ${item.id}`, error);
				return null;
			} finally {
				setLoadingThumbnails((prev) => ({ ...prev, [item.id]: false }));
			}
		},
		[thumbnailUrls, loadingThumbnails, createThumbnail],
	);

	// 预加载缩略图
	const preloadThumbnail = useCallback(
		(item: HistoryTablePayload) => {
			if (
				item.type === "image" &&
				item.value &&
				!thumbnailUrls[item.id] &&
				!loadingThumbnails[item.id]
			) {
				// 检查是否是包模式或需要处理的图片
				const needsProcessing =
					item.value.startsWith("{") ||
					item.value.startsWith("[") ||
					!item.value.startsWith("data:");
				if (needsProcessing) {
					getThumbnail(item);
				}
			}
		},
		[getThumbnail, thumbnailUrls, loadingThumbnails],
	);

	// 清理缩略图URL
	const cleanupThumbnail = useCallback(
		(itemId: string) => {
			if (thumbnailUrls[itemId]) {
				URL.revokeObjectURL(thumbnailUrls[itemId]);
				setThumbnailUrls((prev) => {
					const newUrls = { ...prev };
					delete newUrls[itemId];
					return newUrls;
				});
			}
		},
		[thumbnailUrls],
	);

	return {
		getThumbnail,
		preloadThumbnail,
		cleanupThumbnail,
		thumbnailUrls,
		loadingThumbnails,
	};
};
