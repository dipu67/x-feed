"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectInput } from "@/lib/types";

export function ProjectForm({
  project,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  project?: Project;
  submitLabel: string;
  onSubmit: (input: ProjectInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(project?.username ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [chain, setChain] = useState(project?.chain ?? "");
  const [tokenAddress, setTokenAddress] = useState(project?.tokenAddress ?? "");
  const [website, setWebsite] = useState(project?.website ?? "");
  const [github, setGithub] = useState(project?.github ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        ...(project ? {} : { username }),
        name: name.trim() || undefined,
        chain: chain.trim() || null,
        tokenAddress: tokenAddress.trim() || null,
        website: website.trim() || null,
        github: github.trim() || null,
        description: description.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setPending(false);
      return;
    }
    setPending(false);
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="username">Twitter username</Label>
        <Input
          id="username"
          placeholder="projecthandle"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required={!project}
          disabled={Boolean(project) || pending}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="name">Display name</Label>
        <Input
          id="name"
          placeholder="Optional"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="chain">Chain</Label>
          <Input
            id="chain"
            placeholder="solana"
            value={chain}
            onChange={(event) => setChain(event.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="token">Token address</Label>
          <Input
            id="token"
            placeholder="optional"
            value={tokenAddress}
            onChange={(event) => setTokenAddress(event.target.value)}
            disabled={pending}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          disabled={pending}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="github">GitHub</Label>
        <Input
          id="github"
          value={github}
          onChange={(event) => setGithub(event.target.value)}
          disabled={pending}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Notes</Label>
        <Textarea
          id="description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={pending}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (!project && !username.trim())}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
