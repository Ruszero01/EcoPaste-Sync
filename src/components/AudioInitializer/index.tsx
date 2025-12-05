import { useAudioEffect } from "@/hooks/useAudioEffect";
import { useEffect, useState } from "react";

interface AudioInitializerProps {
	children: React.ReactNode;
	onInitialized?: () => void;
	onError?: (error: Error) => void;
}

export const AudioInitializer = ({
	children,
	onInitialized,
	onError,
}: AudioInitializerProps) => {
	const [, setIsInitialized] = useState(false);
	const [initAttempted, setInitAttempted] = useState(false);
	const { audioManager } = useAudioEffect();

	useEffect(() => {
		const initializeAudio = async () => {
			if (initAttempted) return;
			setInitAttempted(true);

			try {
				// 尝试初始化音频管理器
				await audioManager.initialize();
				setIsInitialized(true);
				onInitialized?.();
			} catch (error) {
				console.error("Failed to initialize audio system:", error);
				onError?.(error as Error);
			}
		};

		// 延迟初始化，确保应用完全加载
		const timer = setTimeout(initializeAudio, 100);

		return () => clearTimeout(timer);
	}, [initAttempted, onInitialized, onError, audioManager]);

	// 添加用户交互监听器，确保音频上下文可以被恢复
	useEffect(() => {
		const handleUserInteraction = async () => {
			if (audioManager.getContextState() === "suspended") {
				try {
					await audioManager.initialize();
					setIsInitialized(true);
				} catch (error) {
					console.warn("Failed to resume audio context:", error);
				}
			}
		};

		// 监听用户交互事件
		const events = ["click", "keydown", "touchstart"];
		for (const event of events) {
			document.addEventListener(event, handleUserInteraction, { once: true });
		}

		return () => {
			for (const event of events) {
				document.removeEventListener(event, handleUserInteraction);
			}
		};
	}, [audioManager]);

	return <>{children}</>;
};

export default AudioInitializer;
