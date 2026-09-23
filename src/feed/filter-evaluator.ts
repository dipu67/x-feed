export type FilterableItem = { projectId: string; text: string };

export type FilterRule = {
  kind: "project" | "keyword";
  projectId?: string;
  pattern?: string;
  action: "keep" | "hide";
  isActive: boolean;
};

export type MuteRule = {
  pattern: string;
  isRegex: boolean;
};

const compiledRegexCache = new WeakMap<MuteRule, RegExp | null>();

function muteMatcher(m: MuteRule): RegExp | null {
  if (!m.isRegex) return null;
  const cached = compiledRegexCache.get(m);
  if (cached !== undefined) return cached;
  let re: RegExp | null = null;
  try {
    re = new RegExp(m.pattern, "i");
  } catch {
    re = null;
  }
  compiledRegexCache.set(m, re);
  return re;
}

export function shouldShow(
  item: FilterableItem,
  follows: Set<string>,
  filters: FilterRule[],
  mutes: MuteRule[],
): boolean {
  if (follows.size > 0 && !follows.has(item.projectId)) return false;
  for (const f of filters) {
    if (!f.isActive || f.action !== "hide") continue;
    if (f.kind === "project" && f.projectId === item.projectId) return false;
    if (f.kind === "keyword" && f.pattern) {
      try {
        if (new RegExp(f.pattern, "i").test(item.text)) return false;
      } catch {
        // ignore invalid regex
      }
    }
  }
  for (const m of mutes) {
    if (m.isRegex) {
      const re = muteMatcher(m);
      if (re && re.test(item.text)) return false;
    } else if (item.text.toLowerCase().includes(m.pattern.toLowerCase())) {
      return false;
    }
  }
  return true;
}
