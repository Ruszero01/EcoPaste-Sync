import { useCallback, useEffect, useRef, useState } from "react";
import {
	playSound as playSoundBackend,
	preloadAudio,
} from "../plugins/audioEffect";

export interface PlaySoundOptions {
	volume?: number;
	rate?: number;
}

export const useAudioEffect = () => {
	const [isReady, setIsReady] = useState(false);
	const lastPlayTime = useRef<number>(0);
	const MIN_INTERVAL = 50; // 最小播放间隔50ms，避免过快重复播放

	// 初始化音频管理器
	useEffect(() => {
		const initAudio = async () => {
			try {
				// 预加载音效文件
				const audioPath = "assets/audio/copy.mp3";
				await preloadAudio("copy", audioPath);
				setIsReady(true);
				console.info("Audio effect initialized with backend");
			} catch (error) {
				console.error("Failed to initialize audio:", error);
			}
		};

		// 延迟初始化，确保页面完全加载
		const timer = setTimeout(initAudio, 300);

		// 清理函数
		return () => {
			clearTimeout(timer);
		};
	}, []);

	const playSound = useCallback(
		async (soundName = "copy", options?: PlaySoundOptions) => {
			const now = Date.now();

			// 防止过快重复播放
			if (now - lastPlayTime.current < MIN_INTERVAL) {
				return false;
			}

			lastPlayTime.current = now;

			try {
				const success = await playSoundBackend(soundName, {
					volume: options?.volume,
				});
				if (!success) {
					console.warn(`Failed to play sound: ${soundName}`);
					// 如果播放失败，尝试重试一次，间隔更短
					setTimeout(async () => {
						const retrySuccess = await playSoundBackend(soundName, {
							volume: options?.volume,
						});
						if (retrySuccess) {
							console.info("音效重试播放成功");
						}
					}, 50);
				}
				return success;
			} catch (error) {
				console.warn("音效播放失败:", error);
				// 如果出现异常，也尝试重试一次
				setTimeout(async () => {
					const retrySuccess = await playSoundBackend(soundName, {
						volume: options?.volume,
					});
					if (retrySuccess) {
						console.info("音效异常重试播放成功");
					}
				}, 50);
				return false;
			}
		},
		[],
	);

	// 重置播放时间戳
	const resetPlayTime = useCallback(() => {
		lastPlayTime.current = 0;
	}, []);

	// 手动初始化音频（用于用户交互后）
	const initAudio = useCallback(async () => {
		try {
			// 预加载音效文件
			const audioPath = "assets/audio/copy.mp3";
			await preloadAudio("copy", audioPath);
			setIsReady(true);
			console.info("Audio effect manually initialized");
			return true;
		} catch (error) {
			console.error("Failed to initialize audio:", error);
			return false;
		}
	}, []);

	// 创建一个audioManager对象以兼容现有代码
	const audioManager = {
		initialize: initAudio,
		getContextState: () => (isReady ? "running" : "suspended"),
	};

	return {
		playSound,
		resetPlayTime,
		isReady,
		initAudio,
		audioManager,
	};
};
