import UnoIcon from "@/components/UnoIcon";
import { playSound } from "@/hooks/useAudioEffect";
import type { FC } from "react";

interface AudioPreviewProps {
	iconProps?: {
		size?: number;
		className?: string;
		hidden?: boolean;
	};
}

const AudioPreview: FC<AudioPreviewProps> = ({ iconProps }) => {
	const handlePlayAudio = async () => {
		await playSound("copy");
	};

	return (
		<UnoIcon
			{...iconProps}
			hoverable
			hidden={iconProps?.hidden}
			name="i-iconamoon:volume-up-light"
			onClick={handlePlayAudio}
		/>
	);
};

export default AudioPreview;
