"use client";

import { useEffect, useState } from "react";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createKeyword,
  deleteKeyword,
  fetchKeywords,
  updateKeyword,
} from "@/lib/api";
import type { Keyword } from "@/lib/types";

export function KeywordsView() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Keyword | null>(null);
  const [deleting, setDeleting] = useState<Keyword | null>(null);

  useEffect(() => {
    fetchKeywords()
      .then((data) => setKeywords(data.keywords ?? []))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load keywords");
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleEnabled(keyword: Keyword, enabled: boolean) {
    const { keyword: next } = await updateKeyword(keyword.id, { enabled });
    setKeywords((current) =>
      (current ?? []).map((row) => (row.id === next.id ? next : row)),
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Keywords</h1>
          <p className="text-sm text-muted-foreground">
            Posts matching these phrases get badged, highlighted, and alerted
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          Add keyword
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : keywords.length === 0 ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Tags />
            </EmptyMedia>
            <EmptyTitle>No keywords</EmptyTitle>
            <EmptyDescription>
              Add phrases like “mint live”, “whitelist”, or “gtd” to detect
              launch announcements in the feed.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>Add keyword</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phrase</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.map((keyword) => (
                <TableRow key={keyword.id}>
                  <TableCell className="font-medium">{keyword.phrase}</TableCell>
                  <TableCell>
                    {keyword.tag ? (
                      <Badge variant="secondary" className="font-normal">
                        {keyword.tag}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={keyword.enabled}
                        onCheckedChange={(checked) => {
                          void toggleEnabled(keyword, checked).catch(
                            (err: unknown) => {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Update failed",
                              );
                            },
                          );
                        }}
                      />
                      <Badge
                        variant={keyword.enabled ? "secondary" : "outline"}
                      >
                        {keyword.enabled ? "On" : "Off"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(keyword)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(keyword)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <KeywordDialog
        open={createOpen}
        title="Add keyword"
        description="Phrases match case-insensitively on whole words. Matches alert from the next poll cycle on."
        submitLabel="Add"
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          const { keyword } = await createKeyword(input);
          setKeywords((current) => [keyword, ...(current ?? [])]);
          toast.success(`Added "${keyword.phrase}"`);
        }}
      />

      <KeywordDialog
        key={editing?.id ?? "edit"}
        open={Boolean(editing)}
        title="Edit keyword"
        description="The phrase is immutable — delete and re-create it to change what it matches."
        submitLabel="Save"
        tag={editing?.tag ?? ""}
        enabled={editing?.enabled ?? true}
        phraseReadOnly
        phrase={editing?.phrase ?? ""}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={async (input) => {
          if (!editing) return;
          const { keyword } = await updateKeyword(editing.id, input);
          setKeywords((current) =>
            (current ?? []).map((row) => (row.id === keyword.id ? keyword : row)),
          );
          toast.success("Keyword updated");
        }}
      />

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete keyword?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Existing matches on past posts are kept; future posts are no longer matched.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                void deleteKeyword(deleting.id)
                  .then(() => {
                    setKeywords((current) =>
                      (current ?? []).filter((row) => row.id !== deleting.id),
                    );
                    toast.success(`Removed "${deleting.phrase}"`);
                    setDeleting(null);
                  })
                  .catch((err: unknown) => {
                    toast.error(
                      err instanceof Error ? err.message : "Delete failed",
                    );
                  });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeywordDialog({
  open,
  title,
  description,
  submitLabel,
  phrase = "",
  phraseReadOnly = false,
  tag = "",
  enabled = true,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  phrase?: string;
  phraseReadOnly?: boolean;
  tag?: string;
  enabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    phrase?: string;
    tag?: string | null;
    enabled?: boolean;
  }) => Promise<void>;
}) {
  const [phraseValue, setPhraseValue] = useState(phrase);
  const [tagValue, setTagValue] = useState(tag);
  const [active, setActive] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhraseValue(phrase);
    setTagValue(tag);
    setActive(enabled);
    setError(null);
  }, [open, phrase, tag, enabled]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            const input: {
              phrase?: string;
              tag?: string | null;
              enabled?: boolean;
            } = { enabled: active };
            if (!phraseReadOnly) input.phrase = phraseValue.trim();
            input.tag = tagValue.trim() === "" ? null : tagValue.trim();
            void onSubmit(input)
              .then(() => onOpenChange(false))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Save failed");
              })
              .finally(() => setPending(false));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="keyword-phrase">Phrase</Label>
            <Input
              id="keyword-phrase"
              placeholder="mint live"
              value={phraseValue}
              onChange={(event) => setPhraseValue(event.target.value)}
              disabled={pending || phraseReadOnly}
              required={!phraseReadOnly}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="keyword-tag">Tag (badge label)</Label>
            <Input
              id="keyword-tag"
              placeholder="Mint"
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            Enabled
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
