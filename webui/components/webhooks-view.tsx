"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Webhook } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWebhookInfo, sendWebhookProject, SOCKET_URL } from "@/lib/api";
import type { WebhookInfo } from "@/lib/types";

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed"),
  );
}

export function WebhooksView() {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [chain, setChain] = useState("");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [origin, setOrigin] = useState('') 

  const endpoint = `${origin}${info?.path ?? "/webhooks/projects"}`;

  const curl = useMemo(() => {
    const body = JSON.stringify(
      {
        username: "projecthandle",
        name: "Optional display name",
        chain: "solana",
      },
      null,
      2,
    );
    const secretHeader = info?.secretConfigured
      ? ` \\\n  -H '${info.header}: YOUR_SECRET'`
      : "";
    return `curl -X POST ${endpoint} \\
  -H 'Content-Type: application/json'${secretHeader} \\
  -d '${body.replace(/\n/g, "")}'`;
  }, [endpoint, info]);

  useEffect(() => { // [!code ++]
    setOrigin(window.location.origin) // [!code ++]
  }, [])
  
  useEffect(() => {
    fetchWebhookInfo()
      .then(setInfo)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load webhook");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Webhook</h1>
        <p className="text-sm text-muted-foreground">
          Add or update a tracked project from another service
        </p>
      </div>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : info ? (
        <div className="grid gap-4 p-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="size-4" />
                Incoming endpoint
              </CardTitle>
              <CardDescription>
                POST a Twitter username or user id. Existing projects are upserted.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={endpoint} />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => copyText(endpoint, "URL")}
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Auth</span>
                {info.secretConfigured ? (
                  <Badge variant="secondary">{info.header} required</Badge>
                ) : (
                  <Badge variant="outline">No secret configured</Badge>
                )}
              </div>
              <div className="grid gap-2">
                <Label>curl</Label>
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs leading-5">
                  {curl}
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => copyText(curl, "curl")}
                >
                  <Copy data-icon="inline-start" />
                  Copy curl
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Send a test</CardTitle>
              <CardDescription>
                Same payload the webhook expects. Uses username lookup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPending(true);
                  void sendWebhookProject(
                    {
                      username,
                      ...(name.trim() ? { name: name.trim() } : {}),
                      ...(chain.trim() ? { chain: chain.trim() } : {}),
                    },
                    secret.trim() || undefined,
                  )
                    .then(({ project }) => {
                      toast.success(`Webhook upserted @${project.username}`);
                      setUsername("");
                      setName("");
                      setChain("");
                    })
                    .catch((err: unknown) => {
                      toast.error(
                        err instanceof Error ? err.message : "Webhook failed",
                      );
                    })
                    .finally(() => setPending(false));
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="hook-username">Username</Label>
                  <Input
                    id="hook-username"
                    placeholder="projecthandle"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    disabled={pending}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="hook-name">Name</Label>
                    <Input
                      id="hook-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="hook-chain">Chain</Label>
                    <Input
                      id="hook-chain"
                      value={chain}
                      onChange={(event) => setChain(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                </div>
                {info.secretConfigured ? (
                  <div className="grid gap-2">
                    <Label htmlFor="hook-secret">{info.header}</Label>
                    <Input
                      id="hook-secret"
                      type="password"
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                      disabled={pending}
                    />
                  </div>
                ) : null}
                <Button type="submit" disabled={pending || !username.trim()}>
                  {pending ? "Sending…" : "Send webhook"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Payload fields</CardTitle>
              <CardDescription>
                Provide username or userId. One of those is required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Field</th>
                      <th className="py-2 pr-4 font-medium">Required</th>
                      <th className="py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.fields.map((field) => (
                      <tr key={field.name} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">
                          {field.name}
                        </td>
                        <td className="py-2 pr-4">
                          {field.required ? "yes" : "no"}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {field.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
