import { describe, it, expect } from "vitest";
import { parseCookies } from "./middleware.js";

describe("parseCookies", () => {
  it("returns key=value pairs", () => {
    expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });
  it("returns {} for undefined or empty", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });
  it("decodes percent-encoded values", () => {
    expect(parseCookies("k=hello%20world")).toEqual({ k: "hello world" });
  });
});
