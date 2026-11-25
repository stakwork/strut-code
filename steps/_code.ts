/**
 * What every step of stadeum/code shares: the graph, through strut's own
 * `graph/*` steps; an address, checked; a remote, asked for its head; what
 * the forges reach, through strut's `git/repositories`; and the workspaces
 * and their repositories, as the graph holds them.
 *
 * The contract (the two types' fields and the link between them) is the
 * Repositories page, `concepts/Repositories.md`. Another package reads these
 * nodes without requiring this one.
 */
export const REPOSITORY = "Repository";
export const WORKSPACE = "Workspace";
/** `Workspace -[INCLUDES]-> Repository`: one edge for each repository in it. */
export const INCLUDES = "INCLUDES";

/** A workspace's name: what pods' `claim { workspace }` takes. */
export const WORKSPACE_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** A workspace's page: the Concept `<workspace> workspace`, which
 *  stadeum/pods writes at the bake. Not the bare name: that is a
 *  repository's page. */
export const CONCEPT = "Concept";
export const pageName = (workspace: string) => `${workspace} workspace`;

/** The most repositories one call puts in a workspace. */
export const MOST = 50;

/** The longest `note` a workspace's Set up takes, in characters. */
export const NOTE_MOST = 4000;

interface StepDef {
  input: { parse(v: unknown): unknown };
  run(cfg: unknown, ctx: unknown): Promise<unknown>;
}

/** The part of strut's step context these steps read. */
export interface Ctx {
  /** Set by strut's app door on a page's call, and carried by every run the
   *  page launches: the app (its name from the identity strut signed for the
   *  page) and `admin` when its viewer is an admin. */
  app?: { name: string; version?: string; admin?: boolean };
  registry?: Record<string, StepDef | undefined>;
  /** Whom the run is as: the person who launched it (a page's viewer, a
   *  job's person), else its workflow's owner (`check`'s schedule). Their
   *  secrets are the run's. */
  actor?: string;
  principal?: string;
  /** Set when the run is a fire of an automation: `check`'s schedule. */
  automation?: { id: string };
}

export const asCtx = (ctx: unknown): Ctx => ctx as Ctx;

const person = (ctx: Ctx): string | undefined => ctx.principal ?? ctx.actor;

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
  /** Its repositories' addresses, by name. */
  repositories: string[];
  /** Its page, when it has been baked: the Concept `<name> workspace`. */
  page?: { name: string; ref_id: string };
  /** What the person who set it up wrote in Set up's "Additional
   *  information", for whatever sets it up to read. */
  note?: string;
  /** It still carries `main`, which 0.6 and before wrote: `check` clears it. */
  oldMain?: true;
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

/** The workspaces and their repositories as the graph holds them now. */
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
  const byName = (a: string, b: string) => (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b) || a.localeCompare(b);
  const pages = await pagesOf(ctx, spaceNodes.map((n) => text(n.properties["name"])).filter((s): s is string => !!s));
  const workspaces = spaceNodes
    .map((n): Space => {
      const name = text(n.properties["name"]) ?? "";
      const page = pages.get(pageName(name));
      const note = text(n.properties["note"]);
      return {
        ref_id: n.ref_id,
        name,
        repositories: [...(members.get(n.ref_id) ?? [])].sort(byName),
        ...(page ? { page: { name: pageName(name), ref_id: page } } : {}),
        ...(note ? { note } : {}),
        ...(text(n.properties["main"]) ? { oldMain: true as const } : {}),
      };
    })
    .filter((w) => w.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  repos.sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
  return { repositories: repos, workspaces };
}

/** The workspaces' pages there are, each name's ref_id: one read per 500. */
async function pagesOf(ctx: Ctx, workspaces: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const names of chunks(workspaces.map(pageName), 500)) {
    const { nodes } = await graph<{ nodes: Found[] }>(ctx, "find", { node_type: CONCEPT, where: { name: { in: names } }, limit: 500 });
    for (const n of nodes) {
      const name = text(n.properties["name"]);
      if (name) out.set(name, n.ref_id);
    }
  }
  return out;
}

/** One repository by its address, or none. */
export async function findRepository(ctx: Ctx, url: string): Promise<Repo | undefined> {
  const { nodes } = await graph<{ nodes: Found[] }>(ctx, "find", { node_type: REPOSITORY, where: { url }, limit: 1 });
  return nodes[0] ? toRepo(nodes[0]) : undefined;
}

/** The list as a reader is given it: each repository with its workspaces,
 *  and no repository's node id. A workspace keeps its ref_id, as its page
 *  does: a chat is about the workspace's node (strut's `conversation/list
 *  { about }`), and the Knowledge app opens a page by its node. */
export function view(list: List) {
  return {
    repositories: list.repositories.map(({ ref_id: _ref, ...r }) => ({ ...r, workspaces: list.workspaces.filter((w) => w.repositories.includes(r.url)).map((w) => w.name) })),
    workspaces: list.workspaces.map(({ oldMain: _main, ...w }) => w),
  };
}

// ── strut's Recent Work ───────────────────────────────────────────────────

/** One of a person's chats, as strut's `conversation/list` gives it: the
 *  node it is about, when a package started it about one, and when it last
 *  changed. */
export interface Chat {
  about?: unknown;
  updatedAt?: unknown;
}

/** The items of the `Recent Workspaces` page (`stadeum/code/recent`, under
 *  strut's `Recent Work`): each workspace with its repositories as
 *  `host/owner/name`. The ones the person's chats are about come first,
 *  the newest day first, then the rest by name. Ordered by the day alone,
 *  which is what strut shows, so the list changes only when what it shows
 *  does: strut sends it again only then. */
export function recentItems(list: List, chats: readonly Chat[]) {
  const last = new Map<string, string>();
  for (const c of chats) {
    if (typeof c.about !== "string" || typeof c.updatedAt !== "string") continue;
    if (c.updatedAt > (last.get(c.about) ?? "")) last.set(c.about, c.updatedAt);
  }
  return list.workspaces
    .map((w) => ({ w, at: last.get(w.ref_id) }))
    .sort((a, b) => (b.at ?? "").slice(0, 10).localeCompare((a.at ?? "").slice(0, 10)) || a.w.name.localeCompare(b.w.name))
    .map(({ w, at }) => ({
      name: w.name,
      what: [at ? "you chatted about it" : "on this server", w.repositories.map((url) => url.replace(/^https:\/\//, "")).join(", ")].filter(Boolean).join("; "),
      ...(at ? { at } : {}),
    }));
}

/** The run's person's chats (strut's `conversation/list`): none for a run
 *  that is nobody's, or where strut can't say (an older strut, another
 *  app's page). */
async function chatsOf(ctx: Ctx): Promise<Chat[]> {
  const def = ctx.registry?.["conversation/list"];
  if (!ctx.actor || !def) return [];
  const out = (await def.run(def.input.parse({}), ctx).catch(() => undefined)) as { conversations?: unknown } | undefined;
  return Array.isArray(out?.conversations) ? out.conversations : [];
}

/** `stadeum/code/recent`: the workspaces the person most likely means. */
export async function recent(ctx: Ctx) {
  const [list, chats] = await Promise.all([readList(ctx), chatsOf(ctx)]);
  return { items: recentItems(list, chats) };
}

/** Set up's "Additional information" as it is kept: trimmed, none when
 *  empty, refused over NOTE_MOST characters. Line breaks stay: it is the
 *  person's own words, which whatever sets the workspace up reads. */
export function noteOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error("a workspace's note is text");
  const note = raw.replace(/\r\n?/g, "\n").trim();
  if (note.length > NOTE_MOST) throw new Error(`the additional information is ${note.length} characters: at most ${NOTE_MOST} go on a workspace`);
  return note || undefined;
}

// ── who may make and change workspaces ────────────────────────────────────

/** The package's own app, where people make and change workspaces. */
export const CODE_APP = "stadeum/code/code";

/**
 * Why this call may not make or change a workspace, or none when it may.
 *
 * Anyone may, as themselves (the owner's rule, 2026-11-23, stadeum's
 * plans/software.md row 23: "anyone can make a workspace"): any person the
 * Code app is shown to, and the job agent with the `workspace` tool. A
 * repository goes in only when their own token reads it (its remote is
 * asked as them), and whatever sets the workspace up runs as them, on
 * their bill.
 *
 * A page's call must be this package's own Code app: strut's app door names
 * the app from the identity it signed for the page (`ctx.app.name`), and no
 * other app may take a name under an installed package's prefix. Any app
 * may list these steps among its grants, so a call from another app, or a
 * builder's preview of this one, changes nothing. A call with no page (the
 * job agent's tool, a workflow) changes them as its person, and a run that
 * is nobody's changes nothing.
 */
export function refusal(ctx: Ctx): string | undefined {
  const app = ctx.app;
  if (app && (app.name !== CODE_APP || app.version?.startsWith("preview-"))) {
    return `workspaces are made and changed in the Code app (${CODE_APP}), not from ${app.name === CODE_APP ? "a preview of it" : app.name}`;
  }
  if (!person(ctx)) return "a workspace is made as a person, with their own access to its repositories, and this run is nobody's";
  return undefined;
}

export const mayChange = (ctx: Ctx): boolean => refusal(ctx) === undefined;

export function requireMaker(ctx: Ctx): void {
  const why = refusal(ctx);
  if (why) throw new Error(why);
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

/** Any text made into a workspace's name, or none. */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 63)
    .replace(/[._-]+$/, "");

// ── a remote ──────────────────────────────────────────────────────────────

export interface Remote {
  /** The remote's default branch: where its HEAD points. */
  branch: string;
  /** The commit at its head. */
  head: string;
}

/** strut's step that asks a remote, and what it fails with: a prefix each. */
const REMOTE_HEAD = "git/remote-head";
const REMOTE_FAILURE = /^remote_(denied|not_found|unreachable|empty):\s*/;

/**
 * Ask a repository's remote for its default branch and the commit at its
 * head, through strut's `git/remote-head` (`git ls-remote --symref <url>
 * HEAD`: one request, no clone), run from this step's own context. Strut
 * reads it as the person the run is: their own token for the address's
 * host, which strut hands git for that host alone and never to this
 * package; a host no secret serves, or a person with no token for it, is
 * asked with none, so a public repository works for anyone.
 */
export async function askRemote(ctx: Ctx, url: string, as: () => Promise<Asker> = () => asker(ctx)): Promise<Remote> {
  const def = ctx.registry?.[REMOTE_HEAD];
  if (!def) {
    throw new Error(
      `stadeum/code asks a repository's remote through strut's ${REMOTE_HEAD} step, and this strut server has none: it needs a newer strut (the step came with stakwork/strut#798, 2026-11-20)`,
    );
  }
  try {
    return (await def.run(def.input.parse({ repo: url, timeoutMs: 30_000 }), ctx)) as Remote;
  } catch (e) {
    throw new Error(remoteProblem(url, e instanceof Error ? e.message : String(e), await as()));
  }
}

/** Whom a remote is asked as, said to whoever reads why it failed: `you`
 *  on a person's own call from the Code app, else the person by name
 *  (`check`'s schedule runs as its workflow's owner, never as whoever looks
 *  at the app; a job runs as its person). */
export interface Asker {
  you?: true;
  /** The person, as `people/names` names them, with their actor. */
  who?: string;
  /** The run is `check`'s schedule: it runs as the workflow's owner. */
  scheduled?: true;
}

/** Whom this run asks as: `you` on a person's call from the Code app,
 *  otherwise the run's person, named. */
export async function asker(ctx: Ctx): Promise<Asker> {
  if (ctx.app && mayChange(ctx)) return { you: true };
  const actor = person(ctx);
  const scheduled = ctx.automation ? { scheduled: true as const } : {};
  if (!actor) return scheduled;
  let name: string | undefined;
  try {
    const def = ctx.registry?.["people/names"];
    const out = def ? ((await def.run(def.input.parse({ actors: [actor] }), ctx)) as { people?: Record<string, { name?: string }> }) : undefined;
    name = out?.people?.[actor]?.name;
  } catch {
    // A name is for showing: the actor says who it is without one.
  }
  return { who: name && name !== actor ? `${name} (${actor})` : actor, ...scheduled };
}

/** What `git/remote-head`'s failure means, in a sentence a person can act
 *  on: by its prefix, and, when it is access, whose is missing. */
export function remoteProblem(url: string, message: string, as: Asker = {}): string {
  const kind = REMOTE_FAILURE.exec(message)?.[1];
  let said = message.replace(REMOTE_FAILURE, "").replace(/\s+/g, " ").trim();
  if (said.startsWith(url)) said = said.slice(url.length).replace(/^:/, "").trim();
  const host = URL.canParse(url) ? new URL(url).host : "its host";
  // Whose access it is, and how to say it.
  const owner = as.scheduled ? `${as.who ?? "nobody"}, whom the check runs as (its workflow's owner),` : (as.who ?? "nobody");
  switch (kind) {
    case "denied": {
      const lead = `${url} asks for a sign-in: it is private, or there is no repository there`;
      if (as.you) return `${lead}, and you have no access to it: you have not connected an account for ${host}, or that account cannot read it. Connect one that can, then try again.`;
      const who = as.who ?? "nobody";
      const fix = as.scheduled ? ` Either ${who} connects one that can, or an admin gives the check workflow an owner whose account can.` : "";
      return `${lead}, and ${owner} has no access to it: ${who} has not connected an account for ${host}, or that account cannot read it.${fix}`;
    }
    case "not_found":
      // A forge may answer a private repository a person can't read as none at all.
      return `there is no repository at ${url} that ${as.you ? "you" : owner} can see`;
    case "unreachable":
      return `${url} can't be reached${said ? `: ${said}` : ""}`;
    case "empty":
      return `${url} ${said || "has no commits yet"}`;
    default:
      return `${url}: ${said || "its remote could not be asked"}`;
  }
}

/** Ask several remotes, four at a time; each answer or why not, in order. */
async function askAll(ctx: Ctx, urls: string[]): Promise<Array<Remote | Error>> {
  let named: Promise<Asker> | undefined;
  const as = () => (named ??= asker(ctx));
  const out: Array<Remote | Error> = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, urls.length) }, async () => {
      for (let i = next++; i < urls.length; i = next++) {
        out[i] = await askRemote(ctx, urls[i]!, as).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
      }
    }),
  );
  return out;
}

// ── what the forges reach ─────────────────────────────────────────────────

/** One repository a forge's token reaches, as strut's `git/repositories`
 *  answers it, its address written as this package writes one. */
export interface Reach {
  url: string;
  name: string;
  private?: boolean;
  /** When it was last pushed to, ISO 8601. */
  pushed?: string;
  description?: string;
  /** Granted one by one, not with all of its owner's: on GitHub, picked
   *  for an installation of selected repositories. */
  picked?: boolean;
}

export interface Reached {
  repositories: Reach[];
  /** Each forge's host, and why it reached nothing when it didn't: the
   *  person has not connected an account for it, say. */
  hosts: Array<{ host: string; problem?: string }>;
  /** Why nothing could be asked at all. */
  problem?: string;
}

/** strut's step that asks each forge's package what the run's person's
 *  token reaches (stakwork/strut#851, `plans/package-seams.md` §4). */
const GIT_REPOSITORIES = "git/repositories";

/**
 * What every forge reaches, as the run's person: strut's `git/repositories`
 * asks each forge package's `repositories` step, picked by its
 * `provides.git` entry, with that person's own token. This package names no
 * forge. A strut without the step reaches nothing, and says so.
 */
export async function reach(ctx: Ctx): Promise<Reached> {
  const def = ctx.registry?.[GIT_REPOSITORIES];
  if (!def) return { repositories: [], hosts: [], problem: `this strut lists no forge's repositories: that needs strut's ${GIT_REPOSITORIES} step (stakwork/strut#851). A repository can still be added by its address` };
  let out: unknown;
  try {
    out = await def.run(def.input.parse({}), ctx);
  } catch (e) {
    out = e instanceof Error ? e.message : String(e);
  }
  if (typeof out === "string") return { repositories: [], hosts: [], problem: `the forges' repositories could not be listed: ${out}` };
  const body = (out ?? {}) as { repositories?: unknown; hosts?: unknown };
  const seen = new Map<string, Reach>();
  for (const raw of Array.isArray(body.repositories) ? body.repositories : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    let a: Address;
    try {
      a = address(r["url"]);
    } catch {
      continue;
    }
    if (seen.has(a.url)) continue;
    const said = text(r["description"])?.replace(/\s+/g, " ").trim().slice(0, 200);
    seen.set(a.url, {
      url: a.url,
      name: text(r["name"]) ?? a.name,
      ...(typeof r["private"] === "boolean" ? { private: r["private"] } : {}),
      ...(text(r["pushed"]) && !Number.isNaN(Date.parse(r["pushed"] as string)) ? { pushed: r["pushed"] as string } : {}),
      ...(said ? { description: said } : {}),
      ...(r["picked"] === true ? { picked: true } : {}),
    });
  }
  const hosts = (Array.isArray(body.hosts) ? body.hosts : [])
    .map((h) => (h ?? {}) as { host?: unknown; problem?: unknown })
    .filter((h): h is { host: string; problem?: unknown } => typeof h.host === "string" && !!h.host)
    .map((h) => ({ host: h.host, ...(text(h.problem) ? { problem: text(h.problem)! } : {}) }));
  const repositories = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
  return { repositories, hosts };
}

/**
 * The box's default workspace, from what the forges reach (the owner's
 * rule, stadeum's plans/software.md row 24): every repository picked on
 * GitHub, or, when an org granted all of its repositories, the five most
 * recently pushed. Named after their owner: the one most of them share.
 * None when nothing is reached. It is only suggested: nothing is written
 * until a person presses Set up (`setUpDefault`).
 */
export function defaultWorkspace(reached: Reach[]): { name: string; repositories: string[] } | undefined {
  if (!reached.length) return undefined;
  const picked = reached.filter((r) => r.picked);
  const when = (r: Reach) => (r.pushed ? Date.parse(r.pushed) : 0);
  const chosen = picked.length ? picked : [...reached].sort((a, b) => when(b) - when(a) || a.name.localeCompare(b.name)).slice(0, 5);
  // A forge's owners may ignore case (GitHub's do): Stakwork is stakwork.
  const owners = new Map<string, number>();
  for (const r of chosen) {
    const owner = slug(address(r.url).owner.split("/").pop() ?? "");
    owners.set(owner, (owners.get(owner) ?? 0) + 1);
  }
  const owner = [...owners].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
  return { name: slug(owner) || "default", repositories: chosen.slice(0, MOST).map((r) => r.url).sort() };
}

// ── changing the workspaces ───────────────────────────────────────────────

const now = () => new Date().toISOString();

const link = (ctx: Ctx, space: string, repo: string) => graph(ctx, "create-triplet", { source_ref_id: space, target_ref_id: repo, edge_type: INCLUDES });
const unlink = (ctx: Ctx, space: string, repo: string) => graph(ctx, "delete-edge", { source_ref_id: space, edge_type: INCLUDES, target_ref_id: repo });

/** A workspace's INCLUDES edges, as the graph holds them: a node restored
 *  from a soft delete may bring old ones back. */
async function membersOf(ctx: Ctx, ref_id: string, repos: Repo[]): Promise<Set<string>> {
  const out = new Set<string>();
  const byRef = new Map(repos.map((r) => [r.ref_id, r.url]));
  for (const among of chunks([...byRef.keys()], 5000)) {
    const { edges } = await graph<{ edges: Array<{ source: string; target: string; edge_type: string }> }>(ctx, "graph-edges", { ref_ids: [ref_id], among });
    for (const e of edges) if (e.edge_type === INCLUDES && e.source === ref_id && byRef.has(e.target)) out.add(byRef.get(e.target)!);
  }
  return out;
}

/** A new Repository node for an address its remote answered, or why there
 *  is none: an address strut's graph keys as it keys another (graph keys
 *  drop punctuation and case). One removed before comes back as new. */
async function newRepository(ctx: Ctx, a: Address, remote: Remote, list: List): Promise<Repo> {
  const fields = { url: a.url, name: a.name, branch: remote.branch, head: remote.head, checked: now() };
  const made = await graph<Written>(ctx, "create-node", { node_type: REPOSITORY, node_data: fields });
  if (made.status === "Warning") {
    const other = list.repositories.find((r) => r.ref_id === made.ref_id);
    throw new Error(`${a.url} can't be listed beside ${other?.url ?? "a repository already in the graph"}: strut's graph keys the two addresses alike (its keys drop punctuation and case)`);
  }
  if (made.messages?.some((m) => /restored/i.test(m))) {
    await graph(ctx, "edit-node", { ref_id: made.ref_id, node_data: fields });
    const back = await findRepository(ctx, a.url);
    const stale = (["ingested", "problem"] as const).filter((k) => back?.[k]);
    if (stale.length) await graph(ctx, "edit-node", { ref_id: made.ref_id, properties_to_be_deleted: stale });
  }
  return { ref_id: made.ref_id, ...fields };
}

/** Take repositories out of a workspace, and off the box when it was the
 *  last workspace they were in. The urls that left the box. */
async function takeOut(ctx: Ctx, list: List, space: Space, urls: string[]): Promise<string[]> {
  const gone: string[] = [];
  for (const url of urls) {
    const repo = list.repositories.find((r) => r.url === url);
    if (!repo) continue;
    await unlink(ctx, space.ref_id, repo.ref_id);
    const elsewhere = list.workspaces.some((w) => w.ref_id !== space.ref_id && w.repositories.includes(url));
    if (!elsewhere) {
      await graph(ctx, "delete-node", { ref_id: repo.ref_id, reason: `it left ${space.name}, the last workspace it was in` });
      gone.push(url);
    }
  }
  return gone;
}

export interface Change {
  /** The workspace's name. */
  name: string;
  /** Repositories to put in it, by https address. */
  repositories?: unknown[];
  /** Repositories to take out of it. */
  remove?: unknown[];
  /** Only make it: refuse when a workspace has this name. */
  create?: boolean;
  /** Set up's "Additional information": on the node from its making, so
   *  whatever sets it up (`on: created: Workspace`) reads it there. Only
   *  when it is made. */
  note?: unknown;
  /** A repository its person's token can't read is left out, not refused
   *  (the default workspace, from what a forge said it reaches). */
  skipRefused?: boolean;
}

/**
 * Make a workspace, or change which repositories it holds, as the run's
 * person. Each repository put in is asked for at its remote as that
 * person, so only one their own token reads goes in; a refusal changes
 * nothing. One new to the box becomes a Repository node. One taken out of
 * its last workspace leaves the box. A workspace keeps one repository at
 * least: emptying it is deleting it.
 */
export async function changeWorkspace(ctx: Ctx, change: Change) {
  const name = workspaceName(change.name);
  const put = [...new Map((change.repositories ?? []).map((u) => address(u)).map((a) => [a.url, a])).values()];
  const out = [...new Set((change.remove ?? []).map((u) => address(u).url))];
  if (put.length > MOST) throw new Error(`at most ${MOST} repositories go in a workspace at once`);
  const both = put.filter((a) => out.includes(a.url));
  if (both.length) throw new Error(`${both[0]!.url} is both put in and taken out: say one`);
  const note = noteOf(change.note);

  const list = await readList(ctx);
  const space = list.workspaces.find((w) => w.name === name);
  if (space && change.create) throw new Error(`there is a workspace ${name} already: pick another name, or add to it`);
  if (space && note) throw new Error(`${name} is made already: additional information goes on a workspace when it is made`);
  if (!space && out.length) throw new Error(`there is no workspace ${name} to take repositories out of`);
  if (!space && !put.length) throw new Error(`a workspace holds one repository at least: name one to make ${name} with`);
  const holds = new Set(space?.repositories ?? []);
  const adding = put.filter((a) => !holds.has(a.url));
  const removing = out.filter((u) => holds.has(u));
  const unknown = out.filter((u) => !holds.has(u));
  if (unknown.length) throw new Error(`${unknown[0]} is not in ${name}`);
  if (space && holds.size + adding.length - removing.length < 1) throw new Error(`${name} would hold no repository: delete it instead, in the Code app`);

  // Every remote first, as the run's person: a refusal changes nothing.
  const answers = await askAll(ctx, adding.map((a) => a.url));
  const skipped: Array<{ url: string; problem: string }> = [];
  const asked: Array<{ a: Address; remote: Remote }> = [];
  for (const [i, a] of adding.entries()) {
    const answer = answers[i]!;
    if (!(answer instanceof Error)) asked.push({ a, remote: answer });
    else if (change.skipRefused) skipped.push({ url: a.url, problem: answer.message });
    else throw answer;
  }
  if (!space && !asked.length) throw new Error(`${name} would hold no repository: ${skipped.map((s) => s.problem).join("; ")}`);

  // The workspace, then each repository new to the box, then the links.
  let ref = space?.ref_id;
  const created = !space;
  if (!ref) {
    // The note in the node's first write: `on: created: Workspace` reads it there.
    const made = await graph<Written>(ctx, "create-node", { node_type: WORKSPACE, node_data: { name, ...(note ? { note } : {}) } });
    if (made.status === "Warning") {
      const other = list.workspaces.find((w) => w.ref_id === made.ref_id);
      throw new Error(`"${name}" can't be a workspace beside "${other?.name ?? "another"}": strut's graph keys the two names alike`);
    }
    ref = made.ref_id;
    // One deleted before comes back as new: without 0.6's `main`, and with
    // this Set up's note, not the last one's.
    if (made.messages?.some((m) => /restored/i.test(m))) {
      await graph(ctx, "edit-node", { ref_id: ref, properties_to_be_deleted: note ? ["main"] : ["main", "note"] }).catch(() => undefined);
      if (note) await graph(ctx, "edit-node", { ref_id: ref, node_data: { note } });
    }
  }
  const already = space ? holds : await membersOf(ctx, ref, list.repositories);
  const fresh: string[] = [];
  for (const { a, remote } of asked) {
    let repo = list.repositories.find((r) => r.url === a.url);
    if (!repo) {
      repo = await newRepository(ctx, a, remote, list);
      list.repositories.push(repo);
      fresh.push(a.url);
    }
    if (!already.has(a.url)) await link(ctx, ref, repo.ref_id);
  }
  const wanted = new Set([...holds, ...asked.map((x) => x.a.url)]);
  for (const u of removing) wanted.delete(u);
  // A workspace restored from a soft delete keeps only what was asked for.
  const stale = space ? removing : [...already].filter((u) => !wanted.has(u));
  const self: Space = space ?? { ref_id: ref, name, repositories: [...already] };
  const left = await takeOut(ctx, list, self, stale);

  const nameOf = new Map(list.repositories.map((r) => [r.url, r.name]));
  const sorted = (urls: Iterable<string>) => [...urls].sort((a, b) => (nameOf.get(a) ?? a).localeCompare(nameOf.get(b) ?? b) || a.localeCompare(b));
  return {
    workspace: name,
    created,
    repositories: sorted(wanted),
    added: sorted(asked.map((x) => x.a.url).filter((u) => !holds.has(u))),
    removed: sorted(removing),
    new: sorted(fresh),
    left: sorted(left),
    ...(skipped.length ? { skipped } : {}),
  };
}

/** Rename a workspace in place: the node keeps its ref_id, so what other
 *  packages keep on it (pods' `.pod/`) stays with it. Its page, when it has
 *  one, takes the new name too. */
export async function renameWorkspace(ctx: Ctx, from: unknown, to: unknown) {
  const old = workspaceName(from);
  const name = workspaceName(to);
  const list = await readList(ctx);
  const space = list.workspaces.find((w) => w.name === old);
  if (!space) throw new Error(`there is no workspace ${old}`);
  if (old === name) return { workspace: name, renamed: false };
  if (list.workspaces.some((w) => w.name === name)) throw new Error(`there is a workspace ${name} already`);
  try {
    await graph(ctx, "edit-node", { ref_id: space.ref_id, node_data: { name } });
  } catch (e) {
    throw new Error(`${old} can't be renamed ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let page: string | undefined;
  if (space.page) {
    // Its page follows it; one that can't (that name is a page already) stays, and says so.
    page = await graph(ctx, "edit-node", { ref_id: space.page.ref_id, node_data: { name: pageName(name) } })
      .then(() => pageName(name))
      .catch((e: unknown) => {
        throw new Error(`${old} is ${name} now, but its page is still "${space.page!.name}": ${e instanceof Error ? e.message : String(e)}`);
      });
  }
  return { workspace: name, renamed: true, from: old, ...(page ? { page } : {}) };
}

/** Delete a workspace: its page first, then its links, then the node, and
 *  each repository it was the last workspace of. What other packages keep
 *  on the node (pods' `.pod/`) goes with it, by strut's rule. */
export async function deleteWorkspace(ctx: Ctx, raw: unknown) {
  const name = workspaceName(raw);
  const list = await readList(ctx);
  const space = list.workspaces.find((w) => w.name === name);
  if (!space) throw new Error(`there is no workspace ${name}`);
  // The page first: a refusal leaves the workspace and its page as they were.
  if (space.page) await graph(ctx, "delete-node", { ref_id: space.page.ref_id, reason: `its workspace, ${name}, was deleted` });
  const left = await takeOut(ctx, list, space, space.repositories);
  await graph(ctx, "delete-node", { ref_id: space.ref_id, reason: "deleted in the Code app" });
  return { deleted: name, left };
}

/** The default workspace the Code app suggests: only while the box has
 *  no workspace, from what the viewer's forges reach. */
export function suggestion(list: List, reached: Reached): { name: string; repositories: string[] } | undefined {
  return list.workspaces.length ? undefined : defaultWorkspace(reached.repositories);
}

/**
 * Set up the suggested default workspace, as the person who pressed Set up
 * (the owner's rule: "default waits for Set up"). Worked out again from
 * what their own forges reach now, so it is theirs; a repository whose
 * remote refuses them is left out. Refused once the box has a workspace:
 * another is made with New workspace. `note` is Set up's "Additional
 * information", written on the workspace as it is made.
 */
export async function setUpDefault(ctx: Ctx, note?: unknown) {
  const kept = noteOf(note);
  const list = await readList(ctx);
  if (list.workspaces.length) throw new Error("the box has a workspace already: make another with New workspace");
  const reached = await reach(ctx);
  const choice = defaultWorkspace(reached.repositories);
  if (!choice) {
    const why = reached.problem ?? reached.hosts.map((h) => (h.problem ? `${h.host}: ${h.problem}` : "")).filter(Boolean).join("; ");
    throw new Error(`your accounts reach no repository to set up${why ? ` (${why})` : ""}: make a workspace by address with New workspace`);
  }
  const made = await changeWorkspace(ctx, { name: choice.name, repositories: choice.repositories, create: true, skipRefused: true, note: kept });
  return { workspace: made.workspace, repositories: made.repositories, ...(made.skipped ? { skipped: made.skipped } : {}) };
}

/** `check`'s pass: ask every remote, record a moved head (and branch), say
 *  why one failed, and name the repositories whose head is not ingested.
 *  A workspace still carrying 0.6's `main` has it cleared. */
export async function checkHeads(ctx: Ctx) {
  const list = await readList(ctx);
  for (const w of list.workspaces.filter((s) => s.oldMain)) {
    await graph(ctx, "edit-node", { ref_id: w.ref_id, properties_to_be_deleted: ["main"] }).catch(() => undefined);
  }
  const at = now();
  const moved: string[] = [];
  const ingest: string[] = [];
  const problems: Array<{ url: string; problem: string }> = [];
  const answers = await askAll(ctx, list.repositories.map((r) => r.url));
  for (const [i, repo] of list.repositories.entries()) {
    const remote = answers[i]!;
    if (remote instanceof Error) {
      problems.push({ url: repo.url, problem: remote.message });
      // A repository removed while this ran has no node to write to.
      await graph(ctx, "edit-node", { ref_id: repo.ref_id, node_data: { checked: at, problem: remote.message } }).catch(() => undefined);
      continue;
    }
    const data: Record<string, string> = { checked: at };
    if (remote.head !== repo.head) {
      data["head"] = remote.head;
      moved.push(repo.url);
    }
    if (remote.branch !== repo.branch) data["branch"] = remote.branch;
    await graph(ctx, "edit-node", { ref_id: repo.ref_id, node_data: data, ...(repo.problem ? { properties_to_be_deleted: ["problem"] } : {}) }).catch(() => undefined);
    if (remote.head !== repo.ingested) ingest.push(repo.url);
  }
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
