import { globalStore } from "@/stores/global";
import { useSnapshot } from "valtio";

export const useAppTheme = () => {
	const { appearance } = useSnapshot(globalStore);

	return {
		theme: appearance.isDark ? "dark" : "light",
		isDark: appearance.isDark,
	};
};
