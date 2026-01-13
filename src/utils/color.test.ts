import { describe, expect, it } from "vitest";
import {
	cmykToRgb,
	hexToRgb,
	parseColorString,
	rgbToCmyk,
	rgbToHex,
} from "./color";

describe("color utils", () => {
	describe("hexToRgb", () => {
		it("should convert 6-digit hex to RGB", () => {
			expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
			expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
			expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
			expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
		});

		it("should convert 3-digit hex to RGB", () => {
			expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
			expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
			expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
			expect(hexToRgb("#00f")).toEqual({ r: 0, g: 0, b: 255 });
		});

		it("should handle hex with leading/trailing spaces", () => {
			expect(hexToRgb("  #ffffff  ")).toEqual({ r: 255, g: 255, b: 255 });
		});

		it("should return null for invalid hex", () => {
			expect(hexToRgb("#gggggg")).toBeNull();
			expect(hexToRgb("#")).toBeNull();
			expect(hexToRgb("#ff")).toBeNull();
			expect(hexToRgb("#fffffff")).toBeNull();
			expect(hexToRgb("")).toBeNull();
		});
	});

	describe("rgbToHex", () => {
		it("should convert RGB to 6-digit hex", () => {
			expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
			expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
			expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
			expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
		});

		it("should pad single digit hex values", () => {
			expect(rgbToHex(15, 15, 15)).toBe("#0f0f0f");
			expect(rgbToHex(0, 0, 0)).toBe("#000000");
		});

		it("should throw error for out of range values", () => {
			expect(() => rgbToHex(256, 0, 0)).toThrow();
			expect(() => rgbToHex(-1, 0, 0)).toThrow();
			expect(() => rgbToHex(0, 0, 0)).not.toThrow();
		});
	});

	describe("cmykToRgb", () => {
		it("should convert CMYK to RGB", () => {
			expect(cmykToRgb(0, 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 });
			expect(cmykToRgb(0, 0, 0, 100)).toEqual({ r: 0, g: 0, b: 0 });
			expect(cmykToRgb(0, 100, 100, 0)).toEqual({ r: 255, g: 0, b: 0 });
			expect(cmykToRgb(100, 0, 100, 0)).toEqual({ r: 0, g: 255, b: 0 });
			expect(cmykToRgb(100, 100, 0, 0)).toEqual({ r: 0, g: 0, b: 255 });
		});

		it("should throw error for out of range values", () => {
			expect(() => cmykToRgb(101, 0, 0, 0)).toThrow();
			expect(() => cmykToRgb(-1, 0, 0, 0)).toThrow();
		});
	});

	describe("rgbToCmyk", () => {
		it("should convert RGB to CMYK", () => {
			expect(rgbToCmyk(255, 255, 255)).toEqual({ c: 0, m: 0, y: 0, k: 0 });
			expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
			expect(rgbToCmyk(255, 0, 0)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
		});

		it("should throw error for out of range values", () => {
			expect(() => rgbToCmyk(256, 0, 0)).toThrow();
			expect(() => rgbToCmyk(-1, 0, 0)).toThrow();
		});
	});

	describe("parseColorString", () => {
		it("should parse hex color", () => {
			const result = parseColorString("#ff0000");
			expect(result).not.toBeNull();
			expect(result?.format).toBe("hex");
			expect(result?.values.r).toBe(255);
			expect(result?.values.g).toBe(0);
			expect(result?.values.b).toBe(0);
		});

		it("should parse rgb() format", () => {
			const result = parseColorString("rgb(255, 0, 0)");
			expect(result).not.toBeNull();
			expect(result?.format).toBe("rgb");
			expect(result?.values.r).toBe(255);
		});

		it("should parse cmyk() format", () => {
			const result = parseColorString("cmyk(0, 100, 100, 0)");
			expect(result).not.toBeNull();
			expect(result?.format).toBe("cmyk");
			expect(result?.values.c).toBe(0);
		});

		it("should return null for invalid color", () => {
			expect(parseColorString("invalid")).toBeNull();
			expect(parseColorString("")).toBeNull();
		});
	});
});
