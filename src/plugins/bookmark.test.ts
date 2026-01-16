import { describe, expect, it } from "vitest";

// Test module structure without actual Tauri invoke calls
describe("bookmark plugin", () => {
	it("should export required functions", async () => {
		const bookmark = await import("./bookmark");

		expect(bookmark).toHaveProperty("loadBookmarkData");
		expect(bookmark).toHaveProperty("saveBookmarkData");
		expect(bookmark).toHaveProperty("addBookmarkGroup");
		expect(bookmark).toHaveProperty("updateBookmarkGroup");
		expect(bookmark).toHaveProperty("deleteBookmarkGroup");
		expect(bookmark).toHaveProperty("reorderBookmarkGroups");
	});

	it("should have correct function types", async () => {
		const bookmark = await import("./bookmark");

		expect(typeof bookmark.loadBookmarkData).toBe("function");
		expect(typeof bookmark.saveBookmarkData).toBe("function");
		expect(typeof bookmark.addBookmarkGroup).toBe("function");
		expect(typeof bookmark.updateBookmarkGroup).toBe("function");
		expect(typeof bookmark.deleteBookmarkGroup).toBe("function");
		expect(typeof bookmark.reorderBookmarkGroups).toBe("function");
	});
});
