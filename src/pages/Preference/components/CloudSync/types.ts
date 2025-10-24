export interface LogEntry {
	id: string;
	timestamp: string;
	level: "info" | "success" | "warning" | "error";
	message: string;
	data?: string;
}

export interface TestResult {
	success: boolean;
	message: string;
	data?: any;
	error?: string;
	duration?: number;
}

// WebDAVConfig is now imported from the webdav plugin to avoid type conflicts

export interface SyncTestSuite {
	networkConnection: TestResult;
	webdavConfig: TestResult;
	dataSerialization: TestResult;
	dataCompression: TestResult;
}
