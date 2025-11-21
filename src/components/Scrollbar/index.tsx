import { MacScrollbar, type MacScrollbarProps } from "mac-scrollbar";
import { useSnapshot } from "valtio";

interface ScrollbarProps extends MacScrollbarProps {
	thumbSize?: number;
	offset?: number;
}

const Scrollbar = forwardRef<HTMLElement, ScrollbarProps>((props, ref) => {
	const { appearance } = useSnapshot(globalStore);

	const { thumbSize = 6, offset = 0, children, ...rest } = props;

	const containerRef = useRef<HTMLElement>(null);

	useImperativeHandle(ref, () => containerRef.current!);

	// 保持原有的 thumbStyle，使用库的默认行为
	const getThumbStyle: MacScrollbarProps["thumbStyle"] = (horizontal) => {
		if (horizontal) {
			return {
				height: thumbSize,
				bottom: offset,
			};
		}

		return {
			width: thumbSize,
			right: offset,
		};
	};

	// 自定义滚动条颜色
	const getTrackStyle: MacScrollbarProps["trackStyle"] = () =>
		({
			border: 0,
			"--ms-track-size": 0,
			// 暗色模式：使用较暗的滚动条颜色
			// 亮色模式：使用较亮的滚动条颜色
			"--ms-thumb-color": appearance.isDark
				? "hsla(0, 0%, 50%, 0.6)" // 暗色模式用中等亮度灰色
				: "hsla(0, 0%, 30%, 0.4)", // 亮色模式用深色但透明的灰色
			"--ms-track-background": "transparent", // 轨道背景透明
			"--ms-track-border-color": "transparent", // 轨道边框透明
		}) as React.CSSProperties;

	return (
		<MacScrollbar
			{...rest}
			ref={containerRef}
			skin={appearance.isDark ? "dark" : "light"}
			thumbStyle={getThumbStyle}
			trackStyle={getTrackStyle}
		>
			{children}
		</MacScrollbar>
	);
});

export default Scrollbar;
