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

/** Coerce a Prisma Filter row (kind/action are plain String columns) into the
 * narrowed shape shouldShow operates on. Write-time validation in
 * routes/filters.ts only ever stores "project"/"keyword" and "keep"/"hide",
 * so values outside those never legitimately occur; unknown values coerce to
 * the keyword/hide side and simply never match. */
export function toFilterRule(row: {
  kind: string;
  projectId: string | null;
  pattern: string | null;
  action: string;
  isActive: boolean;
}): FilterRule {
  const rule: FilterRule = {
    kind: row.kind === "project" ? "project" : "keyword",
    action: row.action === "keep" ? "keep" : "hide",
    isActive: row.isActive,
  };
  if (row.projectId !== null) rule.projectId = row.projectId;
  if (row.pattern !== null) rule.pattern = row.pattern;
  return rule;
}

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
  // A matching `keep` rule overrides every other decision below: hides,
  // mutes, and the follow restriction. The whole point of `keep` is "force
  // this through" — apply it first and short-circuit.
  for (const f of filters) {
    if (!f.isActive || f.action !== "keep") continue;
    if (f.kind === "project" && f.projectId === item.projectId) return true;
    if (f.kind === "keyword" && f.pattern) {
      try {
        if (new RegExp(f.pattern, "i").test(item.text)) return true;
      } catch {
        // ignore invalid regex
      }
    }
  }
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
