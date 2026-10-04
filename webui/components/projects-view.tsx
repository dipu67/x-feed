"use client";

import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus, Search, FolderKanban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { ProjectForm } from "@/components/project-form";
import {
  createProject,
  deleteProject,
  deleteProjects,
  fetchProjects,
  updateProject,
} from "@/lib/api";
import { formatCount } from "@/lib/format";
import type { Project, ProjectInput } from "@/lib/types";

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function load() {
    setError(null);
    const data = await fetchProjects();
    setProjects(data.projects ?? []);
    setSelected(new Set());
  }

  useEffect(() => {
    load()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      })
      .finally(() => setLoading(false));
  }, []);

  const list = Array.isArray(projects) ? projects : [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((project) =>
      [project.name, project.username, project.chain, project.twitterName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [list, query]);

  async function handleCreate(input: ProjectInput) {
    const { project } = await createProject(input);
    setProjects((current) => [project, ...(current ?? [])]);
    setCreateOpen(false);
    toast.success(`Tracking @${project.username}`);
  }

  async function handleUpdate(input: ProjectInput) {
    if (!editing) return;
    const { project } = await updateProject(editing.userId, input);
    setProjects((current) =>
      (current ?? []).map((row) => (row.userId === project.userId ? project : row)),
    );
    setEditing(null);
    toast.success("Project updated");
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteProject(deleting.userId);
    setProjects((current) =>
      (current ?? []).filter((row) => row.userId !== deleting.userId),
    );
    setSelected((current) => {
      if (!current.has(deleting.userId)) return current;
      const next = new Set(current);
      next.delete(deleting.userId);
      return next;
    });
    toast.success(`Removed @${deleting.username}`);
    setDeleting(null);
  }

  function toggleSelected(userId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.userId));
  const someVisibleSelected = filtered.some((row) => selected.has(row.userId));

  async function handleBulkDelete() {
    const userIds = [...selected];
    const { deleted } = await deleteProjects(userIds);
    setProjects((current) =>
      (current ?? []).filter((row) => !selected.has(row.userId)),
    );
    setSelected(new Set());
    setBulkDeleting(false);
    toast.success(`Removed ${deleted} project${deleted === 1 ? "" : "s"}`);
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Projects" description="Accounts the feed poller watches for new tweets">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-8"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          Add project
        </Button>
      </PageHeader>

      {loading ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : filtered.length === 0 ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban />
            </EmptyMedia>
            <EmptyTitle>
              {list.length === 0 ? "No projects yet" : "No matches"}
            </EmptyTitle>
            <EmptyDescription>
              {list.length === 0
                ? "Add a Twitter username. The backend stores the current tweet count so only future posts show in the feed."
                : "Try a different name, handle, or chain."}
            </EmptyDescription>
          </EmptyHeader>
          {list.length === 0 ? (
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>Add project</Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          {selected.size > 0 ? (
            <div className="flex items-center gap-3 border-b px-4 py-2.5">
              <span className="text-sm text-muted-foreground">
                {selected.size} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleting(true)}
                >
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              </div>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all projects"
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected && !allVisibleSelected}
                    onCheckedChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const row of filtered) {
                          if (checked) next.add(row.userId);
                          else next.delete(row.userId);
                        }
                        return next;
                      });
                    }}
                  />
                </TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Tweets</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => (
                <TableRow key={project.userId}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select @${project.username}`}
                      checked={selected.has(project.userId)}
                      onCheckedChange={(checked) =>
                        toggleSelected(project.userId, checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        {project.profileImageUrl ? (
                          <AvatarImage
                            src={project.profileImageUrl}
                            alt={project.name}
                          />
                        ) : null}
                        <AvatarFallback>
                          {project.username.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{project.name}</div>
                        <div className="truncate text-sm text-muted-foreground">
                          <a href={`https://x.com/${project.username}`} target="_blank">@{project.username}</a>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatCount(project.tweets)}</TableCell>
                  <TableCell>{formatCount(project.followers)}</TableCell>
                  <TableCell>
                    {project.chain ? (
                      <Badge variant="secondary">{project.chain}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" />
                        }
                      >
                        <MoreHorizontal />
                        <span className="sr-only">Open menu</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(project)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting(project)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              Look up the Twitter profile and start tracking tweet count.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            submitLabel="Add"
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Update display fields. Tweet counts stay managed by the poller.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <ProjectForm
              key={editing.userId}
              project={editing}
              submitLabel="Save"
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={bulkDeleting}
        onOpenChange={(open) => {
          if (!open) setBulkDeleting(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected projects?</AlertDialogTitle>
            <AlertDialogDescription>
              Stop tracking {selected.size} project
              {selected.size === 1 ? "" : "s"}. Existing feed items for them are
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleBulkDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `Stop tracking @${deleting.username}. Existing feed items for this project are removed.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
