export type MatchedKeyword = { phrase: string; tag: string | null };
export type KeywordLike = { phrase: string; tag: string | null };

export type KeywordMatcher = {
  match: (text: string) => MatchedKeyword[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, word-boundary-safe literal matching. Runs of whitespace
 * in both the phrase and the text are collapsed first so "mint  live" in a
 * tweet still matches the phrase "mint live".
 */
export function compileKeywordMatcher(keywords: KeywordLike[]): KeywordMatcher {
  const rules = keywords.map((keyword) => {
    const phrase = keyword.phrase.trim().toLowerCase();
    const spaced = phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
    // Unicode lookarounds (not \b, which is ASCII-only) so short tokens like
    // "gtd" don't match inside longer words while punctuation still counts
    // as a boundary.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${spaced}(?![\\p{L}\\p{N}])`, "iu");
    return { phrase, tag: keyword.tag, pattern };
  });

  return {
    match(text: string): MatchedKeyword[] {
      const haystack = text.toLowerCase().replace(/\s+/g, " ");
      const seen = new Set<string>();
      const matched: MatchedKeyword[] = [];
      for (const rule of rules) {
        if (rule.phrase === "" || seen.has(rule.phrase)) continue;
        if (rule.pattern.test(haystack)) {
          seen.add(rule.phrase);
          matched.push({ phrase: rule.phrase, tag: rule.tag });
        }
      }
      return matched;
    },
  };
}
