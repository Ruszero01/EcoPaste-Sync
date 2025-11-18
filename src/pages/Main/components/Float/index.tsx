import clsx from "clsx";
import MainLayout from "../MainLayout";

const Float = () => {
	return (
		<div
			className={clsx("h-screen bg-color-1", {
				"rounded-2.5": !isWin,
				"b b-color-1": isLinux,
			})}
		>
			<MainLayout />
		</div>
	);
};

export default Float;
