import UnoIcon from "@/components/UnoIcon";
import clsx from "clsx";
import { useContext } from "react";
import { MainContext } from "../..";

const FavoriteToggle = () => {
	const { state, getListCache, getListDebounced } = useContext(MainContext);

	const isActive = state.favorite === true;

	const handleToggle = () => {
		state.favorite = state.favorite ? undefined : true;
		getListCache?.current?.clear();
		getListDebounced?.(50);
	};

	return (
		<UnoIcon
			hoverable
			active={isActive}
			name="i-lucide:star"
			className={clsx({ "text-yellow-500": isActive })}
			title={isActive ? "取消收藏筛选" : "只显示收藏"}
			onMouseDown={handleToggle}
		/>
	);
};

export default FavoriteToggle;
