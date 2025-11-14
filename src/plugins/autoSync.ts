/**
 * EcoPaste 自动同步插件
 * 用于管理后端定时自动同步功能
 */

import { invoke } from "@tauri-apps/api/core";

export interface AutoSyncConfig {
	enabled: boolean;
	intervalHours: number;
}

// 后端返回的状态
export interface AutoSyncStatus {
	enabled: boolean;
	interval_hours: number;
	last_sync_time?: number;
	next_sync_time?: number;
}

/**
 * 启动自动同步
 */
export async function startAutoSync(intervalHours: number): Promise<void> {
	await invoke("plugin:eco-auto-sync|start_auto_sync", { intervalHours });
}

/**
 * 停止自动同步
 */
export async function stopAutoSync(): Promise<void> {
	await invoke("plugin:eco-auto-sync|stop_auto_sync");
}

/**
 * 获取自动同步状态
 */
export async function getAutoSyncStatus(): Promise<AutoSyncStatus> {
	return await invoke("plugin:eco-auto-sync|get_auto_sync_status");
}

/**
 * 更新同步间隔
 */
export async function updateSyncInterval(intervalHours: number): Promise<void> {
	await invoke("plugin:eco-auto-sync|update_sync_interval", { intervalHours });
}
