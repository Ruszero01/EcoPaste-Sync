import { playSound as playSoundBackend } from "../plugins/audioEffect";

export interface PlaySoundOptions {
	volume?: number;
}

// 直接导出播放函数，无需 React Hook
export const playSound = async (
	soundName = "copy",
	options?: PlaySoundOptions,
): Promise<boolean> => {
	try {
		// 直接调用 Rust 命令播放音效
		await playSoundBackend(soundName, {
			volume: options?.volume,
		});
		return true;
	} catch (error) {
		console.error("播放音效失败:", error);
		return false;
	}
};

// 兼容性：保留 Hook 接口
export const useAudioEffect = () => {
	return {
		playSound,
		isReady: true,
		initAudio: async () => true,
		audioManager: {
			initialize: async () => true,
			getContextState: () => "running" as const,
		},
	};
};
