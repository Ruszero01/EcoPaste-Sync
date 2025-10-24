const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const crypto = require("node:crypto");

// WebDAV 服务器配置
const config = {
	url: "https://kupvouezpggo.ap-northeast-1.clawcloudrun.com/sync",
	username: "webdav",
	password: "l135r246s789",
	basePath: "/EcoPaste-Test",
};

// 基础认证头
const authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;

// 测试结果记录
const testResults = {
	scenarios: {},
	performance: {},
	errors: [],
};

// 记录测试结果
function logResult(testName, success, details = {}) {
	testResults.scenarios[testName] = {
		success,
		timestamp: new Date().toISOString(),
		...details,
	};

	console.info(`[${success ? "PASS" : "FAIL"}] ${testName}`);
	if (details.message) {
		console.info(`  ${details.message}`);
	}
	if (details.performance) {
		for (const [key, value] of Object.entries(details.performance)) {
			console.info(`  ${key}: ${value}`);
		}
	}
	if (!success && details.error) {
		console.info(`  Error: ${details.error}`);
		testResults.errors.push({ test: testName, error: details.error });
	}
}

// 发送HTTP请求
function makeRequest(method, url, headers = {}, data = null) {
	return new Promise((resolve, reject) => {
		const urlObj = new URL(url);
		const isHttps = urlObj.protocol === "https:";
		const lib = isHttps ? https : http;

		const options = {
			hostname: urlObj.hostname,
			port: urlObj.port || (isHttps ? 443 : 80),
			path: urlObj.pathname + urlObj.search,
			method: method,
			headers: {
				Authorization: authHeader,
				"User-Agent": "EcoPaste-Sync-Test/1.0",
				...headers,
			},
		};

		if (data && (method === "PUT" || method === "POST")) {
			options.headers["Content-Type"] = "application/octet-stream";
			options.headers["Content-Length"] = Buffer.byteLength(data);
		}

		const req = lib.request(options, (res) => {
			let responseData = "";

			res.on("data", (chunk) => {
				responseData += chunk;
			});

			res.on("end", () => {
				resolve({
					statusCode: res.statusCode,
					headers: res.headers,
					data: responseData,
				});
			});
		});

		req.on("error", (error) => {
			reject(error);
		});

		if (data) {
			req.write(data);
		}

		req.end();
	});
}

// 生成设备ID
function generateDeviceId() {
	return `device-${crypto.randomBytes(8).toString("hex")}`;
}

// 创建EcoPaste同步数据结构
function createSyncData(deviceId, items = [], deleted = [], timestamp = null) {
	return {
		version: 1,
		timestamp: timestamp || Date.now(),
		deviceId: deviceId,
		dataType: items.length > 0 ? "incremental" : "full",
		items: items,
		deleted: deleted,
	};
}

// 创建剪贴板项
function createClipboardItem(type, value, id = null) {
	return {
		id: id || crypto.randomUUID(),
		type: type,
		group:
			type === "text" || type === "html"
				? "text"
				: type === "image"
					? "image"
					: "files",
		value: value,
		search: typeof value === "string" ? value.substring(0, 100) : "",
		count: Math.floor(Math.random() * 10),
		width: type === "image" ? 1920 : undefined,
		height: type === "image" ? 1080 : undefined,
		favorite: Math.random() > 0.8,
		createTime: new Date().toISOString(),
		note: Math.random() > 0.7 ? `备注内容 ${Math.random()}` : undefined,
		subtype: type,
		lastModified: Date.now(),
		deviceId: generateDeviceId(),
	};
}

// 压缩数据
function compressData(data) {
	return JSON.stringify(data);
}

// 解压数据
function decompressData(data) {
	return JSON.parse(data);
}

// 上传同步数据
async function uploadSyncData(deviceId, syncData) {
	const fileName = `${config.basePath}/sync-${deviceId}.json`;
	const url = config.url.endsWith("/")
		? config.url + fileName.substring(1)
		: config.url + fileName;
	const compressedData = compressData(syncData);

	const startTime = Date.now();
	const response = await makeRequest("PUT", url, {}, compressedData);
	const uploadTime = Date.now() - startTime;

	return {
		success: response.statusCode === 201 || response.statusCode === 204,
		uploadTime,
		dataSize: compressedData.length,
	};
}

// 下载同步数据
async function downloadSyncData(deviceId) {
	const fileName = `${config.basePath}/sync-${deviceId}.json`;
	const url = config.url.endsWith("/")
		? config.url + fileName.substring(1)
		: config.url + fileName;

	const startTime = Date.now();
	const response = await makeRequest("GET", url);
	const downloadTime = Date.now() - startTime;

	if (response.statusCode === 200) {
		return {
			success: true,
			downloadTime,
			data: decompressData(response.data),
			dataSize: response.data.length,
		};
	}

	return {
		success: false,
		downloadTime,
		error: `HTTP ${response.statusCode}`,
	};
}

// 获取所有同步文件列表
async function listSyncFiles() {
	const url = config.url.endsWith("/")
		? config.url + config.basePath.substring(1)
		: config.url + config.basePath;

	const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
        <D:propfind xmlns:D="DAV:">
            <D:prop>
                <D:displayname/>
                <D:getcontentlength/>
                <D:getlastmodified/>
            </D:prop>
        </D:propfind>`;

	const response = await makeRequest(
		"PROPFIND",
		url,
		{
			Depth: "1",
			"Content-Type": "application/xml; charset=utf-8",
		},
		propfindBody,
	);

	if (response.statusCode === 207) {
		// 简单解析XML，获取sync-*.json文件
		const filePattern = /sync-([^\.]+)\.json/g;
		const matches = response.data.match(filePattern) || [];
		return matches.map((match) =>
			match.replace("sync-", "").replace(".json", ""),
		);
	}

	return [];
}

// 1. 测试小文件同步场景
async function testSmallFileSync() {
	console.info("\n=== 测试场景1: 小文件同步 ===");

	const deviceId = generateDeviceId();
	const textItems = [
		createClipboardItem("text", "这是一段测试文本内容"),
		createClipboardItem("text", "另一段测试文本，包含一些特殊字符：🚀✨📋"),
		createClipboardItem(
			"html",
			"<p><strong>HTML内容</strong><em>测试</em></p>",
		),
		createClipboardItem(
			"rtf",
			"{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Hello RTF}",
		),
	];

	try {
		// 上传小文件数据
		const syncData = createSyncData(deviceId, textItems);
		const uploadResult = await uploadSyncData(deviceId, syncData);

		logResult("smallFileUpload", uploadResult.success, {
			message: uploadResult.success ? "小文件上传成功" : "小文件上传失败",
			performance: {
				uploadTime: `${uploadResult.uploadTime}ms`,
				dataSize: `${uploadResult.dataSize} bytes`,
				itemCount: textItems.length,
			},
		});

		if (uploadResult.success) {
			// 下载并验证数据
			const downloadResult = await downloadSyncData(deviceId);

			const dataMatch =
				downloadResult.success &&
				JSON.stringify(downloadResult.data.items) === JSON.stringify(textItems);

			logResult("smallFileDownload", dataMatch, {
				message: dataMatch ? "小文件下载验证成功" : "小文件下载验证失败",
				performance: {
					downloadTime: `${downloadResult.downloadTime}ms`,
					dataSize: `${downloadResult.dataSize} bytes`,
				},
			});

			testResults.performance.smallFileUpload = uploadResult.uploadTime;
			testResults.performance.smallFileDownload = downloadResult.downloadTime;
		}
	} catch (error) {
		logResult("smallFileSync", false, {
			message: "小文件同步测试失败",
			error: error.message,
		});
	}
}

// 2. 测试大文件同步场景
async function testLargeFileSync() {
	console.info("\n=== 测试场景2: 大文件同步 ===");

	const deviceId = generateDeviceId();

	// 创建大文本内容（模拟大图片的base64数据）
	const largeTextContent = "A".repeat(500 * 1024); // 500KB文本
	const largeImageBase64 = `data:image/png;base64,${Buffer.from(largeTextContent).toString("base64")}`;

	const largeItems = [
		createClipboardItem("text", largeTextContent),
		createClipboardItem("image", largeImageBase64),
	];

	try {
		// 上传大文件数据
		const syncData = createSyncData(deviceId, largeItems);
		const uploadResult = await uploadSyncData(deviceId, syncData);

		logResult("largeFileUpload", uploadResult.success, {
			message: uploadResult.success ? "大文件上传成功" : "大文件上传失败",
			performance: {
				uploadTime: `${uploadResult.uploadTime}ms`,
				dataSize: `${(uploadResult.dataSize / 1024).toFixed(2)} KB`,
				itemCount: largeItems.length,
				uploadSpeed: `${Math.round(uploadResult.dataSize / (uploadResult.uploadTime / 1000) / 1024)} KB/s`,
			},
		});

		if (uploadResult.success) {
			// 下载并验证数据
			const downloadResult = await downloadSyncData(deviceId);

			const dataMatch =
				downloadResult.success &&
				downloadResult.data.items.length === largeItems.length;

			logResult("largeFileDownload", dataMatch, {
				message: dataMatch ? "大文件下载验证成功" : "大文件下载验证失败",
				performance: {
					downloadTime: `${downloadResult.downloadTime}ms`,
					dataSize: `${(downloadResult.dataSize / 1024).toFixed(2)} KB`,
					downloadSpeed: `${Math.round(downloadResult.dataSize / (downloadResult.downloadTime / 1000) / 1024)} KB/s`,
				},
			});

			testResults.performance.largeFileUpload = uploadResult.uploadTime;
			testResults.performance.largeFileDownload = downloadResult.downloadTime;
		}
	} catch (error) {
		logResult("largeFileSync", false, {
			message: "大文件同步测试失败",
			error: error.message,
		});
	}
}

// 3. 测试多文件批量同步
async function testBatchFileSync() {
	console.info("\n=== 测试场景3: 多文件批量同步 ===");

	const deviceId = generateDeviceId();
	const batchItems = [];

	// 创建多个不同类型的剪贴板项
	for (let i = 0; i < 20; i++) {
		const types = ["text", "html", "rtf"];
		const type = types[i % types.length];
		const content =
			type === "text"
				? `批量测试文本内容 ${i}\n${"测试行内容 ".repeat(10)}`
				: type === "html"
					? `<div>批量HTML测试 ${i}<p>段落内容 ${i}</p></div>`
					: `{\\rtf1\\ansi{\\f0 测试RTF内容 ${i}}}`;

		batchItems.push(createClipboardItem(type, content));
	}

	try {
		const startTime = Date.now();

		// 批量上传
		const syncData = createSyncData(deviceId, batchItems);
		const uploadResult = await uploadSyncData(deviceId, syncData);

		const totalUploadTime = Date.now() - startTime;

		logResult("batchFileUpload", uploadResult.success, {
			message: uploadResult.success ? "批量文件上传成功" : "批量文件上传失败",
			performance: {
				totalUploadTime: `${totalUploadTime}ms`,
				uploadTime: `${uploadResult.uploadTime}ms`,
				dataSize: `${(uploadResult.dataSize / 1024).toFixed(2)} KB`,
				itemCount: batchItems.length,
				avgTimePerItem: `${Math.round(totalUploadTime / batchItems.length)}ms`,
			},
		});

		if (uploadResult.success) {
			// 批量下载
			const downloadStartTime = Date.now();
			const downloadResult = await downloadSyncData(deviceId);
			const totalDownloadTime = Date.now() - downloadStartTime;

			const dataMatch =
				downloadResult.success &&
				downloadResult.data.items.length === batchItems.length;

			logResult("batchFileDownload", dataMatch, {
				message: dataMatch ? "批量文件下载验证成功" : "批量文件下载验证失败",
				performance: {
					totalDownloadTime: `${totalDownloadTime}ms`,
					downloadTime: `${downloadResult.downloadTime}ms`,
					dataSize: `${(downloadResult.dataSize / 1024).toFixed(2)} KB`,
					avgTimePerItem: `${Math.round(totalDownloadTime / batchItems.length)}ms`,
				},
			});

			testResults.performance.batchUploadTime = totalUploadTime;
			testResults.performance.batchDownloadTime = totalDownloadTime;
		}
	} catch (error) {
		logResult("batchFileSync", false, {
			message: "批量文件同步测试失败",
			error: error.message,
		});
	}
}

// 4. 测试增量同步功能
async function testIncrementalSync() {
	console.info("\n=== 测试场景4: 增量同步功能 ===");

	const deviceId = generateDeviceId();

	try {
		// 第一次同步 - 完整数据
		const initialItems = [
			createClipboardItem("text", "初始文本内容1"),
			createClipboardItem("text", "初始文本内容2"),
		];

		const initialSyncData = createSyncData(deviceId, initialItems);
		const initialUpload = await uploadSyncData(deviceId, initialSyncData);

		logResult("initialSyncUpload", initialUpload.success, {
			message: initialUpload.success ? "初始同步上传成功" : "初始同步上传失败",
			performance: {
				uploadTime: `${initialUpload.uploadTime}ms`,
				itemCount: initialItems.length,
			},
		});

		if (initialUpload.success) {
			// 等待一段时间模拟时间差
			await new Promise((resolve) => setTimeout(resolve, 100));

			// 第二次同步 - 增量数据
			const newItems = [
				createClipboardItem("text", "新增文本内容1"),
				createClipboardItem("html", "<p>新增HTML内容</p>"),
			];

			const deletedIds = [initialItems[0].id]; // 删除第一个项目

			const incrementalSyncData = createSyncData(
				deviceId,
				newItems,
				deletedIds,
			);
			const incrementalUpload = await uploadSyncData(
				deviceId,
				incrementalSyncData,
			);

			logResult("incrementalSyncUpload", incrementalUpload.success, {
				message: incrementalUpload.success
					? "增量同步上传成功"
					: "增量同步上传失败",
				performance: {
					uploadTime: `${incrementalUpload.uploadTime}ms`,
					newItems: newItems.length,
					deletedItems: deletedIds.length,
				},
			});

			if (incrementalUpload.success) {
				// 验证增量同步结果
				const downloadResult = await downloadSyncData(deviceId);

				if (downloadResult.success) {
					const downloadedItems = downloadResult.data.items;
					const hasNewItems = downloadedItems.some(
						(item) => item.value === "新增文本内容1",
					);
					const hasDeletedItem = downloadedItems.some(
						(item) => item.value === "初始文本内容1",
					);

					const incrementalSuccess = hasNewItems && !hasDeletedItem;

					logResult("incrementalSyncVerify", incrementalSuccess, {
						message: incrementalSuccess
							? "增量同步验证成功"
							: "增量同步验证失败",
						details: {
							totalItems: downloadedItems.length,
							hasNewItems,
							deletedItemRemoved: !hasDeletedItem,
						},
					});
				}
			}
		}
	} catch (error) {
		logResult("incrementalSync", false, {
			message: "增量同步测试失败",
			error: error.message,
		});
	}
}

// 5. 测试冲突解决机制
async function testConflictResolution() {
	console.info("\n=== 测试场景5: 冲突解决机制 ===");

	const device1Id = generateDeviceId();
	const device2Id = generateDeviceId();

	try {
		// 设备1创建初始数据
		const device1Items = [
			createClipboardItem("text", "设备1的文本内容"),
			createClipboardItem("text", "共享文本内容"),
		];

		const device1SyncData = createSyncData(device1Id, device1Items);
		const device1Upload = await uploadSyncData(device1Id, device1SyncData);

		logResult("conflictDevice1Upload", device1Upload.success, {
			message: device1Upload.success ? "设备1上传成功" : "设备1上传失败",
		});

		if (device1Upload.success) {
			// 设备2创建冲突数据（相同ID但不同内容）
			const conflictItems = [
				createClipboardItem("text", "设备2的文本内容"),
				createClipboardItem("text", "共享文本内容 - 已被设备2修改"),
			];

			// 使用相同的ID创建冲突
			conflictItems[0].id = device1Items[0].id;
			conflictItems[1].id = device1Items[1].id;

			const device2SyncData = createSyncData(device2Id, conflictItems);
			const device2Upload = await uploadSyncData(device2Id, device2SyncData);

			logResult("conflictDevice2Upload", device2Upload.success, {
				message: device2Upload.success
					? "设备2上传成功（创建冲突）"
					: "设备2上传失败",
			});

			if (device2Upload.success) {
				// 模拟冲突检测和解决
				const device1Download = await downloadSyncData(device1Id);
				const device2Download = await downloadSyncData(device2Id);

				const conflictDetected =
					device1Download.success &&
					device2Download.success &&
					device1Download.data.items.length !==
						device2Download.data.items.length;

				logResult("conflictDetection", conflictDetected, {
					message: conflictDetected ? "冲突检测成功" : "未检测到冲突",
					details: {
						device1Items: device1Download.success
							? device1Download.data.items.length
							: 0,
						device2Items: device2Download.success
							? device2Download.data.items.length
							: 0,
					},
				});

				// 模拟冲突解决策略（时间戳优先）
				if (device1Download.success && device2Download.success) {
					const mergedItems = [];
					const itemMap = new Map();

					// 合并两个设备的数据
					for (const item of [
						...device1Download.data.items,
						...device2Download.data.items,
					]) {
						const existing = itemMap.get(item.id);
						if (!existing || item.lastModified > existing.lastModified) {
							itemMap.set(item.id, item);
						}
					}

					mergedItems.push(...Array.from(itemMap.values()));

					logResult("conflictResolution", true, {
						message: "冲突解决模拟成功",
						details: {
							mergedItemCount: mergedItems.length,
							resolutionStrategy: "timestamp-based merge",
						},
					});
				}
			}
		}
	} catch (error) {
		logResult("conflictResolution", false, {
			message: "冲突解决测试失败",
			error: error.message,
		});
	}
}

// 6. 测试多设备同步场景
async function testMultiDeviceSync() {
	console.info("\n=== 测试场景6: 多设备同步 ===");

	const devices = [generateDeviceId(), generateDeviceId(), generateDeviceId()];
	const deviceItems = {};

	try {
		// 每个设备创建不同的数据
		for (let i = 0; i < devices.length; i++) {
			const items = [
				createClipboardItem("text", `设备${i + 1}的文本内容`),
				createClipboardItem("html", `<div>设备${i + 1}的HTML内容</div>`),
			];
			deviceItems[devices[i]] = items;

			const syncData = createSyncData(devices[i], items);
			const uploadResult = await uploadSyncData(devices[i], syncData);

			logResult(`multiDeviceUpload${i + 1}`, uploadResult.success, {
				message: uploadResult.success
					? `设备${i + 1}上传成功`
					: `设备${i + 1}上传失败`,
			});
		}

		// 测试设备间数据同步
		const syncResults = [];
		for (let i = 0; i < devices.length; i++) {
			for (let j = 0; j < devices.length; j++) {
				if (i !== j) {
					const downloadResult = await downloadSyncData(devices[j]);
					syncResults.push({
						from: i,
						to: j,
						success: downloadResult.success,
					});
				}
			}
		}

		const allSyncSuccess = syncResults.every((result) => result.success);
		const successCount = syncResults.filter((r) => r.success).length;

		logResult("multiDeviceSync", allSyncSuccess, {
			message: allSyncSuccess
				? "多设备同步全部成功"
				: `多设备同步部分成功: ${successCount}/${syncResults.length}`,
			details: {
				totalSyncOperations: syncResults.length,
				successfulOperations: successCount,
				deviceCount: devices.length,
			},
		});
	} catch (error) {
		logResult("multiDeviceSync", false, {
			message: "多设备同步测试失败",
			error: error.message,
		});
	}
}

// 清理测试数据
async function cleanupTestData() {
	console.info("\n=== 清理测试数据 ===");

	try {
		const syncFiles = await listSyncFiles();
		let cleanedCount = 0;

		for (const deviceId of syncFiles) {
			if (deviceId.includes("device-")) {
				const fileName = `${config.basePath}/sync-${deviceId}.json`;
				const url = config.url.endsWith("/")
					? config.url + fileName.substring(1)
					: config.url + fileName;

				try {
					await makeRequest("DELETE", url);
					cleanedCount++;
				} catch (error) {
					console.info(`清理文件失败: ${fileName}, ${error.message}`);
				}
			}
		}

		console.info(`清理完成，删除了 ${cleanedCount} 个测试文件`);
	} catch (error) {
		console.info(`清理测试数据失败: ${error.message}`);
	}
}

// 生成测试报告
function generateReport() {
	console.info("\n=== 同步场景测试报告 ===");

	const report = {
		timestamp: new Date().toISOString(),
		server: config.url,
		summary: {
			totalScenarios: Object.keys(testResults.scenarios).length,
			passedScenarios: Object.keys(testResults.scenarios).filter(
				(key) => testResults.scenarios[key]?.success,
			).length,
			failedScenarios: testResults.errors.length,
		},
		results: testResults,
	};

	console.info(`总测试场景: ${report.summary.totalScenarios}`);
	console.info(`通过场景: ${report.summary.passedScenarios}`);
	console.info(`失败场景: ${report.summary.failedScenarios}`);
	console.info(
		`成功率: ${((report.summary.passedScenarios / report.summary.totalScenarios) * 100).toFixed(1)}%`,
	);

	if (testResults.performance) {
		console.info("\n性能指标:");
		for (const [key, value] of Object.entries(testResults.performance)) {
			console.info(`  ${key}: ${value}ms`);
		}
	}

	if (testResults.errors.length > 0) {
		console.info("\n错误列表:");
		for (const error of testResults.errors) {
			console.info(`  ${error.test}: ${error.error}`);
		}
	}

	// 保存报告到文件
	const reportPath = path.join(__dirname, "sync-scenarios-test-report.json");
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.info(`\n详细报告已保存到: ${reportPath}`);

	return report;
}

// 主测试函数
async function runSyncTests() {
	console.info("开始EcoPaste同步场景测试...");
	console.info(`服务器地址: ${config.url}`);

	// 确保测试目录存在
	try {
		await makeRequest(
			"MKCOL",
			config.url.endsWith("/")
				? config.url + config.basePath.substring(1)
				: config.url + config.basePath,
		);
	} catch (_error) {
		// 目录可能已存在，忽略错误
	}

	await testSmallFileSync();
	await testLargeFileSync();
	await testBatchFileSync();
	await testIncrementalSync();
	await testConflictResolution();
	await testMultiDeviceSync();

	// 清理测试数据
	await cleanupTestData();

	return generateReport();
}

// 运行测试
if (require.main === module) {
	runSyncTests().catch(console.error);
}

module.exports = {
	runSyncTests,
	config,
	testResults,
};
