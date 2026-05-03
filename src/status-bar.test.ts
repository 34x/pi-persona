import { describe, it, expect } from "vitest";
import { formatStatusBar } from "./status-bar";

describe("formatStatusBar", () => {
  it("should return null when no persona and no context", () => {
    expect(formatStatusBar(null, 0)).toBeNull();
  });

  it("should show persona only", () => {
    expect(formatStatusBar("TDD Expert", 0)).toBe("[persona: TDD Expert]");
  });

  it("should show context count only", () => {
    expect(formatStatusBar(null, 3)).toBe("ctx: 3");
  });

  it("should show both persona and context count", () => {
    expect(formatStatusBar("Pirate", 2)).toBe("[persona: Pirate] ctx: 2");
  });

  it("should show context count of 1", () => {
    expect(formatStatusBar(null, 1)).toBe("ctx: 1");
  });

  it("should show persona even with 0 context", () => {
    expect(formatStatusBar("Dev", 0)).toBe("[persona: Dev]");
  });

  it("should not show context when count is 0", () => {
    const result = formatStatusBar(null, 0);
    expect(result).toBeNull();
  });

  it("should not autoload when count is 0", () => {
    expect(formatStatusBar(null, 0)).toBeNull();
  });

  it("should not show autoload when count is 0 with context", () => {
    expect(formatStatusBar(null, 1)).toBe("ctx: 1");
  });
});
