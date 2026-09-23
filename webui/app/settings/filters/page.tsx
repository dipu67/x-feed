"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createFilter,
  createMute,
  deleteFilter,
  deleteMute,
  fetchFilters,
  fetchMutes,
  type Filter,
  type Mute,
} from "@/lib/api";

export default function FiltersPage() {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [mutes, setMutes] = useState<Mute[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterPattern, setFilterPattern] = useState("");
  const [mutePattern, setMutePattern] = useState("");
  const [muteIsRegex, setMuteIsRegex] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [f, m] = await Promise.all([fetchFilters(), fetchMutes()]);
    setFilters(f);
    setMutes(m);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function onAddFilter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await createFilter({
        name: filterName,
        kind: "keyword",
        action: "hide",
        pattern: filterPattern,
      });
      setFilterName("");
      setFilterPattern("");
      await reload();
      toast.success("Filter added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add filter");
    } finally {
      setBusy(false);
    }
  }

  async function onAddMute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await createMute({ pattern: mutePattern, isRegex: muteIsRegex });
      setMutePattern("");
      setMuteIsRegex(false);
      await reload();
      toast.success("Mute keyword added");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not add mute keyword",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteFilter(id: string) {
    await deleteFilter(id);
    await reload();
  }

  async function onDeleteMute(id: string) {
    await deleteMute(id);
    await reload();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Hide tweets that match a keyword or regex. Filters apply to every
            user account you follow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onAddFilter}>
            <div className="flex-1 space-y-1">
              <Label htmlFor="filterName">Name</Label>
              <Input
                id="filterName"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder="Hide spam"
                required
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="filterPattern">Pattern (regex)</Label>
              <Input
                id="filterPattern"
                value={filterPattern}
                onChange={(e) => setFilterPattern(e.target.value)}
                placeholder="airdrop scam"
                required
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy}>
                Add filter
              </Button>
            </div>
          </form>
          {filters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No filters yet.</p>
          ) : (
            <ul className="space-y-2">
              {filters.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.name}</span>
                    <Badge variant="secondary">{f.kind}</Badge>
                    <Badge variant="outline">{f.action}</Badge>
                    {f.pattern && (
                      <code className="text-xs text-muted-foreground">
                        /{f.pattern}/
                      </code>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteFilter(f.id)}
                    aria-label={`Delete filter ${f.name}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mute keywords</CardTitle>
          <CardDescription>
            Hide every tweet that contains one of these patterns, regardless
            of project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={onAddMute}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="mutePattern">Pattern</Label>
              <Input
                id="mutePattern"
                value={mutePattern}
                onChange={(e) => setMutePattern(e.target.value)}
                placeholder="giveaway"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={muteIsRegex}
                onChange={(e) => setMuteIsRegex(e.target.checked)}
              />
              Regex
            </label>
            <Button type="submit" disabled={busy}>
              Add mute
            </Button>
          </form>
          {mutes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mute keywords yet.</p>
          ) : (
            <ul className="space-y-2">
              {mutes.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <span>
                    <code>{m.pattern}</code>
                    {m.isRegex && (
                      <Badge variant="secondary" className="ml-2">
                        regex
                      </Badge>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteMute(m.id)}
                    aria-label={`Delete mute keyword ${m.pattern}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
