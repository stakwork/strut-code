import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStrutClient } from "@strut/kit";
import { FolderGit2, GitBranch, MoreHorizontal, Plus, Star } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The package's steps and its one workflow, by their full names.
const LIST = "stadeum/code/repositories";
const ADD = "stadeum/code/add";
const REMOVE = "stadeum/code/remove";
const PLACE = "stadeum/code/place";
const MAIN = "stadeum/code/main";

interface Repository {
  url: string;
  name: string;
  branch?: string;
  head?: string;
  checked?: string;
  problem?: string;
  workspaces: string[];
}
interface Workspace {
  name: string;
  main?: string;
  repositories: string[];
}
interface List {
  repositories: Repository[];
  workspaces: Workspace[];
  /** Whether this viewer may change the list: strut says so on an admin's call. */
  admin?: boolean;
}

/** "2 min ago", from an ISO time. */
function ago(iso: string | undefined, now: number): string {
  if (!iso) return "not checked yet";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "checked just now";
  const m = Math.round(s / 60);
  if (m < 60) return `checked ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `checked ${h} h ago`;
  return `checked ${Math.round(h / 24)} days ago`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^(step_run: |Error: )+/, "");

export default function App() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["code", "list"], queryFn: () => client.run<List>(LIST), refetchInterval: 30_000 });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState<Repository>();
  const [removing, setRemoving] = useState<Repository>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** One change, then the list again; its failure is shown, not thrown. */
  const act = async (change: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await change();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      await qc.invalidateQueries({ queryKey: ["code", "list"] });
      setBusy(false);
    }
  };

  /** `add` is a workflow (it runs `ingest` after): launch it and wait for its end. */
  const add = (url: string) =>
    act(async () => {
      const { runId } = await client.run<{ runId: string }>("run/launch", { workflow: ADD, input: { url } });
      for (let i = 0; i < 30; i++) {
        const run = await client.run<{ status: string; error?: { message?: string } }>("run/get", { workflow: ADD, runId, wait: 20_000 });
        if (run.status === "success") return;
        if (run.status === "error" || run.status === "cancelled") throw new Error(run.error?.message ?? `adding ${url} was ${run.status}`);
      }
      throw new Error(`adding ${url} is taking long: it shows here once it is done`);
    });

  const data = list.data;
  const admin = data?.admin === true;
  const byUrl = new Map((data?.repositories ?? []).map((r) => [r.url, r]));
  const names = (data?.workspaces ?? []).map((w) => w.name);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-2">
        <FolderGit2 className="size-5 text-brand" />
        <h1 className="text-lg font-semibold">Code</h1>
        <span className="text-sm text-muted-foreground">the box's repositories, by workspace</span>
      </header>

      {admin && <AddForm busy={busy} onAdd={add} />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {list.error && (
        <Alert variant="destructive">
          <AlertDescription>{message(list.error)}</AlertDescription>
        </Alert>
      )}
      {list.isLoading && <p className="text-sm text-muted-foreground">Reading the list…</p>}
      {data && !data.workspaces.length && (
        <p className="text-sm text-muted-foreground">
          No repositories yet.{admin ? " Add one by its https address." : " An admin adds them here."}
        </p>
      )}

      {data?.workspaces.map((w) => (
        <Card key={w.name} className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="font-mono text-base">{w.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y px-4">
            {w.repositories.map((url) => {
              const r = byUrl.get(url);
              if (!r) return null;
              const isMain = w.main === url;
              return (
                <div key={url} className="flex items-start gap-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {isMain && w.repositories.length > 1 && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="size-3" />
                          main repository
                        </Badge>
                      )}
                      {r.branch && (
                        <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground" title="its default branch">
                          <GitBranch className="size-3" />
                          {r.branch}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground" title={r.head ? `head ${r.head}` : undefined}>
                        {ago(r.checked, now)}
                      </span>
                    </div>
                    <span className="truncate text-xs text-muted-foreground select-all">{r.url}</span>
                    {r.problem && <span className="text-xs text-destructive">{r.problem}</span>}
                  </div>
                  {admin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Change ${r.name}`} disabled={busy}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!isMain && <DropdownMenuItem onSelect={() => void act(() => client.run(MAIN, { workspace: w.name, url }))}>Make main in {w.name}</DropdownMenuItem>}
                        <DropdownMenuItem onSelect={() => setPlacing(r)}>Workspaces…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(r)}>
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {removing && (
        <AlertDialog open onOpenChange={(open) => !open && setRemoving(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {removing.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {removing.url} comes off the box's list and out of {removing.workspaces.length === 1 ? `its workspace, ${removing.workspaces[0]}` : `its ${removing.workspaces.length} workspaces`}. A workspace it leaves empty goes too.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const url = removing.url;
                  setRemoving(undefined);
                  void act(() => client.run(REMOVE, { url }));
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {placing && (
        <PlaceDialog
          repository={placing}
          workspaces={names}
          busy={busy}
          onClose={() => setPlacing(undefined)}
          onSave={async (chosen) => {
            if (await act(() => client.run(PLACE, { url: placing.url, workspaces: chosen }))) setPlacing(undefined);
          }}
        />
      )}
    </div>
  );
}

function AddForm({ busy, onAdd }: { busy: boolean; onAdd: (url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && (await onAdd(url.trim()))) setUrl("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/team/app" aria-label="The repository's https address" disabled={busy} />
      <Button type="submit" disabled={busy || !url.trim()}>
        <Plus className="size-4" />
        {busy ? "Working…" : "Add a repository"}
      </Button>
    </form>
  );
}

/** Put a repository in one workspace or several, or in a new one. */
function PlaceDialog(props: { repository: Repository; workspaces: string[]; busy: boolean; onClose: () => void; onSave: (chosen: string[]) => Promise<void> }) {
  const { repository, workspaces, busy, onClose, onSave } = props;
  const [chosen, setChosen] = useState<string[]>(repository.workspaces);
  const [fresh, setFresh] = useState("");
  const all = [...new Set([...workspaces, ...chosen])].sort();
  const toggle = (name: string, on: boolean) => setChosen((c) => (on ? [...new Set([...c, name])] : c.filter((n) => n !== name)));
  const named = fresh.trim().toLowerCase();
  const picked = named ? [...new Set([...chosen, named])] : chosen;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Workspaces of {repository.name}</DialogTitle>
          <DialogDescription>It is in every workspace ticked here. A new name makes a workspace, with it as its main repository.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {all.map((name) => (
            <Label key={name} className="flex items-center gap-2 font-normal">
              <Checkbox checked={chosen.includes(name)} onCheckedChange={(v) => toggle(name, v === true)} />
              <span className="font-mono">{name}</span>
            </Label>
          ))}
          <Input value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="a new workspace, such as hive" aria-label="A new workspace's name" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !picked.length} onClick={() => void onSave(picked)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
