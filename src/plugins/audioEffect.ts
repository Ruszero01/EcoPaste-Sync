import { invoke } from "@tauri-apps/api/core";

export interface PlaySoundOptions {
	volume?: number;
}

export const playSound = async (
	soundName = "copy",
	options?: PlaySoundOptions,
): Promise<boolean> => {
	try {
		await invoke("plugin:eco-audio-effect|play_sound", {
			name: soundName,
			volume: options?.volume,
		});
		return true;
	} catch (error) {
		console.error("Failed to play sound:", error);
		return false;
	}
};

export const stopAllSounds = async (): Promise<boolean> => {
	try {
		await invoke("plugin:eco-audio-effect|stop_all_sounds");
		return true;
	} catch (error) {
		console.error("Failed to stop all sounds:", error);
		return false;
	}
};

export const cleanupAudio = async (): Promise<boolean> => {
	try {
		await invoke("plugin:eco-audio-effect|cleanup_audio");
		return true;
	} catch (error) {
		console.error("Failed to cleanup audio:", error);
		return false;
	}
};
