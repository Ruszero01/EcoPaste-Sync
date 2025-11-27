import copyAudio from "@/assets/audio/copy.mp3";
import UnoIcon, { type UnoIconProps } from "../UnoIcon";

export interface AudioProps {
	src?: string;
	hiddenIcon?: boolean;
	iconProps?: UnoIconProps;
}

export interface AudioRef {
	play: () => void;
}

const Audio = forwardRef<AudioRef, AudioProps>((props, ref) => {
	const { hiddenIcon, iconProps, src = copyAudio } = props;

	const audioRef = useRef<HTMLAudioElement>(null);
	const isPlayingRef = useRef(false);
	const isLoadedRef = useRef(false);

	useImperativeHandle(ref, () => ({
		play: playAudio,
	}));

	const playAudio = () => {
		if (!audioRef.current) return;

		try {
			// 如果正在播放，先停止并重置
			if (isPlayingRef.current && !audioRef.current.paused) {
				audioRef.current.currentTime = 0;
			}

			// 确保音频已加载
			if (audioRef.current.readyState < 2 || !isLoadedRef.current) {
				// 音频尚未加载完成，等待加载后播放
				const handleCanPlayOnce = () => {
					audioRef.current
						?.play()
						.then(() => {
							isPlayingRef.current = true;
						})
						.catch((error) => {
							console.warn("音频播放失败:", error);
							isPlayingRef.current = false;
						})
						.finally(() => {
							audioRef.current?.removeEventListener(
								"canplay",
								handleCanPlayOnce,
							);
						});
				};

				audioRef.current.addEventListener("canplay", handleCanPlayOnce);

				// 如果音频完全未加载，强制重新加载
				if (audioRef.current.readyState === 0) {
					audioRef.current.load();
				}
				return;
			}

			// 播放音频
			const playPromise = audioRef.current.play();

			if (playPromise !== undefined) {
				playPromise
					.then(() => {
						isPlayingRef.current = true;
					})
					.catch((error) => {
						// 处理浏览器自动播放策略限制
						if (error.name === "NotAllowedError") {
							console.warn("音频播放被浏览器阻止，可能需要用户交互");
						} else {
							console.warn("音频播放失败:", error);
						}
						isPlayingRef.current = false;
					});
			}
		} catch (error) {
			console.warn("音频播放异常:", error);
			isPlayingRef.current = false;
		}
	};

	// 音频预加载完成处理
	const handleCanPlay = () => {
		isLoadedRef.current = true;
	};

	// 音频播放结束处理
	const handleAudioEnded = () => {
		isPlayingRef.current = false;
	};

	// 音频播放错误处理
	const handleAudioError = (error: React.SyntheticEvent<HTMLAudioElement>) => {
		console.warn("音频加载错误:", error);
		isPlayingRef.current = false;
		isLoadedRef.current = false;
	};

	// 组件挂载时预加载音频
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.load();
		}
	}, []);

	return (
		<>
			<UnoIcon
				{...iconProps}
				hoverable
				hidden={hiddenIcon}
				name="i-iconamoon:volume-up-light"
				onClick={playAudio}
			/>

			<audio
				ref={audioRef}
				src={src === "copy" ? copyAudio : src}
				preload="auto"
				onCanPlay={handleCanPlay}
				onEnded={handleAudioEnded}
				onError={handleAudioError}
			/>
		</>
	);
});

export default Audio;
