"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
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
  createAuthToken,
  deleteAuthToken,
  fetchAuthTokens,
  updateAuthToken,
} from "@/lib/api";
import type { AuthToken } from "@/lib/types";

export function AuthTokensView() {
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AuthToken | null>(null);
  const [deleting, setDeleting] = useState<AuthToken | null>(null);

  async function load() {
    setError(null);
    const data = await fetchAuthTokens();
    setTokens(data.tokens ?? []);
  }

  useEffect(() => {
    load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load tokens");
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleActive(token: AuthToken, isActive: boolean) {
    const { token: next } = await updateAuthToken(token.id, { isActive });
    setTokens((current) =>
      (current ?? []).map((row) => (row.id === next.id ? next : row)),
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 border-b px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">X auth tokens</h1>
          <p className="text-sm text-muted-foreground">
            Cookie sessions the feed poller uses for usersByIds
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          Add token
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : tokens.length === 0 ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>No auth tokens</EmptyTitle>
            <EmptyDescription>
              Add an x.com auth_token and ct0 cookie so the poller can call
              usersByIds.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)}>Add token</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell>
                    <div className="font-medium">@{token.username}</div>
                    <div className="text-xs text-muted-foreground">{token.id}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {token.authTokenHint}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={token.isActive}
                        onCheckedChange={(checked) => {
                          void toggleActive(token, checked).catch((err: unknown) => {
                            toast.error(
                              err instanceof Error ? err.message : "Update failed",
                            );
                          });
                        }}
                      />
                      <Badge variant={token.isActive ? "secondary" : "outline"}>
                        {token.isActive ? "On" : "Off"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(token)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleting(token)}
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

      <TokenDialog
        open={createOpen}
        title="Add auth token"
        description="Paste auth_token and ct0 from x.com cookies. We look up the account from the session."
        submitLabel="Add"
        onOpenChange={setCreateOpen}
        onSubmit={async (input) => {
          const { token } = await createAuthToken(input);
          setTokens((current) => [token, ...(current ?? [])]);
          toast.success(`Added @${token.username}`);
        }}
      />

      <TokenDialog
        key={editing?.id ?? "edit"}
        open={Boolean(editing)}
        title="Edit auth token"
        description="Leave cookie fields blank to keep the current values."
        submitLabel="Save"
        username={editing?.username ?? ""}
        isActive={editing?.isActive ?? true}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSubmit={async (input) => {
          if (!editing) return;
          const { token } = await updateAuthToken(editing.id, input);
          setTokens((current) =>
            (current ?? []).map((row) => (row.id === token.id ? token : row)),
          );
          toast.success("Token updated");
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
            <AlertDialogTitle>Delete token?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Remove @${deleting.username} from the poller cookie pool.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                void deleteAuthToken(deleting.id)
                  .then(() => {
                    setTokens((current) =>
                      (current ?? []).filter((row) => row.id !== deleting.id),
                    );
                    toast.success(`Removed @${deleting.username}`);
                    setDeleting(null);
                  })
                  .catch((err: unknown) => {
                    toast.error(err instanceof Error ? err.message : "Delete failed");
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

function TokenDialog({
  open,
  title,
  description,
  submitLabel,
  username = "",
  isActive = true,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  username?: string;
  isActive?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    username?: string;
    authToken?: string;
    ct0?: string;
    isActive?: boolean;
  }) => Promise<void>;
}) {
  const [handle, setHandle] = useState(username);
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [active, setActive] = useState(isActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHandle(username);
    setAuthToken("");
    setCt0("");
    setActive(isActive);
    setError(null);
  }, [open, username, isActive]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
              username?: string;
              authToken?: string;
              ct0?: string;
              isActive?: boolean;
            } = { isActive: active };
            if (handle.trim()) input.username = handle.trim();
            if (authToken.trim()) input.authToken = authToken.trim();
            if (ct0.trim()) input.ct0 = ct0.trim();
            void onSubmit(input)
              .then(() => onOpenChange(false))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Save failed");
              })
              .finally(() => setPending(false));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="token-username">Username</Label>
            <Input
              id="token-username"
              placeholder="optional if cookies work"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="auth-token">auth_token</Label>
            <Input
              id="auth-token"
              type="password"
              autoComplete="off"
              placeholder={submitLabel === "Save" ? "leave blank to keep" : ""}
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              required={submitLabel !== "Save"}
              disabled={pending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ct0">ct0</Label>
            <Input
              id="ct0"
              type="password"
              autoComplete="off"
              placeholder={submitLabel === "Save" ? "leave blank to keep" : ""}
              value={ct0}
              onChange={(event) => setCt0(event.target.value)}
              required={submitLabel !== "Save"}
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            Active
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
