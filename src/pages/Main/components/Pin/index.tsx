import UnoIcon from "@/components/UnoIcon";
import { setWindowAlwaysOnTop } from "@/plugins/window";
import clsx from "clsx";
import { useEffect } from "react";
import { MainContext } from "../..";

const Pin = () => {
	const { state } = useContext(MainContext);

	useKeyPress(PRESET_SHORTCUT.FIXED_WINDOW, () => {
		togglePin();
	});

	const togglePin = () => {
		state.pin = !state.pin;
		setWindowAlwaysOnTop(state.pin);
	};

	// Pin 开启时，定期保持置顶状态
	useEffect(() => {
		if (!state.pin) return;

		const interval = setInterval(() => {
			setWindowAlwaysOnTop(true);
		}, 500);

		return () => clearInterval(interval);
	}, [state.pin]);

	return (
		<UnoIcon
			hoverable
			active={state.pin}
			name="i-lets-icons:pin"
			className={clsx({ "-rotate-45": !state.pin })}
			onMouseDown={togglePin}
		/>
	);
};

export default Pin;
