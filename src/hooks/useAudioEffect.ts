import { useRef } from "react";

export const useAudioEffect = (
	audioRef: React.RefObject<{ play: () => void }>,
) => {
	const lastPlayTime = useRef<number>(0);
	const MIN_INTERVAL = 50; // 最小播放间隔50ms，避免过快重复播放

	const playSound = () => {
		const now = Date.now();

		// 防止过快重复播放
		if (now - lastPlayTime.current < MIN_INTERVAL) {
			return;
		}

		lastPlayTime.current = now;

		// 使用微任务确保音效播放不被其他同步操作阻塞
		Promise.resolve().then(() => {
			try {
				audioRef.current?.play();
			} catch (error) {
				console.warn("音效播放失败:", error);
			}
		});
	};

	// 重置播放时间戳
	const resetPlayTime = () => {
		lastPlayTime.current = 0;
	};

	return { playSound, resetPlayTime };
};
