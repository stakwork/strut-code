/**
 * What every step of stadeum/code shares: the graph, through strut's own
 * `graph/*` steps; an address, checked; a remote, asked for its head; and
 * the list, as the graph holds it.
 *
 * The contract (the two types' fields and the link between them) is the
 * Repositories page, `concepts/Repositories.md`. Another package reads these
 * nodes without requiring this one.
 */
import { tmpdir } from "node:os";

export const REPOSITORY = "Repository";
export const WORKSPACE = "Workspace";
/** `Workspace -[INCLUDES]-> Repository`: one edge for each repository in it. */
export const INCLUDES = "INCLUDES";

/** A workspace's name: what pods' `claim { workspace }` takes. */
export const WORKSPACE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

interface StepDef {
  input: { parse(v: unknown): unknown };
  run(cfg: unknown, ctx: unknown): Promise<unknown>;
}

interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** The part of strut's step context these steps read. */
export interface Ctx {
  /** Set by strut's app door on a page's call, and carried by every run the
   *  page launches: the app (its name from the identity strut signed for the
   *  page) and `admin` when its viewer is an admin. */
  app?: { name: string; version?: string; admin?: boolean };
  registry?: Record<string, StepDef | undefined>;
  services: {
    shell?: (req: { cmd: string; args?: string[]; cwd: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<ShellResult>;
    dataDir?: string;
  };
}

export const asCtx = (ctx: unknown): Ctx => ctx as Ctx;

// ── the graph ─────────────────────────────────────────────────────────────

/** Run strut's own `graph/<step>` with this step's context, so its rules
 *  (the namespace, the run's branch, who wrote it) hold as they do for any
 *  other caller. A graph step answers a failure as text: that is thrown. */
export async function graph<T>(ctx: Ctx, step: string, config: Record<string, unknown>): Promise<T> {
  const def = ctx.registry?.[`graph/${step}`];
  if (!def) throw new Error(`stadeum/code needs strut's graph/${step} step, and this strut server has none: the package needs a graph`);
  const out = await def.run(def.input.parse(config), ctx);
  if (typeof out === "string") throw new Error(out);
  return out as T;
}

interface Found {
  ref_id: string;
  properties: Record<string, unknown>;
}

interface Written {
  status: "Success" | "Warning";
  ref_id: string;
  messages?: string[];
}

/** Every node of a type, oldest first. */
async function all(ctx: Ctx, type: string): Promise<Found[]> {
  const out: Found[] = [];
  let cursor: string | undefined;
  do {
    const page = await graph<{ nodes: Found[]; cursor?: string }>(ctx, "find", { node_type: type, limit: 500, ...(cursor ? { cursor } : {}) });
    out.push(...page.nodes);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export interface Repo {
  ref_id: string;
  url: string;
  name: string;
  branch?: string;
  head?: string;
  checked?: string;
  ingested?: string;
  problem?: string;
}

export interface Space {
  ref_id: string;
  name: string;
  main?: string;
  /** Its repositories' addresses, the main one first, then by name. */
  repositories: string[];
}

export interface List {
  repositories: Repo[];
  workspaces: Space[];
}

const toRepo = (n: Found): Repo => {
  const p = n.properties;
  const r: Repo = { ref_id: n.ref_id, url: text(p["url"]) ?? "", name: text(p["name"]) ?? "" };
  for (const k of ["branch", "head", "checked", "ingested", "problem"] as const) {
    const v = text(p[k]);
    if (v) r[k] = v;
  }
  return r;
};

const chunks = <T>(xs: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** The list as the graph holds it now. */
export async function readList(ctx: Ctx): Promise<List> {
  const [repoNodes, spaceNodes] = await Promise.all([all(ctx, REPOSITORY), all(ctx, WORKSPACE)]);
  const repos = repoNodes.map(toRepo).filter((r) => r.url);
  const byRef = new Map(repos.map((r) => [r.ref_id, r]));
  const spaceRefs = new Set(spaceNodes.map((n) => n.ref_id));
  const members = new Map<string, Set<string>>();
  // `graph/graph-edges` takes 1,000 nodes and 5,000 others a call.
  for (const ids of chunks([...spaceRefs], 1000)) {
    for (const among of chunks([...byRef.keys()], 5000)) {
      const { edges } = await graph<{ edges: Array<{ source: string; target: string; edge_type: string }> }>(ctx, "graph-edges", { ref_ids: ids, among });
      for (const e of edges) {
        if (e.edge_type !== INCLUDES || !spaceRefs.has(e.source) || !byRef.has(e.target)) continue;
        (members.get(e.source) ?? members.set(e.source, new Set()).get(e.source)!).add(byRef.get(e.target)!.url);
      }
    }
  }
  const nameOf = new Map(repos.map((r) => [r.url, r.name]));
  const workspaces = spaceNodes
    .map((n): Space => {
      const main = text(n.properties["main"]);
      const urls = [...(members.get(n.ref_id) ?? [])].sort((a, b) => (a === main ? -1 : b === main ? 1 : (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b) || a.localeCompare(b)));
      return { ref_id: n.ref_id, name: text(n.properties["name"]) ?? "", ...(main ? { main } : {}), repositories: urls };
    })
    .filter((w) => w.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  repos.sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
  return { repositories: repos, workspaces };
}

/** One repository by its address, or none. */
export async function findRepository(ctx: Ctx, url: string): Promise<Repo | undefined> {
  const { nodes } = await graph<{ nodes: Found[] }>(ctx, "find", { node_type: REPOSITORY, where: { url }, limit: 1 });
  return nodes[0] ? toRepo(nodes[0]) : undefined;
}

/** The list as a reader is given it: no graph ids, each repository with its workspaces. */
export function view(list: List) {
  return {
    repositories: list.repositories.map(({ ref_id: _ref, ...r }) => ({ ...r, workspaces: list.workspaces.filter((w) => w.repositories.includes(r.url)).map((w) => w.name) })),
    workspaces: list.workspaces.map(({ ref_id: _ref, ...w }) => w),
  };
}

// ── who may change it ─────────────────────────────────────────────────────

/** The package's own app, where the list is changed. */
export const CODE_APP = "stadeum/code/code";

/**
 * May this call change the list? Only an admin's call from this package's
 * own Code app, or a run that page launched. Strut's app door names the app
 * from the identity it signed for the page (`ctx.app.name`), and no other
 * app may take a name under an installed package's prefix; it says whether
 * the viewer is an admin (`ctx.app.admin`). Any other app an admin opens may
 * list these steps among its grants, so an admin's call from it changes
 * nothing, as strut gives a package's admin scope to its own app alone
 * (stakwork/strut#789). A builder's preview of the app is not the app.
 */
export function mayChange(ctx: Ctx): boolean {
  const app = ctx.app;
  return app?.admin === true && app.name === CODE_APP && !app.version?.startsWith("preview-");
}

export function requireAdmin(ctx: Ctx): void {
  if (mayChange(ctx)) return;
  const app = ctx.app;
  if (app?.admin === true) {
    const from = app.name === CODE_APP ? "a preview of it" : app.name;
    throw new Error(`the box's repositories are changed in the Code app (${CODE_APP}), not from ${from}`);
  }
  throw new Error("only an admin changes the box's repositories, in the Code app");
}

// ── an address ────────────────────────────────────────────────────────────

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const EXAMPLE = "such as https://example.com/team/app";

export interface Address {
  /** `https://<host>/<owner…>/<name>`: no credentials, query, trailing slash or `.git`. */
  url: string;
  host: string;
  owner: string;
  name: string;
}

/** A repository's address, checked and written one way, so the same
 *  repository typed twice is one address. Only https: it is what any forge
 *  serves and what git reaches with a token by host. */
export function address(raw: unknown): Address {
  const given = typeof raw === "string" ? raw.trim() : "";
  if (!given) throw new Error(`a repository's address is its https URL, ${EXAMPLE}`);
  if (given.length > 300) throw new Error("that address is over 300 characters");
  if (/^[^\s/:@]+@[^\s/:]+:/.test(given) || /^ssh:/i.test(given)) throw new Error(`${given} is an ssh address: give the repository's https address, ${EXAMPLE}`);
  let u: URL;
  try {
    u = new URL(given);
  } catch {
    throw new Error(`"${given}" is not an address: give the repository's https URL, ${EXAMPLE}`);
  }
  if (u.protocol !== "https:") throw new Error(`${given}: only an https address is taken, ${EXAMPLE}`);
  if (u.username || u.password) throw new Error("an address carries no user name or token: give it without them");
  if (u.search || u.hash) throw new Error(`${given}: a repository's address has no ? or # part`);
  if (!HOST.test(u.hostname)) throw new Error(`${given}: "${u.hostname}" is not a host name`);
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2) throw new Error(`${given}: an address names the repository's owner and its name, ${EXAMPLE}`);
  segs[segs.length - 1] = segs[segs.length - 1]!.replace(/\.git$/i, "");
  for (const s of segs) if (!SEGMENT.test(s)) throw new Error(`${given}: "${s}" is not a part of a repository's address (letters, digits, '.', '_' and '-')`);
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  return { url: `https://${host}/${segs.join("/")}`, host, owner: segs.slice(0, -1).join("/"), name: segs[segs.length - 1]! };
}

/** A workspace's name as given, lowercased and checked. */
export function workspaceName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!WORKSPACE_NAME.test(name)) throw new Error(`"${String(raw)}" is not a workspace's name: lowercase letters, digits, '.', '_' and '-', at most 63, starting with a letter or digit`);
  return name;
}

/** The names a repository's own workspace may take, in order: its name,
 *  then its owner's and its name, then its name numbered. */
export function workspaceNames(a: Address): string[] {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[^a-z0-9]+/, "")
      .slice(0, 63)
      .replace(/[._-]+$/, "");
  const base = slug(a.name) || "repository";
  const owner = slug(`${a.owner.split("/").pop() ?? ""}-${a.name}`);
  const out = [base, ...(owner && owner !== base ? [owner] : [])];
  for (let i = 2; i < 100; i++) out.push(`${base.slice(0, 60)}-${i}`);
  return out;
}

// ── a remote ──────────────────────────────────────────────────────────────

export interface Remote {
  /** The remote's default branch: where its HEAD points. */
  branch: string;
  /** The commit at its head. */
  head: string;
}

/**
 * Ask a repository's remote for its default branch and the commit at its
 * head, as `git ls-remote --symref <url> HEAD` does: one request, no clone.
 * Through strut's shell, which runs git with no shell between and a scrubbed
 * environment, so the address is one argument as it is. No credential is
 * used: no helper, no prompt, no git configuration of the server's.
 */
export async function askRemote(ctx: Ctx, url: string): Promise<Remote> {
  const shell = ctx.services.shell;
  if (!shell) throw new Error("stadeum/code runs git through strut's shell, and this run has none");
  const r = await shell({
    cmd: "git",
    args: ["-c", "credential.helper=", "ls-remote", "--symref", url, "HEAD"],
    cwd: ctx.services.dataDir ?? tmpdir(),
    env: { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeoutMs: 30_000,
  });
  if (r.timedOut) throw new Error(`${url}: its remote did not answer in 30 seconds`);
  if (r.code !== 0) throw new Error(remoteProblem(url, r.stderr));
  let branch: string | undefined;
  let head: string | undefined;
  for (const line of r.stdout.split("\n")) {
    const sym = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(line);
    if (sym) branch = sym[1];
    const sha = /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/.exec(line);
    if (sha) head = sha[1];
  }
  if (!head) throw new Error(`${url} has no commits yet: its remote names no head`);
  if (!branch) throw new Error(`${url}: its remote does not say which branch is its default`);
  return { branch, head };
}

/** What git's failure means, in a sentence a person reads. */
export function remoteProblem(url: string, stderr: string): string {
  const first = stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? "no reason given";
  if (/terminal prompts disabled|could not read (username|password)|authentication failed|access denied|returned error: 40[13]|\b40[13]\b/i.test(stderr)) {
    return `${url} asks for a sign-in: it is private, or there is no repository there. This version reads public repositories only: a private one needs git credentials for its host, which strut doesn't have yet.`;
  }
  if (/not found|returned error: 404|\b404\b/i.test(stderr)) return `there is no repository at ${url}`;
  if (/could not resolve host|failed to connect|connection refused|timed out/i.test(stderr)) return `${url} can't be reached: ${first.replace(/^fatal:\s*/, "")}`;
  return `${url}: git ls-remote failed: ${first.replace(/^fatal:\s*/, "")}`;
}

// ── changing the list ─────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export const link = (ctx: Ctx, space: string, repo: string) => graph(ctx, "create-triplet", { source_ref_id: space, target_ref_id: repo, edge_type: INCLUDES });
export const unlink = (ctx: Ctx, space: string, repo: string) => graph(ctx, "delete-edge", { source_ref_id: space, edge_type: INCLUDES, target_ref_id: repo });

/** A new Workspace, or why there is none: a name strut's graph keys as it
 *  keys another (graph keys drop punctuation and case). */
async function newWorkspace(ctx: Ctx, name: string, main: string): Promise<Written> {
  return graph<Written>(ctx, "create-node", { node_type: WORKSPACE, node_data: { name, main } });
}

/** Take `url` out of a workspace: a workspace left empty goes; one whose
 *  main it was takes its next repository as main. */
async function leave(ctx: Ctx, space: Space, repo: Repo): Promise<"left" | "deleted"> {
  await unlink(ctx, space.ref_id, repo.ref_id);
  const rest = space.repositories.filter((u) => u !== repo.url);
  if (!rest.length) {
    await graph(ctx, "delete-node", { ref_id: space.ref_id, reason: `its last repository, ${repo.url}, left it` });
    return "deleted";
  }
  if (space.main === repo.url || !space.main) await graph(ctx, "edit-node", { ref_id: space.ref_id, node_data: { main: rest[0] } });
  return "left";
}

/** Add a repository by its address: one node however often it is added,
 *  and, when it is new, a workspace of its own named after it. */
export async function addRepository(ctx: Ctx, raw: unknown) {
  const a = address(raw);
  const list = await readList(ctx);
  const known = list.repositories.find((r) => r.url === a.url);
  const inSpaces = (url: string) => list.workspaces.filter((w) => w.repositories.includes(url)).map((w) => w.name);
  if (known) return { url: known.url, name: known.name, branch: known.branch, head: known.head, created: false, workspaces: inSpaces(known.url) };

  const remote = await askRemote(ctx, a.url);
  const fields = { url: a.url, name: a.name, branch: remote.branch, head: remote.head, checked: now() };
  const made = await graph<Written>(ctx, "create-node", { node_type: REPOSITORY, node_data: fields });
  if (made.status === "Warning") {
    const other = list.repositories.find((r) => r.ref_id === made.ref_id);
    throw new Error(`${a.url} can't be listed beside ${other?.url ?? "a repository already in the graph"}: strut's graph keys the two addresses alike (its keys drop punctuation and case)`);
  }
  // A repository removed before and added again comes back as it was: start it over.
  if (made.messages?.some((m) => /restored/i.test(m))) {
    await graph(ctx, "edit-node", { ref_id: made.ref_id, node_data: fields });
    const back = await findRepository(ctx, a.url);
    const stale = (["ingested", "problem"] as const).filter((k) => back?.[k]);
    if (stale.length) await graph(ctx, "edit-node", { ref_id: made.ref_id, properties_to_be_deleted: stale });
  }

  const taken = new Set(list.workspaces.map((w) => w.name));
  for (const name of workspaceNames(a)) {
    if (taken.has(name)) continue;
    const space = await newWorkspace(ctx, name, a.url);
    if (space.status === "Warning") continue;
    await link(ctx, space.ref_id, made.ref_id);
    return { ...fields, created: true, workspaces: [name] };
  }
  throw new Error(`${a.url} is listed, but no name was free for a workspace of its own: put it in one with Workspaces`);
}

/** Remove a repository: out of every workspace, then off the list. */
export async function removeRepository(ctx: Ctx, url: string) {
  const list = await readList(ctx);
  const repo = list.repositories.find((r) => r.url === url);
  if (!repo) throw new Error(`${url} is not one of the box's repositories`);
  const deleted: string[] = [];
  const left: string[] = [];
  for (const space of list.workspaces.filter((w) => w.repositories.includes(url))) {
    ((await leave(ctx, space, repo)) === "deleted" ? deleted : left).push(space.name);
  }
  await graph(ctx, "delete-node", { ref_id: repo.ref_id, reason: "removed from the box's repositories" });
  return { removed: url, left, deleted };
}

/** Put a repository in exactly these workspaces: a new name makes a
 *  workspace with it as main; a workspace it leaves empty goes. */
export async function placeRepository(ctx: Ctx, url: string, names: unknown[]) {
  const wanted = [...new Set(names.map(workspaceName))];
  if (!wanted.length) throw new Error("a repository is in one workspace at least: to take it off the list, remove it");
  const list = await readList(ctx);
  const repo = list.repositories.find((r) => r.url === url);
  if (!repo) throw new Error(`${url} is not one of the box's repositories`);
  const made: string[] = [];
  for (const name of wanted) {
    const space = list.workspaces.find((w) => w.name === name);
    if (space?.repositories.includes(url)) continue;
    if (space) {
      await link(ctx, space.ref_id, repo.ref_id);
      continue;
    }
    const fresh = await newWorkspace(ctx, name, url);
    if (fresh.status === "Warning") {
      const other = list.workspaces.find((w) => w.ref_id === fresh.ref_id);
      throw new Error(`"${name}" can't be a workspace beside "${other?.name ?? "another"}": strut's graph keys the two names alike`);
    }
    await link(ctx, fresh.ref_id, repo.ref_id);
    made.push(name);
  }
  const deleted: string[] = [];
  for (const space of list.workspaces) {
    if (wanted.includes(space.name) || !space.repositories.includes(url)) continue;
    if ((await leave(ctx, space, repo)) === "deleted") deleted.push(space.name);
  }
  return { url, workspaces: wanted.sort(), made, deleted };
}

/** Name a workspace's main repository: one already in it. */
export async function setMain(ctx: Ctx, workspace: unknown, url: string) {
  const name = workspaceName(workspace);
  const list = await readList(ctx);
  const space = list.workspaces.find((w) => w.name === name);
  if (!space) throw new Error(`there is no workspace ${name}`);
  if (!space.repositories.includes(url)) throw new Error(`${url} is not in ${name}: put it there first`);
  if (space.main !== url) await graph(ctx, "edit-node", { ref_id: space.ref_id, node_data: { main: url } });
  return { workspace: name, main: url };
}

/** `check`'s pass: ask every remote, record a moved head (and branch), say
 *  why one failed, and name the repositories whose head is not ingested. */
export async function checkHeads(ctx: Ctx) {
  const list = await readList(ctx);
  const at = now();
  const moved: string[] = [];
  const ingest: string[] = [];
  const problems: Array<{ url: string; problem: string }> = [];
  const one = async (repo: Repo) => {
    try {
      const remote = await askRemote(ctx, repo.url);
      const data: Record<string, string> = { checked: at };
      if (remote.head !== repo.head) {
        data["head"] = remote.head;
        moved.push(repo.url);
      }
      if (remote.branch !== repo.branch) data["branch"] = remote.branch;
      await graph(ctx, "edit-node", { ref_id: repo.ref_id, node_data: data, ...(repo.problem ? { properties_to_be_deleted: ["problem"] } : {}) });
      if (remote.head !== repo.ingested) ingest.push(repo.url);
    } catch (e) {
      const problem = e instanceof Error ? e.message : String(e);
      problems.push({ url: repo.url, problem });
      // A repository removed while this ran has no node to write to.
      await graph(ctx, "edit-node", { ref_id: repo.ref_id, node_data: { checked: at, problem } }).catch(() => undefined);
    }
  };
  // Four remotes at a time.
  const queue = [...list.repositories];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) await one(repo);
  }));
  return { checked: list.repositories.length, moved: moved.sort(), ingest: ingest.sort(), problems };
}

/** `ingest`'s record: the repository's head, taken in. A parser plugs in
 *  before it, in the `ingest` workflow. */
export async function recordIngested(ctx: Ctx, url: string) {
  const repo = await findRepository(ctx, url);
  if (!repo) throw new Error(`${url} is not one of the box's repositories`);
  if (!repo.head || repo.ingested === repo.head) return { url, ...(repo.head ? { commit: repo.head } : {}), recorded: false };
  await graph(ctx, "edit-node", { ref_id: repo.ref_id, node_data: { ingested: repo.head } });
  return { url, commit: repo.head, recorded: true };
}
