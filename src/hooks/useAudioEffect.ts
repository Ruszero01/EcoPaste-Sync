import { useCallback, useEffect, useRef, useState } from "react";

// 音频缓存管理器
class AudioManager {
	private static instance: AudioManager;
	private audioContext: AudioContext | null = null;
	private audioBuffers: Map<string, AudioBuffer> = new Map();
	private isInitialized = false;
	private initPromise: Promise<void> | null = null;

	private constructor() {}

	static getInstance(): AudioManager {
		if (!AudioManager.instance) {
			AudioManager.instance = new AudioManager();
		}
		return AudioManager.instance;
	}

	// 初始化音频上下文
	async initialize(): Promise<void> {
		if (this.isInitialized) return;

		if (this.initPromise) return this.initPromise;

		this.initPromise = this._initialize();
		return this.initPromise;
	}

	private async _initialize(): Promise<void> {
		try {
			// 创建音频上下文
			this.audioContext = new (
				window.AudioContext || (window as any).webkitAudioContext
			)();

			// 如果音频上下文被挂起，尝试恢复
			if (this.audioContext.state === "suspended") {
				// 添加用户交互监听器来恢复音频上下文
				const resumeAudio = async () => {
					if (this.audioContext && this.audioContext.state === "suspended") {
						try {
							await this.audioContext.resume();
							// AudioContext resumed successfully
						} catch (error) {
							console.warn("Failed to resume AudioContext:", error);
						}
					}
				};

				// 监听多种用户交互事件，使用 { once: false } 确保可以多次尝试
				document.addEventListener("click", resumeAudio, {
					once: false,
					passive: true,
				});
				document.addEventListener("keydown", resumeAudio, {
					once: false,
					passive: true,
				});
				document.addEventListener("touchstart", resumeAudio, {
					once: false,
					passive: true,
				});
				document.addEventListener("mousedown", resumeAudio, {
					once: false,
					passive: true,
				});

				// 立即尝试恢复一次
				await resumeAudio();
			}

			// 预加载音效文件
			await this.preloadSounds();

			this.isInitialized = true;
			// AudioManager initialized successfully
		} catch (error) {
			console.error("Failed to initialize AudioManager:", error);
			throw error;
		}
	}

	// 预加载音效
	private async preloadSounds(): Promise<void> {
		const soundFiles = {
			copy: new URL("/src/assets/audio/copy.mp3", import.meta.url).href,
			// 可以添加更多音效
		};

		const loadPromises = Object.entries(soundFiles).map(async ([key, url]) => {
			try {
				const buffer = await this.loadAudioBuffer(url);
				this.audioBuffers.set(key, buffer);
				// Preloaded sound: ${key}
			} catch (error) {
				console.warn(`Failed to preload sound ${key}:`, error);
				// 如果预加载失败，尝试延迟重试
				setTimeout(() => {
					this.retryLoadSound(key, url);
				}, 1000);
			}
		});

		await Promise.allSettled(loadPromises);
	}

	// 重试加载音效
	private async retryLoadSound(key: string, url: string): Promise<void> {
		try {
			const buffer = await this.loadAudioBuffer(url);
			this.audioBuffers.set(key, buffer);
			// Successfully retried loading sound: ${key}
		} catch (error) {
			console.warn(`Failed to retry load sound ${key}:`, error);
		}
	}

	// 加载音频缓冲区
	private async loadAudioBuffer(url: string): Promise<AudioBuffer> {
		if (!this.audioContext) {
			throw new Error("AudioContext not initialized");
		}

		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to fetch audio: ${response.status}`);
			}
			const arrayBuffer = await response.arrayBuffer();
			return await this.audioContext.decodeAudioData(arrayBuffer);
		} catch (error) {
			console.error("Error loading audio buffer:", error);
			throw error;
		}
	}

	// 播放音效
	async playSound(
		soundName: string,
		options: { volume?: number; rate?: number } = {},
	): Promise<boolean> {
		try {
			await this.initialize();

			if (!this.audioContext) {
				console.warn("AudioContext not available");
				return false;
			}

			// 确保音频上下文处于运行状态
			if (this.audioContext.state === "suspended") {
				try {
					await this.audioContext.resume();
				} catch (error) {
					console.warn("Failed to resume AudioContext during play:", error);
				}
			}

			let buffer = this.audioBuffers.get(soundName);
			if (!buffer) {
				// 如果音效未加载，尝试即时加载
				const soundFiles = {
					copy: new URL("/src/assets/audio/copy.mp3", import.meta.url).href,
				};
				const url = soundFiles[soundName as keyof typeof soundFiles];
				if (url) {
					try {
						buffer = await this.loadAudioBuffer(url);
						this.audioBuffers.set(soundName, buffer);
					} catch (error) {
						console.warn(`Failed to load sound on demand ${soundName}:`, error);
						return false;
					}
				} else {
					console.warn(`Sound not found: ${soundName}`);
					return false;
				}
			}

			// 创建音频源
			const source = this.audioContext.createBufferSource();
			source.buffer = buffer;

			// 创建增益节点控制音量
			const gainNode = this.audioContext.createGain();
			gainNode.gain.value = options.volume ?? 0.7;

			// 设置播放速率
			if (options.rate && options.rate !== 1) {
				source.playbackRate.value = options.rate;
			}

			// 连接音频节点
			source.connect(gainNode);
			gainNode.connect(this.audioContext.destination);

			// 播放音频
			source.start(0);

			// 清理资源
			source.onended = () => {
				try {
					source.disconnect();
					gainNode.disconnect();
				} catch {
					// 忽略清理错误
				}
			};

			return true;
		} catch (error) {
			console.error("Error playing sound:", error);
			return false;
		}
	}

	// 获取音频上下文状态
	getContextState(): AudioContextState | "uninitialized" {
		if (!this.audioContext) return "uninitialized";
		return this.audioContext.state;
	}

	// 清理资源
	cleanup(): void {
		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}
		this.audioBuffers.clear();
		this.isInitialized = false;
		this.initPromise = null;
	}
}

export const useAudioEffect = () => {
	const [isReady, setIsReady] = useState(false);
	const lastPlayTime = useRef<number>(0);
	const MIN_INTERVAL = 50; // 最小播放间隔50ms，避免过快重复播放
	const audioManager = useRef(AudioManager.getInstance());

	// 初始化音频管理器
	useEffect(() => {
		const initAudio = async () => {
			try {
				await audioManager.current.initialize();
				setIsReady(true);

				// 初始化完成后，尝试播放一个静音音效来激活音频上下文
				setTimeout(async () => {
					try {
						await audioManager.current.playSound("copy", { volume: 0 });
					} catch {
						// 静默忽略静音播放的错误
					}
				}, 100);
			} catch (error) {
				console.error("Failed to initialize audio:", error);
			}
		};

		// 延迟初始化，确保页面完全加载
		const timer = setTimeout(initAudio, 500);

		// 清理函数
		return () => {
			clearTimeout(timer);
			// 不在组件卸载时清理，因为可能有其他组件在使用
		};
	}, []);

	const playSound = useCallback(
		async (
			soundName = "copy",
			options?: { volume?: number; rate?: number },
		) => {
			const now = Date.now();

			// 防止过快重复播放
			if (now - lastPlayTime.current < MIN_INTERVAL) {
				return false;
			}

			lastPlayTime.current = now;

			// 使用微任务确保音效播放不被其他同步操作阻塞
			return Promise.resolve().then(async () => {
				try {
					const success = await audioManager.current.playSound(
						soundName,
						options,
					);
					if (!success) {
						console.warn(`Failed to play sound: ${soundName}`);
						// 如果播放失败，尝试重试一次
						setTimeout(async () => {
							try {
								await audioManager.current.playSound(soundName, options);
							} catch (retryError) {
								console.warn("音效重试播放失败:", retryError);
							}
						}, 100);
					}
					return success;
				} catch (error) {
					console.warn("音效播放失败:", error);
					// 如果出现异常，也尝试重试一次
					setTimeout(async () => {
						try {
							await audioManager.current.playSound(soundName, options);
						} catch (retryError) {
							console.warn("音效重试播放失败:", retryError);
						}
					}, 100);
					return false;
				}
			});
		},
		[],
	);

	// 重置播放时间戳
	const resetPlayTime = useCallback(() => {
		lastPlayTime.current = 0;
	}, []);

	// 获取音频状态
	const getAudioState = useCallback(() => {
		return audioManager.current.getContextState();
	}, []);

	// 手动初始化音频（用于用户交互后）
	const initAudio = useCallback(async () => {
		try {
			await audioManager.current.initialize();
			setIsReady(true);
			// 初始化后尝试播放一个静音的测试音效，确保音频系统完全激活
			await audioManager.current.playSound("copy", { volume: 0 });
			return true;
		} catch (error) {
			console.error("Failed to initialize audio:", error);
			return false;
		}
	}, []);

	return {
		playSound,
		resetPlayTime,
		isReady,
		getAudioState,
		initAudio,
	};
};

// 导出音频管理器实例，供其他地方使用
export const audioManager = AudioManager.getInstance();
