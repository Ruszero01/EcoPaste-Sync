import { useEffect, useState } from "react";

// 简单的图标缓存
const iconCache = new Map<string, string>();

export const useAppIcon = (iconBase64?: string) => {
	const [iconSrc, setIconSrc] = useState<string | undefined>(iconBase64);
	const [isLoading, setIsLoading] = useState(false);

	// 如果已经有图标，直接使用
	useEffect(() => {
		if (iconBase64) {
			setIconSrc(iconBase64);
			return;
		}

		// 没有图标时，尝试从缓存获取
		const cachedIcon = iconCache.get(iconBase64 || "");
		if (cachedIcon) {
			setIconSrc(cachedIcon);
		}
	}, [iconBase64]);

	// 获取图标的方法
	const loadIcon = async (appName?: string) => {
		if (!appName || iconSrc) {
			return;
		}

		setIsLoading(true);

		try {
			// 使用应用名作为缓存键（简化处理）
			// 在实际场景中，可能需要使用应用路径作为键
			const cacheKey = appName;

			// 检查缓存
			if (iconCache.has(cacheKey)) {
				const cachedIcon = iconCache.get(cacheKey);
				setIconSrc(cachedIcon);
				setIsLoading(false);
				return;
			}

			// 这里我们无法从 appName 直接获取图标，因为需要进程路径
			// 实际使用中，应该从数据库或传入进程路径
			// 为了演示，我们返回一个默认图标
			const defaultIcon =
				"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23ccc'/%3E%3C/svg%3E";
			setIconSrc(defaultIcon);
			iconCache.set(cacheKey, defaultIcon);
		} catch (error) {
			console.error("获取图标失败:", error);
		} finally {
			setIsLoading(false);
		}
	};

	return {
		iconSrc,
		isLoading,
		loadIcon,
	};
};
