import { invoke } from "@tauri-apps/api/core";

export interface ActiveWindowInfo {
	app_name: string;
	window_title: string;
	process_name: string;
}

export const getActiveWindowInfo = async (): Promise<ActiveWindowInfo> => {
	return invoke("plugin:eco-active-window|get_active_window_info");
};
