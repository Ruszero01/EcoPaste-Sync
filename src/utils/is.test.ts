import { describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/plugin-os before importing
vi.mock("@tauri-apps/plugin-os", () => ({
	platform: vi.fn(() => "windows"),
}));

describe("is utils", () => {
	describe("isURL", () => {
		it("should return true for valid URLs", async () => {
			const { isURL } = await import("./is");
			expect(isURL("https://example.com")).toBe(true);
			expect(isURL("http://localhost:3000")).toBe(true);
			expect(isURL("https://www.google.com/search?q=test")).toBe(true);
		});

		it("should return false for invalid URLs", async () => {
			const { isURL } = await import("./is");
			expect(isURL("not a url")).toBe(false);
			expect(isURL("")).toBe(false);
			// Note: is-url library considers ftp:// as valid URL
			expect(isURL("invalid")).toBe(false);
		});
	});

	describe("isImage", () => {
		it("should return true for image extensions", async () => {
			const { isImage } = await import("./is");
			expect(isImage("photo.jpg")).toBe(true);
			expect(isImage("image.png")).toBe(true);
			expect(isImage("picture.webp")).toBe(true);
			expect(isImage("icon.svg")).toBe(true);
			expect(isImage("PHOTO.JPEG")).toBe(true);
		});

		it("should return false for non-image extensions", async () => {
			const { isImage } = await import("./is");
			expect(isImage("file.txt")).toBe(false);
			expect(isImage("document.pdf")).toBe(false);
			expect(isImage("script.js")).toBe(false);
			expect(isImage("")).toBe(false);
		});
	});
});
