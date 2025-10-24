/**
 * 返回一个延迟指定时间后解决的 Promise，用于异步操作中的延时控制。
 *
 * @param 等待的时间，单位为毫秒，默认为 1000 毫秒。
 */
export const wait = (ms = 1000) => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * 生成设备唯一标识
 */
export const generateDeviceId = (): string => {
	const timestamp = Date.now().toString(36);
	const randomStr = Math.random().toString(36).substring(2, 8);
	return `device-${timestamp}-${randomStr}`;
};

/**
 * 计算字符串的简单校验和
 */
export const calculateChecksum = (str: string): string => {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // 转换为32位整数
	}
	return Math.abs(hash).toString(16);
};
