"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AtSign,
  Check,
  Copy,
  KeyRound,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUser } from "@/hooks/useUser";
import {
  createInvite,
  deleteInvite,
  fetchAdminPushHealth,
  fetchAdminTwitterHealth,
  fetchInvites,
  getAdminToken,
  setAdminToken,
  type AdminPushHealth,
  type AdminTwitterHealth,
  type CreatedInvite,
  type Invite,
} from "@/lib/api";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AdminView() {
  const { user } = useUser();
  const [token, setTokenState] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [tab, setTab] = useState("invites");

  useEffect(() => {
    setTokenState(getAdminToken());
  }, []);

  function onSaveToken(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = tokenDraft.trim();
    if (!trimmed) return;
    setAdminToken(trimmed);
    setTokenState(trimmed);
    setTokenDraft("");
    toast.success("Admin token saved for this browser");
  }

  if (token === null) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader
          title="Admin"
          description="Operator tools gated by the backend admin token"
        />
        <div className="flex flex-1 items-center justify-center p-6">
          <Skeleton className="h-44 w-full max-w-sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Admin"
        description="Operator tools gated by the backend admin token"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdminToken("");
            setTokenState("");
          }}
        >
          <KeyRound data-icon="inline-start" />
          Change token
        </Button>
      </PageHeader>

      {token === "" ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Admin access</CardTitle>
              <CardDescription>
                Paste the backend&apos;s ADMIN_TOKEN. It is stored only in this
                browser and sent as the x-admin-token header.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={onSaveToken}>
                <div className="space-y-2">
                  <Label htmlFor="adminToken">Admin token</Label>
                  <Input
                    id="adminToken"
                    type="password"
                    autoComplete="off"
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full">
                  <ShieldCheck data-icon="inline-start" />
                  Unlock admin tools
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="invites">Invites</TabsTrigger>
            <TabsTrigger value="health">Health</TabsTrigger>
          </TabsList>

          <TabsContent value="invites" className="min-w-0 space-y-4">
            <InvitesPanel currentUserId={user?.id ?? ""} />
          </TabsContent>

          <TabsContent value="health" className="min-w-0">
            <HealthPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function InvitesPanel({ currentUserId }: { currentUserId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [invitedById, setInvitedById] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<Invite | null>(null);

  useEffect(() => {
    if (currentUserId) setInvitedById(currentUserId);
  }, [currentUserId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvites(await fetchInvites());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setCreated(null);
    try {
      const invite = await createInvite({
        invitedById,
        email: email || undefined,
      });
      setCreated(invite);
      setEmail("");
      await reload();
      toast.success("Invite created — copy the token now, it is shown once");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!deleting) return;
    try {
      await deleteInvite(deleting.id);
      setInvites((current) => current.filter((i) => i.id !== deleting.id));
      toast.success("Invite revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke invite");
    } finally {
      setDeleting(null);
    }
  }

  function copyLink() {
    if (!created) return;
    // Copy the full invite URL the dialog displays, not the bare token —
    // the recipient needs a clickable link.
    const inviteLink = `${window.location.origin}/invite/${created.token}`;
    void navigator.clipboard
      .writeText(inviteLink)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Clipboard unavailable"));
  }

  const inviteLink = created
    ? `${window.location.origin}/invite/${created.token}`
    : "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create invite</CardTitle>
          <CardDescription>
            Valid for 14 days, single use. The token is only shown once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={onCreate}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="inviteEmail">Email (optional)</Label>
              <Input
                id="inviteEmail"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invitedBy">Invited by (user id)</Label>
              <Input
                id="invitedBy"
                value={invitedById}
                onChange={(e) => setInvitedById(e.target.value)}
                placeholder={currentUserId || "your user id"}
                required
              />
            </div>
            <Button type="submit" disabled={busy || !invitedById}>
              <Plus data-icon="inline-start" />
              Create
            </Button>
          </form>

          {created ? (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Invite link — shown once
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 text-xs">
                  {inviteLink}
                </code>
                <Button variant="outline" size="sm" onClick={copyLink}>
                  {copied ? (
                    <Check data-icon="inline-start" className="size-4" />
                  ) : (
                    <Copy data-icon="inline-start" className="size-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
          <CardDescription>
            Unaccepted invites that have not expired
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : invites.length === 0 ? (
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Link2 />
                </EmptyMedia>
                <EmptyTitle>No pending invites</EmptyTitle>
                <EmptyDescription>
                  Create one above to add the next team member.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-12" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">
                      {invite.email ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleting(invite)}
                        aria-label={`Revoke invite ${invite.email ?? invite.id}`}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.email ?? "This invite"} will be deleted and the link
              will stop working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HealthPanel() {
  const [twitter, setTwitter] = useState<AdminTwitterHealth | null>(null);
  const [push, setPush] = useState<AdminPushHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAdminTwitterHealth(), fetchAdminPushHealth()])
      .then(([t, p]) => {
        if (cancelled) return;
        setTwitter(t);
        setPush(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load health");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AtSign className="size-4 text-muted-foreground" />
            Twitter accounts
          </CardTitle>
          <CardDescription>
            Active x-auth cookies available to the poller
          </CardDescription>
        </CardHeader>
        <CardContent>
          {twitter === null ? (
            <Skeleton className="h-16 w-full" />
          ) : twitter.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active accounts.</p>
          ) : (
            <ul className="space-y-2">
              {twitter.accounts.map((a) => (
                <li
                  key={a.username}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate font-medium">@{a.username}</span>
                  <Badge variant={a.linkedToUser ? "secondary" : "outline"}>
                    {a.linkedToUser ? "linked" : "unlinked"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            Push subscriptions
          </CardTitle>
          <CardDescription>
            Devices registered for web push notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          {push === null ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="flex gap-8">
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {push.total}
                </p>
                <p className="text-sm text-muted-foreground">total</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {push.withUser}
                </p>
                <p className="text-sm text-muted-foreground">linked to a user</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
