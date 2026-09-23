import { describe, it, expect } from "vitest";
import { shouldShow } from "./filter-evaluator.js";

const item = (projectId: string, text: string) => ({ projectId, text });

describe("shouldShow", () => {
  it("empty follows shows everything (back-compat)", () => {
    expect(shouldShow(item("p1", "hi"), new Set(), [], [])).toBe(true);
  });

  it("non-empty follows hides projects not followed", () => {
    expect(shouldShow(item("p1", "hi"), new Set(["p2"]), [], [])).toBe(false);
  });

  it("hide-filter wins over follow (Review Focus #2)", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(["p1"]), [
        { kind: "project", projectId: "p1", action: "hide", isActive: true },
      ], []),
    ).toBe(false);
  });

  it("mute keyword matches case-insensitively by default", () => {
    expect(
      shouldShow(item("p1", "hello world"), new Set(), [], [
        { pattern: "WORLD", isRegex: false },
      ]),
    ).toBe(false);
  });

  it("mute keyword regex works when isRegex", () => {
    expect(
      shouldShow(item("p1", "rt @user hello"), new Set(), [], [
        { pattern: "^rt\\b", isRegex: true },
      ]),
    ).toBe(false);
  });

  it("inactive filters are ignored", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(), [
        { kind: "project", projectId: "p1", action: "hide", isActive: false },
      ], []),
    ).toBe(true);
  });

  it("hide-filter wins over mute-keyword when both match (Review Focus #2)", () => {
    expect(
      shouldShow(item("p1", "spam hello"), new Set(), [
        { kind: "project", projectId: "p1", action: "hide", isActive: true },
      ], [{ pattern: "spam", isRegex: false }]),
    ).toBe(false);
  });

  it("keep filter overrides a hide filter that also matches", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(["p1"]), [
        { kind: "project", projectId: "p1", action: "hide", isActive: true },
        { kind: "keyword", pattern: "hi", action: "keep", isActive: true },
      ], []),
    ).toBe(true);
  });

  it("keep filter overrides a mute that also matches", () => {
    expect(
      shouldShow(item("p1", "spam hello"), new Set(), [
        { kind: "keyword", pattern: "spam", action: "keep", isActive: true },
      ], [{ pattern: "spam", isRegex: false }]),
    ).toBe(true);
  });

  it("keep filter overrides the follow restriction for an unfollowed project", () => {
    expect(
      shouldShow(item("p1", "hi"), new Set(["p2"]), [
        { kind: "project", projectId: "p1", action: "keep", isActive: true },
      ], []),
    ).toBe(true);
  });
});
