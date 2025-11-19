import { isLinux, isWin } from "@/utils/is";
import clsx from "clsx";
import MainLayout from "../MainLayout";

const Float = () => {
	return (
		<div
			className={clsx("h-screen", {
				"rounded-2.5": !isLinux,
				"b b-color-1": isLinux,
				"bg-color-1": !isWin,
				"bg-transparent": isWin, // Windows 上使用透明背景以显示 Mica 效果
			})}
		>
			<MainLayout />
		</div>
	);
};

export default Float;
