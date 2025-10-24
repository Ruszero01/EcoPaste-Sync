const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

// WebDAV 服务器配置
const config = {
	url: "https://kupvouezpggo.ap-northeast-1.cloucloudrun.com/sync",
	username: "webdav",
	password: "l135r246s789",
};

// 基础认证头
const authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;

// 测试结果记录
const testResults = {
	connection: null,
	webdavSupport: null,
	operations: {},
	performance: {},
	errors: [],
};

// 记录测试结果
function logResult(testName, success, details = {}) {
	testResults[testName] = {
		success,
		timestamp: new Date().toISOString(),
		...details,
	};

	console.info(`[${success ? "PASS" : "FAIL"}] ${testName}`);
	if (details.message) {
		console.info(`  ${details.message}`);
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
				"User-Agent": "EcoPaste-WebDAV-Test/1.0",
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

// 1. 测试基本连接和认证
async function testConnectionAndAuth() {
	console.info("\n=== 测试1: 基本连接和认证 ===");
	const startTime = Date.now();

	try {
		const response = await makeRequest("GET", config.url);
		const responseTime = Date.now() - startTime;

		if (response.statusCode === 200 || response.statusCode === 207) {
			logResult("connection", true, {
				message: `连接成功，状态码: ${response.statusCode}`,
				responseTime: `${responseTime}ms`,
				server: response.headers.server || "Unknown",
			});
			testResults.performance.connectionTime = responseTime;
		} else {
			logResult("connection", false, {
				message: `连接失败，状态码: ${response.statusCode}`,
				responseTime: `${responseTime}ms`,
			});
		}
	} catch (error) {
		logResult("connection", false, {
			message: "连接失败",
			error: error.message,
		});
	}
}

// 2. 测试WebDAV协议支持
async function testWebDAVSupport() {
	console.info("\n=== 测试2: WebDAV协议支持 ===");

	try {
		// 测试OPTIONS方法
		const optionsResponse = await makeRequest("OPTIONS", config.url);

		if (optionsResponse.statusCode === 200) {
			const allowedMethods = optionsResponse.headers.allow || "";
			const davHeader = optionsResponse.headers.dav || "";

			const hasWebDAV =
				allowedMethods.includes("PROPFIND") &&
				allowedMethods.includes("PROPPATCH") &&
				(davHeader.includes("1") || davHeader.includes("2"));

			logResult("webdavSupport", hasWebDAV, {
				message: hasWebDAV ? "支持WebDAV协议" : "WebDAV协议支持不完整",
				allowedMethods: allowedMethods.split(",").map((m) => m.trim()),
				davLevel: davHeader,
			});

			// 测试PROPFIND方法
			try {
				const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
                    <D:propfind xmlns:D="DAV:">
                        <D:prop>
                            <D:displayname/>
                            <D:resourcetype/>
                            <D:getcontentlength/>
                            <D:getlastmodified/>
                        </D:prop>
                    </D:propfind>`;

				const propfindResponse = await makeRequest(
					"PROPFIND",
					config.url,
					{
						Depth: "1",
						"Content-Type": "application/xml; charset=utf-8",
					},
					propfindBody,
				);

				logResult("propfindOperation", propfindResponse.statusCode === 207, {
					message: `PROPFIND操作，状态码: ${propfindResponse.statusCode}`,
					hasXmlContent: propfindResponse.data.includes("<?xml"),
				});
			} catch (error) {
				logResult("propfindOperation", false, {
					message: "PROPFIND操作失败",
					error: error.message,
				});
			}
		} else {
			logResult("webdavSupport", false, {
				message: `OPTIONS请求失败，状态码: ${optionsResponse.statusCode}`,
			});
		}
	} catch (error) {
		logResult("webdavSupport", false, {
			message: "WebDAV协议测试失败",
			error: error.message,
		});
	}
}

// 3. 测试目录操作
async function testDirectoryOperations() {
	console.info("\n=== 测试3: 目录操作 ===");

	const testDir = config.url.endsWith("/")
		? `${config.url}EcoPaste-Test/`
		: `${config.url}/EcoPaste-Test/`;

	try {
		// 创建目录
		const mkcolResponse = await makeRequest("MKCOL", testDir);
		const mkcolSuccess =
			mkcolResponse.statusCode === 201 || mkcolResponse.statusCode === 405; // 405表示目录已存在

		logResult("createDirectory", mkcolSuccess, {
			message: `MKCOL操作，状态码: ${mkcolResponse.statusCode}`,
			directory: testDir,
		});

		if (mkcolSuccess) {
			// 删除目录
			const deleteResponse = await makeRequest("DELETE", testDir);
			const deleteSuccess =
				deleteResponse.statusCode === 204 || deleteResponse.statusCode === 200;

			logResult("deleteDirectory", deleteSuccess, {
				message: `DELETE操作，状态码: ${deleteResponse.statusCode}`,
				directory: testDir,
			});
		}
	} catch (error) {
		logResult("directoryOperations", false, {
			message: "目录操作测试失败",
			error: error.message,
		});
	}
}

// 4. 测试文件上传下载
async function testFileOperations() {
	console.info("\n=== 测试4: 文件操作 ===");

	const testFile = config.url.endsWith("/")
		? `${config.url}test-file.txt`
		: `${config.url}/test-file.txt`;

	const testContent = `EcoPaste WebDAV测试文件\n创建时间: ${new Date().toISOString()}\n测试内容: Hello WebDAV!`;

	try {
		// 上传文件
		const uploadStartTime = Date.now();
		const putResponse = await makeRequest("PUT", testFile, {}, testContent);
		const uploadTime = Date.now() - uploadStartTime;

		const uploadSuccess =
			putResponse.statusCode === 201 || putResponse.statusCode === 204;

		logResult("uploadFile", uploadSuccess, {
			message: `PUT操作，状态码: ${putResponse.statusCode}`,
			uploadTime: `${uploadTime}ms`,
			fileSize: `${testContent.length} bytes`,
		});

		if (uploadSuccess) {
			testResults.performance.uploadTime = uploadTime;
			testResults.performance.uploadSpeed = Math.round(
				testContent.length / (uploadTime / 1000),
			); // bytes/s

			// 下载文件
			const downloadStartTime = Date.now();
			const getResponse = await makeRequest("GET", testFile);
			const downloadTime = Date.now() - downloadStartTime;

			const downloadSuccess =
				getResponse.statusCode === 200 && getResponse.data === testContent;

			logResult("downloadFile", downloadSuccess, {
				message: `GET操作，状态码: ${getResponse.statusCode}`,
				downloadTime: `${downloadTime}ms`,
				contentMatch: getResponse.data === testContent,
			});

			if (downloadSuccess) {
				testResults.performance.downloadTime = downloadTime;
				testResults.performance.downloadSpeed = Math.round(
					testContent.length / (downloadTime / 1000),
				); // bytes/s

				// 删除测试文件
				const deleteResponse = await makeRequest("DELETE", testFile);
				logResult("deleteFile", deleteResponse.statusCode === 204, {
					message: `删除文件，状态码: ${deleteResponse.statusCode}`,
				});
			}
		}
	} catch (error) {
		logResult("fileOperations", false, {
			message: "文件操作测试失败",
			error: error.message,
		});
	}
}

// 5. 测试大文件处理
async function testLargeFile() {
	console.info("\n=== 测试5: 大文件处理 ===");

	const testFile = config.url.endsWith("/")
		? `${config.url}test-large-file.dat`
		: `${config.url}/test-large-file.dat`;

	// 创建1MB的测试数据
	const largeData = Buffer.alloc(1024 * 1024, "A"); // 1MB

	try {
		// 上传大文件
		const uploadStartTime = Date.now();
		const putResponse = await makeRequest("PUT", testFile, {}, largeData);
		const uploadTime = Date.now() - uploadStartTime;

		const uploadSuccess =
			putResponse.statusCode === 201 || putResponse.statusCode === 204;

		logResult("uploadLargeFile", uploadSuccess, {
			message: `大文件上传，状态码: ${putResponse.statusCode}`,
			uploadTime: `${uploadTime}ms`,
			fileSize: `${(largeData.length / 1024 / 1024).toFixed(2)} MB`,
			uploadSpeed: `${Math.round(largeData.length / (uploadTime / 1000) / 1024)} KB/s`,
		});

		if (uploadSuccess) {
			testResults.performance.largeFileUploadTime = uploadTime;

			// 下载大文件
			const downloadStartTime = Date.now();
			const getResponse = await makeRequest("GET", testFile);
			const downloadTime = Date.now() - downloadStartTime;

			const downloadSuccess =
				getResponse.statusCode === 200 &&
				getResponse.data.length === largeData.length;

			logResult("downloadLargeFile", downloadSuccess, {
				message: `大文件下载，状态码: ${getResponse.statusCode}`,
				downloadTime: `${downloadTime}ms`,
				downloadSpeed: `${Math.round(largeData.length / (downloadTime / 1000) / 1024)} KB/s`,
			});

			if (downloadSuccess) {
				testResults.performance.largeFileDownloadTime = downloadTime;

				// 删除大文件
				const deleteResponse = await makeRequest("DELETE", testFile);
				logResult("deleteLargeFile", deleteResponse.statusCode === 204, {
					message: `删除大文件，状态码: ${deleteResponse.statusCode}`,
				});
			}
		}
	} catch (error) {
		logResult("largeFileTest", false, {
			message: "大文件测试失败",
			error: error.message,
		});
	}
}

// 6. 测试并发连接
async function testConcurrentConnections() {
	console.info("\n=== 测试6: 并发连接 ===");

	const concurrentCount = 5;
	const testFile = config.url.endsWith("/")
		? `${config.url}test-concurrent-`
		: `${config.url}/test-concurrent-`;

	const promises = [];
	const startTime = Date.now();

	for (let i = 0; i < concurrentCount; i++) {
		const fileName = `${testFile + i}.txt`;
		const testContent = `并发测试文件 ${i}\n时间: ${new Date().toISOString()}`;

		promises.push(
			makeRequest("PUT", fileName, {}, testContent)
				.then((response) => ({
					index: i,
					success: response.statusCode === 201 || response.statusCode === 204,
					statusCode: response.statusCode,
				}))
				.catch((error) => ({
					index: i,
					success: false,
					error: error.message,
				})),
		);
	}

	try {
		const results = await Promise.all(promises);
		const totalTime = Date.now() - startTime;
		const successCount = results.filter((r) => r.success).length;

		logResult("concurrentUpload", successCount === concurrentCount, {
			message: `并发上传: ${successCount}/${concurrentCount} 成功`,
			totalTime: `${totalTime}ms`,
			averageTime: `${Math.round(totalTime / concurrentCount)}ms`,
		});

		// 清理并发测试文件
		for (let i = 0; i < concurrentCount; i++) {
			try {
				await makeRequest("DELETE", `${testFile + i}.txt`);
			} catch (_error) {
				// 忽略删除错误
			}
		}
	} catch (error) {
		logResult("concurrentTest", false, {
			message: "并发测试失败",
			error: error.message,
		});
	}
}

// 7. 测试网络延迟和稳定性
async function testNetworkLatency() {
	console.info("\n=== 测试7: 网络延迟和稳定性 ===");

	const pingCount = 10;
	const latencies = [];

	for (let i = 0; i < pingCount; i++) {
		const startTime = Date.now();
		try {
			await makeRequest("GET", config.url);
			const latency = Date.now() - startTime;
			latencies.push(latency);

			// 避免请求过于频繁
			await new Promise((resolve) => setTimeout(resolve, 100));
		} catch (_error) {
			latencies.push(-1); // 标记失败的请求
		}
	}

	const successfulPings = latencies.filter((l) => l > 0);
	const failedPings = latencies.filter((l) => l === -1);

	if (successfulPings.length > 0) {
		const avgLatency =
			successfulPings.reduce((a, b) => a + b, 0) / successfulPings.length;
		const minLatency = Math.min(...successfulPings);
		const maxLatency = Math.max(...successfulPings);

		logResult("networkLatency", failedPings.length === 0, {
			message: "网络延迟测试完成",
			successRate: `${((successfulPings.length / pingCount) * 100).toFixed(1)}%`,
			avgLatency: `${Math.round(avgLatency)}ms`,
			minLatency: `${minLatency}ms`,
			maxLatency: `${maxLatency}ms`,
			failedRequests: failedPings.length,
		});

		testResults.performance.avgLatency = Math.round(avgLatency);
		testResults.performance.networkStability = failedPings.length === 0;
	} else {
		logResult("networkLatency", false, {
			message: "网络延迟测试失败，所有请求都失败",
			failedRequests: pingCount,
		});
	}
}

// 生成测试报告
function generateReport() {
	console.info("\n=== 测试报告 ===");

	const report = {
		timestamp: new Date().toISOString(),
		server: config.url,
		summary: {
			totalTests: Object.keys(testResults).filter((key) => key !== "errors")
				.length,
			passedTests: Object.keys(testResults).filter(
				(key) =>
					key !== "errors" && testResults[key] && testResults[key].success,
			).length,
			failedTests: testResults.errors.length,
		},
		results: testResults,
	};

	console.info(`总测试数: ${report.summary.totalTests}`);
	console.info(`通过测试: ${report.summary.passedTests}`);
	console.info(`失败测试: ${report.summary.failedTests}`);
	console.info(
		`成功率: ${((report.summary.passedTests / report.summary.totalTests) * 100).toFixed(1)}%`,
	);

	if (testResults.performance) {
		console.info("\n性能指标:");
		for (const [key, value] of Object.entries(testResults.performance)) {
			console.info(`  ${key}: ${value}`);
		}
	}

	if (testResults.errors.length > 0) {
		console.info("\n错误列表:");
		for (const error of testResults.errors) {
			console.info(`  ${error.test}: ${error.error}`);
		}
	}

	// 保存报告到文件
	const reportPath = path.join(__dirname, "webdav-test-report.json");
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.info(`\n详细报告已保存到: ${reportPath}`);

	return report;
}

// 主测试函数
async function runTests() {
	console.info("开始WebDAV服务器测试...");
	console.info(`服务器地址: ${config.url}`);

	await testConnectionAndAuth();
	await testWebDAVSupport();
	await testDirectoryOperations();
	await testFileOperations();
	await testLargeFile();
	await testConcurrentConnections();
	await testNetworkLatency();

	return generateReport();
}

// 运行测试
if (require.main === module) {
	runTests().catch(console.error);
}

module.exports = {
	runTests,
	config,
	testResults,
};
