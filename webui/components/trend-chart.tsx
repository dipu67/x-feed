"use client";

import { useMemo } from "react";
import type { TrendPoint } from "@/lib/api";

const SERIES = [
  { key: "followers" as const, label: "Followers", color: "#3b82f6" },
  { key: "following" as const, label: "Following", color: "#22c55e" },
  { key: "tweets" as const, label: "Tweets", color: "#f59e0b" },
];

const W = 560;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/** Minimal dependency-free SVG line chart for metric rollup points. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const layout = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((_, i) => i);
    const values = points.flatMap((p) => SERIES.map((s) => p[s.key]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) =>
      PAD.left + (xs.length === 1 ? innerW / 2 : (i / (xs.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - ((v - min) / span) * innerH;
    const lines = SERIES.map((s) => ({
      ...s,
      d: points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(" "),
      // Per-point circles so single-point and flat series stay visible.
      pts: points.map((p, i) => ({ x: x(i), y: y(p[s.key]) })),
    }));
    return {
      lines,
      first: points[0]!,
      last: points[points.length - 1]!,
      min,
      max,
      yMin: y(min),
      yMax: y(max),
    };
  }, [points]);

  if (!layout) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data in this range yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {layout.lines.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Metric trend chart"
      >
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={layout.yMax}
          y2={layout.yMax}
          stroke="currentColor"
          className="text-border"
          strokeDasharray="3 3"
        />
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={layout.yMin}
          y2={layout.yMin}
          stroke="currentColor"
          className="text-border"
          strokeDasharray="3 3"
        />
        {layout.lines.map((s) => (
          <polyline
            key={s.key}
            points={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {layout.lines.map((s) =>
          s.pts.map((pt, i) => (
            <circle
              key={`${s.key}-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={3}
              fill={s.color}
            />
          )),
        )}
        <text x={PAD.left - 6} y={layout.yMax + 4} textAnchor="end" className="fill-current text-[10px] text-muted-foreground">
          {layout.max}
        </text>
        <text x={PAD.left - 6} y={layout.yMin + 4} textAnchor="end" className="fill-current text-[10px] text-muted-foreground">
          {layout.min}
        </text>
        <text x={PAD.left} y={H - 6} className="fill-current text-[10px] text-muted-foreground">
          {layout.first.t.slice(5, 16).replace("T", " ")}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-current text-[10px] text-muted-foreground">
          {layout.last.t.slice(5, 16).replace("T", " ")}
        </text>
      </svg>
    </div>
  );
}
