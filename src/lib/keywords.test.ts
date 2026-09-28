import assert from "node:assert/strict";
import { test } from "vitest";
import { compileKeywordMatcher } from "./keywords.js";

const kw = (phrase: string, tag: string | null = null) => ({ phrase, tag });

test("matches case-insensitively and returns the pair", () => {
  const matcher = compileKeywordMatcher([kw("mint live", "Mint")]);
  assert.deepEqual(matcher.match("The MINT LIVE is now open"), [
    { phrase: "mint live", tag: "Mint" },
  ]);
});

test("does not match inside longer words", () => {
  const matcher = compileKeywordMatcher([kw("gtd"), kw("wl")]);
  assert.deepEqual(matcher.match("xgtdx owls everywhere"), []);
});

test("matches adjacent to punctuation", () => {
  const matcher = compileKeywordMatcher([kw("wl", "WL")]);
  assert.deepEqual(matcher.match("wl! get yours"), [
    { phrase: "wl", tag: "WL" },
  ]);
});

test("regex metacharacters in phrases are literal (operators)", () => {
  const matcher = compileKeywordMatcher([kw("t+2")]);
  assert.deepEqual(matcher.match("round opens at t+2 tomorrow"), [
    { phrase: "t+2", tag: null },
  ]);
  assert.deepEqual(matcher.match("round opens at ttt2 tomorrow"), []);
});

test("regex metacharacters in phrases are literal (boundaries)", () => {
  const matcher = compileKeywordMatcher([kw("100x")]);
  assert.deepEqual(matcher.match("this goes 100x!"), [
    { phrase: "100x", tag: null },
  ]);
  assert.deepEqual(matcher.match("this goes 100x7"), []);
});

test("returns matches in keyword-list order", () => {
  const matcher = compileKeywordMatcher([kw("wl", "WL"), kw("mint live")]);
  assert.deepEqual(matcher.match("mint live — WL allocation"), [
    { phrase: "wl", tag: "WL" },
    { phrase: "mint live", tag: null },
  ]);
});

test("no keywords matches nothing", () => {
  const matcher = compileKeywordMatcher([]);
  assert.deepEqual(matcher.match("mint live"), []);
});

test("empty text matches nothing", () => {
  const matcher = compileKeywordMatcher([kw("mint")]);
  assert.deepEqual(matcher.match(""), []);
});

test("multi-word phrases match the literal sequence", () => {
  const matcher = compileKeywordMatcher([kw("whitelist open", "WL")]);
  assert.deepEqual(matcher.match("Whitelist   Open now".replace(/ {3}/, " ")), [
    { phrase: "whitelist open", tag: "WL" },
  ]);
});
