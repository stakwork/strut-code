import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { appLink, useHost, useStrutClient, useToolInput } from "@strut/kit";
import { BookOpen, FolderGit2, GitBranch, Lock, MessageSquare, MoreHorizontal, Plus, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { chatAbout, JAMIE, lookForChat, type Found } from "./chat";
import { addressToAdd } from "./input";

// The package's steps, by their full names.
const LIST = "stadeum/code/repositories";
const WORKSPACE = "stadeum/code/workspace";
const RENAME = "stadeum/code/rename";
const DELETE = "stadeum/code/delete";
const DEFAULT = "stadeum/code/default-workspace";
/** Strut's Knowledge app, which opens a node by its ref_id (`node`). */
const KNOWLEDGE = "strut/knowledge";

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
  /** Its node: what the chat about it is about. */
  ref_id: string;
  name: string;
  repositories: string[];
  /** Its page, the Concept `<name> workspace`, once it has been baked. */
  page?: { name: string; ref_id: string };
  /** What its Set up was told: "Additional information". */
  note?: string;
}
interface Reach {
  url: string;
  name: string;
  private?: boolean;
  pushed?: string;
  description?: string;
}
interface List {
  repositories: Repository[];
  workspaces: Workspace[];
  reachable?: Reach[];
  hosts?: Array<{ host: string; problem?: string }>;
  reach_problem?: string;
  /** While the box has no workspace: the default, suggested, written only at Set up. */
  suggested?: { name: string; repositories: string[] };
  /** Whether this viewer may make and change workspaces: strut's app door says who they are. */
  may?: boolean;
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
/** The last part of an address, for an address that is not the box's yet. */
const tail = (url: string) => url.replace(/\/+$/, "").split("/").pop()?.replace(/\.git$/i, "") ?? url;

/** The longest note Set up takes (steps/_code.ts `NOTE_MOST`). */
const NOTE_MOST = 4000;

/** Right after Set up, on its workspace's card, until its chat opens: still
 *  looking, no chat turned up, or a strut that can't look. */
type Looking = "looking" | "none" | "unsupported";

/** What a dialog is open on: the suggested workspace's Set up, a new workspace, or one to add to, rename or delete. */
type Open = { kind: "setup"; suggested: { name: string; repositories: string[] } } | { kind: "new"; address?: string } | { kind: "add"; workspace: Workspace } | { kind: "rename"; workspace: Workspace } | { kind: "delete"; workspace: Workspace } | { kind: "take"; workspace: Workspace; repository: Repository };

export default function App() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const host = useHost();
  const input = useToolInput();
  const list = useQuery({ queryKey: ["code", "list"], queryFn: () => client.run<List>(LIST, { reachable: false }), refetchInterval: 30_000 });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Open>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const data = list.data;
  const may = data?.may === true;
  // While the box has no workspace: the default one, suggested from what the
  // viewer's forges reach, and written only when they press Set up.
  const empty = !!data && !data.workspaces.length;
  const reach = useQuery({ queryKey: ["code", "reach"], queryFn: () => client.run<List>(LIST, { reachable: true }), enabled: empty && may, staleTime: 60_000 });
  const suggested = empty ? reach.data?.suggested : undefined;
  const reachName = new Map((reach.data?.reachable ?? []).map((r) => [r.url, r.name]));
  // Opened with an address: New workspace, with it filled in (./input.ts).
  const given = addressToAdd(input, may);
  useEffect(() => {
    if (given) setOpen({ kind: "new", address: given });
  }, [given]);

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
      await qc.invalidateQueries({ queryKey: ["code"] });
      setBusy(false);
    }
  };
  const close = () => setOpen(undefined);
  const done = async (change: () => Promise<unknown>) => {
    if (await act(change)) close();
  };

  // The chat about each workspace: the viewer's own, newest first (strut's
  // conversation/list { about }). None on a strut that can't say, which is
  // then asked no more.
  const run = (type: string, config: Record<string, unknown>) => client.run(type, config);
  const chats = useQueries({
    queries: (data?.workspaces ?? []).map((w) => ({
      queryKey: ["code", "chat", w.ref_id],
      queryFn: () => chatAbout(run, w.ref_id),
      staleTime: 10_000,
      retry: false,
      refetchInterval: (q: { state: { data?: Found } }) => (q.state.data && "unsupported" in q.state.data ? false : 30_000),
    })),
  });
  const chatOf = new Map((data?.workspaces ?? []).map((w, i) => [w.ref_id, chats[i]?.data]));
  // Jamie as the page, not in the host's side panel (`open: "page"`): the
  // jump right after Set up and each card's link to its chat.
  const openChat = (session: string) => void host.openLink(appLink(JAMIE, { session }, { open: "page" }));
  const [looking, setLooking] = useState<Record<string, Looking>>({});

  /**
   * Set up, or Create: the workspace is written with the person's note, and
   * whatever sets workspaces up on this box starts a chat of theirs about
   * it. Look for that chat for a few seconds and open Jamie there; when
   * none turns up, its card says so.
   */
  const setUp = async (start: () => Promise<{ workspace: string }>) => {
    let name: string | undefined;
    if (!(await act(async () => void (name = (await start()).workspace)))) return;
    close();
    // The list was read again as the change ended: the workspace's node is in it.
    const w = qc.getQueryData<List>(["code", "list"])?.workspaces.find((x) => x.name === name);
    if (!w?.ref_id) return;
    const ref = w.ref_id;
    setLooking((l) => ({ ...l, [ref]: "looking" }));
    const found = await lookForChat(run, ref);
    if ("session" in found) {
      qc.setQueryData(["code", "chat", ref], found);
      setLooking(({ [ref]: _done, ...l }) => l);
      openChat(found.session);
    } else {
      setLooking((l) => ({ ...l, [ref]: "none" in found ? "none" : "unsupported" }));
    }
  };

  const byUrl = new Map((data?.repositories ?? []).map((r) => [r.url, r]));
  /** Repositories only in this workspace: they leave the box with it. */
  const onlyIn = (w: Workspace) => w.repositories.filter((u) => (byUrl.get(u)?.workspaces.length ?? 0) <= 1).map((u) => byUrl.get(u)?.name ?? tail(u));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <FolderGit2 className="size-5 text-brand" />
        <h1 className="text-lg font-semibold">Code</h1>
        <span className="text-sm text-muted-foreground">workspaces: sets of repositories, set up for jobs</span>
        {may && (
          <Button size="sm" className="ml-auto" disabled={busy} onClick={() => setOpen({ kind: "new" })}>
            <Plus className="size-4" />
            New workspace
          </Button>
        )}
      </header>

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
      {list.isLoading && <p className="text-sm text-muted-foreground">Reading the workspaces…</p>}
      {data && !data.workspaces.length && !suggested && (
        <p className="text-sm text-muted-foreground">
          No workspaces yet.{may ? " Make one from the repositories you work on together." : ""}
        </p>
      )}

      {suggested && (
        <Card className="gap-2 border-dashed py-4">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
            <div className="flex items-center gap-2">
              <CardTitle className="font-mono text-base">{suggested.name}</CardTitle>
              <Badge variant="outline">suggested</Badge>
            </div>
            <Button size="sm" disabled={busy} onClick={() => setOpen({ kind: "setup", suggested })}>
              Set up
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-sm">{suggested.repositories.map((u) => reachName.get(u) ?? tail(u)).join(" · ")}</p>
            <p className="text-xs text-muted-foreground">
              The repositories your accounts reach that were picked for the box, or the five pushed to most recently. Nothing is made until you press Set up; then Jamie sets it up and bakes it, as you, in a chat of yours that opens here.
            </p>
          </CardContent>
        </Card>
      )}

      {data?.workspaces.map((w) => (
        <Card key={w.name} className="gap-2 py-4">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
            <CardTitle className="font-mono text-base">{w.name}</CardTitle>
            <div className="flex items-center gap-3">
              {(() => {
                const chat = chatOf.get(w.ref_id);
                return chat && "session" in chat ? (
                  <Button variant="link" size="sm" className="h-auto gap-1 p-0" title={chat.title ? `${chat.title}, in Jamie` : "Its chat, in Jamie"} onClick={() => openChat(chat.session)}>
                    <MessageSquare className="size-3.5" />
                    its chat
                  </Button>
                ) : null;
              })()}
              {w.page && (
                <Button variant="link" size="sm" className="h-auto gap-1 p-0" title={`${w.page.name}, in the Knowledge app`} onClick={() => void host.openLink(appLink(KNOWLEDGE, { node: w.page!.ref_id }))}>
                  <BookOpen className="size-3.5" />
                  its page
                </Button>
              )}
              {may && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Change ${w.name}`} disabled={busy}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setOpen({ kind: "add", workspace: w })}>Add repositories…</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setOpen({ kind: "rename", workspace: w })}>Rename…</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onSelect={() => setOpen({ kind: "delete", workspace: w })}>
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col divide-y px-4">
            {looking[w.ref_id] && !(chatOf.get(w.ref_id) && "session" in chatOf.get(w.ref_id)!) && (
              <p className={`pb-2 text-sm ${looking[w.ref_id] === "looking" ? "text-muted-foreground" : ""}`}>
                {looking[w.ref_id] === "looking"
                  ? "Opening its chat…"
                  : looking[w.ref_id] === "none"
                    ? "No chat about its setup turned up: nothing on this box sets workspaces up, or its setup was refused."
                    : "Its chat can't be opened from here: this box's strut can't find a chat about a workspace yet."}
              </p>
            )}
            {w.repositories.map((url) => {
              const r = byUrl.get(url);
              if (!r) return null;
              return (
                <div key={url} className="flex items-start gap-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
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
                  {may && w.repositories.length > 1 && (
                    <Button variant="ghost" size="icon" aria-label={`Take ${r.name} out of ${w.name}`} title={`Take it out of ${w.name}`} disabled={busy} onClick={() => setOpen({ kind: "take", workspace: w, repository: r })}>
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {open?.kind === "setup" && (
        <SetUpDialog suggested={open.suggested} names={reachName} busy={busy} onClose={close} onSetUp={(note) => setUp(() => client.run<{ workspace: string }>(DEFAULT, note ? { note } : {}))} />
      )}

      {(open?.kind === "new" || open?.kind === "add") && (
        <PickDialog
          workspace={open.kind === "add" ? open.workspace : undefined}
          address={open.kind === "new" ? open.address : undefined}
          busy={busy}
          onClose={close}
          onSave={(name, repositories, note) =>
            open.kind === "new"
              ? setUp(() => client.run<{ workspace: string }>(WORKSPACE, { name, repositories, create: true, ...(note ? { note } : {}) }))
              : done(() => client.run(WORKSPACE, { name, repositories }))
          }
        />
      )}

      {open?.kind === "rename" && <RenameDialog workspace={open.workspace} busy={busy} onClose={close} onSave={(name) => done(() => client.run(RENAME, { workspace: open.workspace.name, name }))} />}

      {open?.kind === "delete" && (
        <AlertDialog open onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {open.workspace.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The workspace goes{open.workspace.page ? ", with its page" : ""}, and so does whatever was set up for it.
                {onlyIn(open.workspace).length ? ` ${onlyIn(open.workspace).join(", ")} ${onlyIn(open.workspace).length === 1 ? "is" : "are"} in no other workspace, so ${onlyIn(open.workspace).length === 1 ? "it leaves" : "they leave"} the box.` : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const workspace = open.workspace.name;
                  close();
                  void act(() => client.run(DELETE, { workspace }));
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {open?.kind === "take" && (
        <AlertDialog open onOpenChange={(o) => !o && close()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Take {open.repository.name} out of {open.workspace.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {open.repository.workspaces.length <= 1 ? `It is in no other workspace, so it leaves the box.` : `It stays in ${open.repository.workspaces.filter((n) => n !== open.workspace.name).join(", ")}.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const { workspace, repository } = open;
                  close();
                  void act(() => client.run(WORKSPACE, { name: workspace.name, remove: [repository.url] }));
                }}
              >
                Take it out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/**
 * New workspace, or Add repositories to one: the repositories the viewer's
 * forges reach (strut's git/repositories, read as them), ticked, plus any
 * typed by address. Create writes the workspace and that is all: setting
 * it up is the package's that runs workspaces.
 */
function PickDialog(props: { workspace?: Workspace; address?: string; busy: boolean; onClose: () => void; onSave: (name: string, repositories: string[], note: string) => Promise<void> }) {
  const { workspace, address, busy, onClose, onSave } = props;
  const client = useStrutClient();
  // What the forges reach, read only while the dialog is open.
  const reach = useQuery({ queryKey: ["code", "reach"], queryFn: () => client.run<List>(LIST, { reachable: true }), staleTime: 60_000 });
  const [name, setName] = useState(workspace?.name ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const [typed, setTyped] = useState<string[]>(address ? [address] : []);
  const [field, setField] = useState("");
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const holds = new Set(workspace?.repositories ?? []);
  const reachable = (reach.data?.reachable ?? []).filter((r) => !holds.has(r.url));
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? reachable.filter((r) => r.name.toLowerCase().includes(f) || r.url.toLowerCase().includes(f)) : reachable;
  }, [reachable, filter]);
  const picked = [...new Set([...chosen, ...typed])];
  const toggle = (url: string, on: boolean) => setChosen((c) => (on ? [...new Set([...c, url])] : c.filter((u) => u !== url)));
  const addTyped = (e: FormEvent) => {
    e.preventDefault();
    const u = field.trim();
    if (u) setTyped((t) => [...new Set([...t, u])]);
    setField("");
  };
  const problems = [...(reach.data?.reach_problem ? [reach.data.reach_problem] : []), ...(reach.data?.hosts ?? []).filter((h) => h.problem).map((h) => `${h.host}: ${h.problem}`)];
  const ready = picked.length > 0 && (workspace || name.trim());
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{workspace ? `Add repositories to ${workspace.name}` : "New workspace"}</DialogTitle>
          <DialogDescription>
            {workspace ? "Each one goes in only when your own account reads it." : "A set of repositories to work on"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          {!workspace && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="workspace-name">Name</Label>
              <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="such as hive" autoFocus />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label>What your accounts reach</Label>
            {reach.isLoading && <p className="text-sm text-muted-foreground">Asking your forges…</p>}
            {reach.error && <p className="text-sm text-destructive">{message(reach.error)}</p>}
            {problems.map((p) => (
              <p key={p} className="text-xs text-muted-foreground">
                {p}
              </p>
            ))}
            {reachable.length > 8 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter the repositories" className="h-8" />}
            {reach.data && !reachable.length && <p className="text-sm text-muted-foreground">None here{workspace ? " that it doesn't hold" : ""}. Add one by its address below.</p>}
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {shown.map((r) => (
                <Label key={r.url} className="flex items-start gap-2 py-0.5 font-normal" title={r.url}>
                  <Checkbox className="mt-0.5" checked={chosen.includes(r.url)} onCheckedChange={(v) => toggle(r.url, v === true)} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1">
                      <span className="font-medium">{r.name}</span>
                      {r.private && <Lock className="size-3 text-muted-foreground" aria-label="private" />}
                      <span className="truncate text-xs text-muted-foreground">{r.url.replace(/^https:\/\//, "").replace(/\/[^/]+$/, "")}</span>
                    </span>
                    {r.description && <span className="line-clamp-1 text-xs text-muted-foreground">{r.description}</span>}
                  </span>
                </Label>
              ))}
            </div>
          </div>
          <form onSubmit={addTyped} className="flex flex-col gap-1">
            <Label htmlFor="workspace-address">Or an address</Label>
            <div className="flex gap-2">
              <Input id="workspace-address" value={field} onChange={(e) => setField(e.target.value)} placeholder="https://example.com/team/app" />
              <Button type="submit" variant="outline" disabled={!field.trim()}>
                Add
              </Button>
            </div>
            {typed.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {typed.map((u) => (
                  <Badge key={u} variant="secondary" className="gap-1 font-mono" title={u}>
                    {tail(u)}
                    <button type="button" aria-label={`Leave ${u} out`} onClick={() => setTyped((t) => t.filter((x) => x !== u))}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </form>
          {!workspace && <NoteField value={note} onChange={setNote} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !ready || note.trim().length > NOTE_MOST} onClick={() => void onSave(workspace?.name ?? name.trim(), picked, note.trim())}>
            {busy ? "Working…" : workspace ? `Add ${picked.length || ""}`.trim() : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Set up's one field, optional: what the person knows that its setup
 *  should. It goes on the workspace as `note`, under "Set up <name>" in the
 *  chat its setup starts. */
function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const over = value.trim().length > NOTE_MOST;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="workspace-note">
        Additional information <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea id="workspace-note" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Any extra information for Jamie, such as which repo to serve the frontend from" className="max-h-48" />
      {over && <p className="text-xs text-destructive">At most {NOTE_MOST.toLocaleString()} characters: this is {value.trim().length.toLocaleString()}.</p>}
    </div>
  );
}

/** The suggested default workspace's Set up: what it holds, and the note. */
function SetUpDialog(props: { suggested: { name: string; repositories: string[] }; names: Map<string, string>; busy: boolean; onClose: () => void; onSetUp: (note: string) => Promise<void> }) {
  const { suggested, names, busy, onClose, onSetUp } = props;
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length <= NOTE_MOST) void onSetUp(note.trim());
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Set up {suggested.name}</DialogTitle>
            <DialogDescription>
              {suggested.repositories.map((u) => names.get(u) ?? tail(u)).join(" · ")}. Jamie sets it up and bakes it, as you, in a chat of yours that opens here.
            </DialogDescription>
          </DialogHeader>
          <NoteField value={note} onChange={setNote} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || note.trim().length > NOTE_MOST}>
              {busy ? "Working…" : "Set up"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ workspace, busy, onClose, onSave }: { workspace: Workspace; busy: boolean; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(workspace.name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== workspace.name) void onSave(name.trim());
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename {workspace.name}</DialogTitle>
            <DialogDescription>It keeps its repositories and what was set up for it{workspace.page ? ", and its page takes the new name" : ""}.</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Its new name" autoFocus />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === workspace.name}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
