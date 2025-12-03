import { useAudioEffect } from "@/hooks/useAudioEffect";
import UnoIcon, { type UnoIconProps } from "../UnoIcon";

export interface AudioProps {
	src?: string;
	hiddenIcon?: boolean;
	iconProps?: UnoIconProps;
}

export interface AudioRef {
	play: () => Promise<boolean>;
}

const Audio = forwardRef<AudioRef, AudioProps>((props, ref) => {
	const { hiddenIcon, iconProps } = props;
	const { playSound, isReady, initAudio } = useAudioEffect();

	// 将播放函数暴露给父组件
	useImperativeHandle(ref, () => ({
		play: async () => {
			// 如果音频系统未准备好，尝试初始化
			if (!isReady) {
				await initAudio();
			}
			// 播放复制音效
			return await playSound("copy");
		},
	}));

	const handlePlayAudio = async () => {
		await playSound("copy");
	};

	// 如果音频系统未准备好，可以显示一个加载状态或禁用按钮
	if (!isReady) {
		return (
			<UnoIcon
				{...iconProps}
				hoverable={false}
				hidden={hiddenIcon}
				name="i-iconamoon:volume-up-light"
				onClick={handlePlayAudio}
				style={{ opacity: 0.5 }}
			/>
		);
	}

	return (
		<UnoIcon
			{...iconProps}
			hoverable
			hidden={hiddenIcon}
			name="i-iconamoon:volume-up-light"
			onClick={handlePlayAudio}
		/>
	);
});

export default Audio;
