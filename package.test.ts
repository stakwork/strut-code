/**
 * stadeum/code on a strut server, the way it runs on a box: installed from
 * this directory (`file:`) into a strut started in this process from a
 * checkout of stakwork/strut's main (`STRUT_DIR`, default `../strut`, with
 * its install), on a LadybugDB file. Then driven as the Code app's page
 * drives it (an admin's call and a member's), as the schedule runs `check`,
 * and as the job agent calls `repositories`. A job of the kind `Code Change`
 * is launched too, to see its turn open with the package's page: the model
 * is stood in for through strut's hook on every model it builds, recording
 * what each turn gave it. For a small change it is scripted (strut's own
 * mock model): it checks the repository out, edits it and pushes a new
 * branch with strut's `git/push`, as the job's person, and is refused the
 * default branch.
 *
 * It reaches github.com: the public repositories it adds are this package's
 * own and stadeum/pods', and a missing one is refused as a private one is,
 * which GitHub answers the same way with no token. A PRIVATE repository is
 * served from this machine over http behind a token (strut's
 * `test-util/git-remote.ts`), and its https address is pointed there by
 * git's `insteadOf` in the shell strut is given: the token lookup and git's
 * credential helper both see the same host, `127.0.0.1:<port>`. Another
 * package stands in for a forge's, serving that host with `LAB_TOKEN`
 * (`provides.git`), and each person's token is their own secret. No one's real token is read: GITHUB_TOKEN is unset here.
 *
 *   STRUT_DIR=../strut npm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { address, askRemote, remoteProblem, workspaceName, workspaceNames } from "./steps/_code.ts";
import { addressToAdd } from "./apps/code/src/input.ts";

const STRUT = resolve(process.env["STRUT_DIR"] ?? "../strut");
// Nobody's token: not this machine's, not its git's. github.com is read with none.
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "LAB_TOKEN", "STRUT_GIT_LOCAL"]) delete process.env[k];
const from = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(STRUT, "src", path)).href)) as T;

const HERE = resolve(".");
const CODE = "https://github.com/stakwork/strut-code";
const PODS = "https://github.com/stakwork/strut-pods";
const MISSING = "https://github.com/stakwork/strut-code-no-such-repository-7f3a";
const APP = "stadeum/code/code";
const HEX = /^[0-9a-f]{40}$/;
const PAGE = "Code Change";

/** Another package, whose app an admin may open, granting this package's
 *  steps and its `add` workflow: it must change nothing. It also stands in
 *  for a forge's package, serving the private repositories' host. */
const OTHER_APP = "acme/other/console";
const OTHER: Record<string, string> = {
  "strut.yaml": "package: acme/other\nversion: 0.1.0\n",
  "apps/console/app.yaml": [
    "title: Console",
    "grants:",
    "  workflows: [stadeum/code/add]",
    "  steps: [stadeum/code/repositories, stadeum/code/remove, stadeum/code/place, stadeum/code/main]",
    "",
  ].join("\n"),
  "apps/console/src/App.tsx": "export default function App() { return <p>console</p>; }\n",
};

/** The private repositories' token, and one their host refuses. */
const TOKEN = `lab-${randomBytes(12).toString("hex")}`;
const WRONG = `wrong-${randomBytes(12).toString("hex")}`;

/** git on this machine with none of its own config: for the test's remotes. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    },
  }).trim();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("an address", () => {
  it("is written one way, so the same repository typed twice is one address", () => {
    for (const typed of [CODE, `${CODE}/`, `${CODE}.git`, `${CODE}.git/`, "  HTTPS://GitHub.com/stakwork/strut-code  ", "https://github.com//stakwork/strut-code"]) {
      assert.equal(address(typed).url, CODE, typed);
    }
    assert.deepEqual(address("https://gitlab.example.com:8443/group/sub/app.git"), {
      url: "https://gitlab.example.com:8443/group/sub/app",
      host: "gitlab.example.com:8443",
      owner: "group/sub",
      name: "app",
    });
  });

  it("is refused before anything runs when it is not an https address of a repository", () => {
    const refused: Array<[string, RegExp]> = [
      ["", /its https URL/],
      ["git@github.com:stakwork/strut-code.git", /an ssh address/],
      ["ssh://git@github.com/stakwork/strut-code", /an ssh address/],
      ["http://github.com/stakwork/strut-code", /only an https address/],
      ["file:///etc/passwd", /only an https address/],
      ["--upload-pack=touch /tmp/x", /not an address/],
      ["https://user:token@github.com/stakwork/strut-code", /no user name or token/],
      ["https://github.com/stakwork/strut-code?x=1", /no \? or # part/],
      ["https://github.com/stakwork", /owner and its name/],
      ["https://github.com/stakwork/strut code", /is not a part/],
      ["https://github.com/stakwork/$(touch x)", /is not a part/],
      ["https://github.com/stakwork/..", /owner and its name|is not a part/],
      ["https://github.com/-x/strut-code", /is not a part/],
      [`https://github.com/${"a".repeat(300)}/b`, /over 300/],
    ];
    for (const [typed, why] of refused) assert.throws(() => address(typed), why, typed);
  });

  it("names a repository's own workspace after it, then after its owner, then numbered", () => {
    assert.deepEqual(workspaceNames(address("https://github.com/Stakwork/Hive")).slice(0, 3), ["hive", "stakwork-hive", "hive-2"]);
    assert.equal(workspaceNames(address("https://example.com/a/X.Y_")).at(0), "x.y");
    assert.equal(workspaceName(" Hive "), "hive");
    assert.throws(() => workspaceName("my workspace"), /not a workspace's name/);
    assert.throws(() => workspaceName("-x"), /not a workspace's name/);
  });

  it("says from strut's error what a person can act on, and whose access is missing", () => {
    const url = "https://git.example.test/team/app";
    const denied = `remote_denied: ${url} asks for a credential — it is private, or there is no repository there — and this run has no token for its host`;
    assert.equal(
      remoteProblem(url, denied, { you: true }),
      `${url} asks for a sign-in: it is private, or there is no repository there, and you have no access to it: you have not connected an account for git.example.test, or that account cannot read it. Connect one that can, then add it again.`,
    );
    assert.equal(
      remoteProblem(url, `remote_denied: ${url} refused the run's token for git.example.test: it cannot read this repository, or there is none there`, { who: "Ada (ada)", scheduled: true }),
      `${url} asks for a sign-in: it is private, or there is no repository there, and Ada (ada), whom the check runs as (its workflow's owner), has no access to it: Ada (ada) has not connected an account for git.example.test, or that account cannot read it. Either Ada (ada) connects one that can, or an admin gives the check workflow an owner whose account can.`,
    );
    assert.match(remoteProblem(url, denied, { who: "ada" }), /and ada has no access to it: ada has not connected an account for git\.example\.test, or that account cannot read it\.$/);
    assert.equal(remoteProblem(url, `remote_not_found: no repository at ${url}`, { you: true }), `there is no repository at ${url} that you can see`);
    assert.equal(remoteProblem(url, `remote_not_found: no repository at ${url}`, { who: "ada", scheduled: true }), `there is no repository at ${url} that ada, whom the check runs as (its workflow's owner), can see`);
    assert.equal(remoteProblem(url, `remote_unreachable: ${url} did not answer in 30 s`), `${url} can't be reached: did not answer in 30 s`);
    assert.equal(remoteProblem(url, `remote_unreachable: ${url}: fatal: unable to access: Could not resolve host`), `${url} can't be reached: fatal: unable to access: Could not resolve host`);
    assert.equal(remoteProblem(url, `remote_empty: ${url} has no commits yet: its remote names no head`), `${url} has no commits yet: its remote names no head`);
  });

  it("fills the Code app's Add field from the address it is opened with, for an admin alone, and adds nothing", async () => {
    // The link another app opens it with (stadeum/github's picker), read back
    // as a host reads it: `?input=` as flat strings, the app's tool input.
    const { appLink } = (await import(pathToFileURL(join(STRUT, "kit", "src", "links.ts")).href)) as { appLink: (name: string, input?: Record<string, string>) => string };
    const opened = (input: Record<string, string>) => Object.fromEntries(new URLSearchParams(new URLSearchParams(appLink(APP, input).slice(1)).get("input") ?? ""));
    assert.equal(addressToAdd(opened({ add: CODE }), true), CODE);
    assert.equal(addressToAdd({ add: `  ${CODE}.git\n` }, true), `${CODE}.git`, "trimmed, otherwise as given");
    // A member's app draws no Add, and the input changes nothing.
    assert.equal(addressToAdd(opened({ add: CODE }), false), undefined);
    // Only an https address fills it: anything else leaves the app as it is.
    for (const input of [undefined, {}, { view: CODE }, { add: "" }, { add: "   " }, { add: 42 }, { add: [CODE] }, { add: "strut-code" }, { add: "git@github.com:stakwork/strut-code.git" }, { add: "ssh://git@github.com/stakwork/strut-code" }, { add: "http://github.com/stakwork/strut-code" }, { add: "file:///etc/passwd" }, { add: "javascript:alert(1)" }]) {
      assert.equal(addressToAdd(input, true), undefined, JSON.stringify(input));
    }
    // Filled as given: Add checks it then exactly as one typed (`add` runs `address`).
    for (const [given, why] of [
      ["https://user:token@github.com/stakwork/strut-code", /no user name or token/],
      ["https://github.com/stakwork/strut-code?x=1", /no \? or # part/],
      ["https://github.com/stakwork", /owner and its name/],
    ] as const) {
      assert.equal(addressToAdd({ add: given }, true), given);
      assert.throws(() => address(addressToAdd({ add: given }, true)), why, given);
    }
  });

  it("says plainly what an older strut lacks: the step it asks a remote with", async () => {
    await assert.rejects(askRemote({ registry: {} }, CODE), /strut's git\/remote-head step, and this strut server has none: it needs a newer strut \(the step came with stakwork\/strut#798/);
  });
});

describe("stadeum/code on strut", { timeout: 300_000 }, () => {
  let root = "";
  // Strut's own types, loose: this test reads them from a checkout.
  let strut: any;
  let tools: any;
  let appIdentity: (name: string, version: string) => string;
  let STEP_RUN: string;
  const versions: Record<string, string> = {};
  let store: any;
  /** What the job agent's model was handed on each turn: the system prompt,
   *  the turn's prompt and its tools' names. */
  const turns: Array<{ prompt: string; system: string; tools: string[] }> = [];
  /** The model's answers for the next job's run, when it is scripted
   *  (strut's mock model); otherwise the turn ends once it is recorded. */
  let script: unknown[] | undefined;

  /** A call from an app's page (the Code app's unless named), as its viewer: `admin` when strut says so. */
  const page = (actor: string, admin: boolean, app = APP) => {
    const t = tools.buildAppTools({ apps: strut.apps, registry: strut.getRegistry(), services: strut.services, actor, admin, runStepDeps: { store, workspace: strut.workspace } });
    return async (type: string, config: Record<string, unknown> = {}): Promise<{ error?: string; result?: any }> =>
      t[STEP_RUN].execute({ type, config, app: appIdentity(app, versions[app]!) }, { toolCallId: "t", messages: [] });
  };
  const admin = () => page("root", true);
  const member = () => page("ada", false);
  /** The page's Add: launch the `add` workflow, then wait for its end. */
  const add = async (call: ReturnType<typeof page>, url: string) => {
    const launched = await call("run/launch", { workflow: "stadeum/code/add", input: { url } });
    assert.equal(launched.error, undefined, launched.error);
    const run = await call("run/get", { workflow: "stadeum/code/add", runId: launched.result.runId, wait: 50_000 });
    assert.equal(run.error, undefined, run.error);
    return run.result as { status: string; output?: any; error?: { message: string } };
  };
  const list = async () => {
    const r = await admin()("stadeum/code/repositories");
    assert.equal(r.error, undefined, r.error);
    return r.result as { repositories: any[]; workspaces: any[]; admin: boolean };
  };
  /** Run one step as a workflow of its own would: no page, no app. */
  const once = async (name: string, step: string, config: Record<string, unknown>, actor = "root") => {
    await strut.workspace.publishWorkflowByContent(`test/${name}`, `steps:\n  - id: s\n    type: ${step}\n    config: ${JSON.stringify(config)}\n`);
    const run = await strut.run(`test/${name}`, {}, { actor, principal: actor });
    assert.equal(run.status, "success", JSON.stringify(run.error));
    return run.output.s ?? run.output;
  };
  /** A page's text as its file holds it, front matter left out. */
  const pageText = async (name = PAGE) => (await readFile(join(HERE, "concepts", `${name}.md`), "utf8")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const repo = async (url: string) => (await list()).repositories.find((r) => r.url === url);
  const space = async (name: string) => (await list()).workspaces.find((w) => w.name === name);
  /** A Concept page by name, or why there is none. */
  const concept = (name: string) => once(`concept-${randomBytes(4).toString("hex")}`, "graph/graph-get", { node_type: "Concept", name });
  /** A page under `Codebase`, as stadeum/pods writes a workspace's at the
   *  bake (and the dream, later, a repository's). Its ref_id. */
  const bake = async (name: string) => {
    const made = await once(`bake-${name}`, "graph/create-node", {
      node_type: "Concept",
      node_data: { name, description: `The ${name}: its systems and how they connect.`, docs: "```mermaid\nflowchart LR\n  app -->|API_URL| api\n```\n" },
    });
    const root = await concept("Codebase");
    await once(`bake-${name}-under`, "graph/create-triplet", { source_ref_id: root.ref_id, target_ref_id: made.ref_id, edge_type: "PARENT_OF" });
    return made.ref_id as string;
  };

  /** The private repositories: bare ones served behind TOKEN, their https
   *  addresses, and a working copy that pushes a new commit to them. */
  let priv: { url: string; host: string; seen: Array<{ path: string; password?: string }>; close(): Promise<void> };
  let SECRET = "";
  let OTHER_SECRET = "";
  let work = "";
  const pushCommit = (message: string) => {
    git(work, "commit", "--quiet", "--allow-empty", "-m", message);
    for (const name of ["secret", "other"]) git(work, "push", "--quiet", join(root, "remotes", "team", name), "trunk");
    return git(work, "rev-parse", "HEAD");
  };
  /** A person's own secret, as the connect seam writes it. */
  const ownSecret = async (actor: string, name: string, value: string) => {
    const res = await strut.app.request(`/actors/${actor}/secrets/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
    assert.equal(res.status < 300, true, await res.text());
  };
  /** The check workflow's owner: whom its schedule runs as. */
  const giveCheckTo = async (owner: string) => {
    const res = await strut.app.request(`/workflows/${encodeURIComponent("stadeum/code/check")}/owner`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }) });
    assert.equal(res.status, 200, await res.text());
  };
  /** "Run now" on check's schedule: the scheduler's own fire, as the
   *  workflow's owner. Then its run's summary, once it is over. */
  const fireCheck = async () => {
    const { automations } = await (await strut.app.request("/automations")).json();
    const schedule = automations.find((a: any) => a.package === "stadeum/code");
    const res = await strut.app.request(`/workflows/${encodeURIComponent("stadeum/code/check")}/automations/${encodeURIComponent(schedule.id)}/fire`, { method: "POST" });
    const body = await res.json();
    assert.equal(res.status, 202, JSON.stringify(body));
    const runId = body.runId ?? body.result?.runId;
    for (let i = 0; i < 1200; i++) {
      const summary = await store.getRunSummary("stadeum/code/check", runId);
      if (summary && summary.status !== "waiting") return summary;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`check's run ${runId} did not end`);
  };

  before(async () => {
    delete process.env["STRUT_API_KEY"];
    root = await mkdtemp(join(tmpdir(), "strut-code-test-"));
    // Two private repositories on this machine, on `trunk`, behind TOKEN.
    const { serveGit, insteadOf } = await from<any>("test-util/git-remote.ts");
    await mkdir(join(root, "remotes", "team"), { recursive: true });
    for (const name of ["secret", "other"]) git(join(root, "remotes"), "init", "--quiet", "--bare", "--initial-branch=trunk", join("team", name));
    work = join(root, "work");
    git(root, "init", "--quiet", "--initial-branch=trunk", work);
    pushCommit("first");
    priv = await serveGit(join(root, "remotes"), { token: TOKEN });
    SECRET = `https://${priv.host}/team/secret`;
    OTHER_SECRET = `https://${priv.host}/team/other`;
    store = new (await from<any>("store.ts")).MemoryRunStore();
    const { createStrut } = await from<any>("createStrut.ts");
    const { openGraphBackend } = await from<any>("graph/backend.ts");
    const { PRIVATE_NAMESPACE } = await from<any>("graph/ladybug/namespaces.ts");
    const { GraphWorkspaceStore } = await from<any>("graph/workspace-store.ts");
    const { kitForTests } = await from<any>("test-util/app-kit.ts");
    tools = await from<any>("apps/tools.ts");
    STEP_RUN = tools.STEP_RUN_TOOL;
    appIdentity = (await from<any>("auth.ts")).appIdentity;
    const graph = await openGraphBackend({ kind: "ladybug", path: join(root, "graph.lbug"), namespace: PRIVATE_NAMESPACE }, { embeddings: false });
    // The job agent's model, stood in for through strut's hook on every
    // model it builds: the call records what the model was handed, and
    // ends the turn there. A key that is no one's, so nothing reaches a
    // provider even if the stand-in were skipped.
    process.env["ANTHROPIC_API_KEY"] = "stand-in";
    delete process.env["ANTHROPIC_BASE_URL"];
    const { registerModelWrapper } = await from<any>("extensions.ts");
    const { mockModel } = await from<any>("privacy/testing/mock-model.ts");
    registerModelWrapper((model: object) => {
      const scripted = script ? mockModel({ turns: script }) : undefined;
      const handed = (k: "doGenerate" | "doStream") => async (options: { prompt: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> }) => {
        const text = (c: unknown) => (typeof c === "string" ? c : (c as Array<{ text?: string }>).map((p) => p.text ?? "").join(""));
        turns.push({
          system: options.prompt.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n"),
          prompt: text(options.prompt.find((m) => m.role === "user")?.content ?? ""),
          tools: (options.tools ?? []).map((t) => t.name),
        });
        if (scripted) return scripted[k](options);
        throw new Error("stand-in model: the turn is recorded");
      };
      return new Proxy(scripted ?? model, { get: (m, k) => (k === "doGenerate" || k === "doStream" ? handed(k) : Reflect.get(m, k, m)) });
    });
    strut = await createStrut({
      workspace: new GraphWorkspaceStore(graph, { materializeDir: join(root, "steps"), appsDir: join(root, "apps") }),
      dataDir: root,
      store,
      kit: await kitForTests(),
      serveUi: false,
      enableChat: false,
      autoResume: false,
      orchestrator: false,
      builder: false,
      systemWorkflows: false,
      browserWorkflows: false,
      privacyWorkflows: false,
      mediaWorkflows: false,
      views: false,
      // Strut's own pages, `Job` among them, which this package's page goes under.
      concepts: { personal: false, claims: false },
      stt: false,
      jamie: false,
      earnings: false,
      staff: false,
      worker: false,
      // A server: git gets no credential of this machine's, only the run's.
      git: { local: false },
      // The private repositories' https addresses, read from this machine
      // over http: the token's host and git's are one, 127.0.0.1:<port>.
      services: { shell: insteadOf({ [`https://${priv.host}/`]: `${priv.url}/` }) },
    });
    // Installed by a person, as a box's admin does with the deployment key
    // and their actor: they own its workflows, so its schedule runs as them.
    // Strut trusts `x-strut-actor` only beside its key, which is set for
    // the install alone.
    const install = async (dir: string) => {
      const key = `key-${randomBytes(8).toString("hex")}`;
      process.env["STRUT_API_KEY"] = key;
      try {
        const res = await strut.app.request("/packages/install", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-strut-actor": "root" },
          body: JSON.stringify({ ref: `file:${dir}` }),
        });
        const body = await res.json();
        assert.equal(res.status, 201, JSON.stringify(body));
      } finally {
        delete process.env["STRUT_API_KEY"];
      }
    };
    await install(HERE);
    const other = join(root, "acme-other");
    // It serves the private repositories' host too, as a forge's package
    // (a GitLab one) would: the secret its token is (`provides.git`).
    const files = {
      ...OTHER,
      "strut.yaml": [OTHER["strut.yaml"]!.trim(), "requires:", "  optional: [LAB_TOKEN]", "provides:", "  git:", `    - { host: "${priv.host}", secret: LAB_TOKEN }`, ""].join("\n"),
    };
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(dirname(join(other, rel)), { recursive: true });
      await writeFile(join(other, rel), text);
    }
    await install(other);
    for (const app of [APP, OTHER_APP]) versions[app] = (await strut.apps.manifestOf(app)).version;
  });
  after(async () => {
    await strut?.close?.().catch(() => {});
    await priv?.close().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("installs whole: its types, app, workflows, the job's tool and the schedule", async () => {
    const { packages } = await (await strut.app.request("/packages")).json();
    const pkg = packages.find((p: any) => p.package === "stadeum/code");
    assert.ok(pkg, "installed");
    assert.equal(pkg.version, "0.5.0");
    assert.equal(pkg.requires?.binaries, undefined, "it runs no git of its own");
    const job = await strut.workspace.getWorkflow("job");
    assert.ok(job.params.tools.includes("stadeum/code/repositories"), "the job agent is granted the tool");
    assert.ok(job.params.tools.includes("git/push"), "and strut's git/push");
    assert.ok(!(job.params.approve ?? []).includes("git/push"), "which does not ask first: the pull request is the person's review");
    const { automations } = await (await strut.app.request("/automations")).json();
    const check = automations.find((a: any) => a.package === "stadeum/code");
    assert.ok(check, "check's schedule is installed");
    assert.equal(check.workflow, "stadeum/code/check");
    assert.equal(check.trigger.every, "interval");
    assert.equal(check.trigger.minutes, 15);
    assert.equal(check.enabled ?? true, true, "on");
    assert.equal(check.runsAs, "root", `it runs as the person who installed it: ${JSON.stringify(check)}`);
  });

  it("ships the Code Change page under Job, as a kind of job, its text the file's", async () => {
    const job = await once("job-kinds", "graph/graph-get", { node_type: "Concept", name: "Job", children: "PARENT_OF" });
    const kind = job.children.find((c: any) => c.name === PAGE);
    assert.ok(kind, "a kind under Job");
    assert.match(kind.description, /change the code of one of the box's repositories/);
    assert.match(kind.description, /Not a question about the code/);
    const page = await once("code-change-page", "graph/graph-get", { node_type: "Concept", name: PAGE });
    assert.equal(page.properties.docs.trim(), await pageText());
  });

  it("ships the Codebase page, a root, its text the file's", async () => {
    const root = await concept("Codebase");
    assert.equal(root.properties.docs.trim(), await pageText("Codebase"));
    assert.match(root.properties.description, /a page for each workspace that has been baked/);
  });

  it("opens a Code Change job's turn with the page, the kind listed and the repositories tool granted", async () => {
    const before = turns.length;
    const message = "Make the Add button blue.";
    const run = await strut.run("job", { prompt: message, kind: PAGE }, { job: "code-change-kind", actor: "ada", principal: "ada" });
    assert.match(JSON.stringify(run.error), /stand-in model/, "the turn reached the model");
    const turn = turns[before];
    assert.ok(turn, "the model was called");
    const { kindLead, kindEnd } = (await strut.workspace.getWorkflow("job")).params;
    // The job's line, then the kind's page, then the message (after the
    // agent's own line on its working directory).
    const head = `Your job id: code-change-kind. ${kindLead}`;
    const at = turn.prompt.indexOf(head);
    assert.ok(at >= 0, turn.prompt.slice(0, 300));
    assert.ok(turn.prompt.endsWith(`${kindEnd}${message}`), turn.prompt.slice(-200));
    const section = turn.prompt.slice(at + head.length, turn.prompt.length - kindEnd.length - message.length);
    assert.match(section, /"Code Change" Concept/);
    assert.ok(section.includes(await pageText()), "the page whole");
    // Every turn's system prompt lists the kinds under Job, this one among them.
    assert.match(turn.system, /- Code Change — A request to change the code of one of the box's repositories/);
    // The page's first call, by the name it gives it.
    assert.ok(turn.tools.includes("stadeum_code_repositories"), turn.tools.join(", "));
    assert.ok(turn.tools.includes("git_checkout"), "and strut's checkout");
    assert.ok(turn.tools.includes("git_push"), "and strut's push, the package's grant");
    assert.ok(!turn.tools.includes("github_create_pr"), "no forge's package here: no pull-request tool");
    // The deeper path sends it to the `Pod` page, another kind under Job:
    // it opens a kind's page by name, as its system prompt says.
    assert.ok(turn.tools.includes("graph_graph_get"), "it can open another page");
    assert.ok(turn.system.includes('graph_graph_get({ node_type: "Concept", name: "<name>"'), "and is told how");

    // A job of no kind opens with no page.
    const plain = await strut.run("job", { prompt: message }, { job: "code-change-none", actor: "ada", principal: "ada" });
    assert.match(JSON.stringify(plain.error), /stand-in model/);
    assert.ok(turns[before + 1]?.prompt.endsWith(`Your job id: code-change-none. ${message}`), turns[before + 1]?.prompt);
  });

  it("shows a member the list and refuses a member's changes", async () => {
    const seen = await member()("stadeum/code/repositories");
    assert.equal(seen.error, undefined, seen.error);
    assert.deepEqual(seen.result, { repositories: [], workspaces: [], admin: false });
    const run = await add(member(), CODE);
    assert.equal(run.status, "error");
    assert.match(run.error?.message ?? "", /only an admin changes the box's repositories/);
    for (const [type, config] of [
      ["stadeum/code/remove", { url: CODE }],
      ["stadeum/code/place", { url: CODE, workspaces: ["x"] }],
      ["stadeum/code/main", { workspace: "x", url: CODE }],
    ] as const) {
      assert.match((await member()(type, config)).error ?? "", /only an admin/, type);
    }
    assert.deepEqual((await list()).repositories, []);
  });

  it("adds a public repository by its address, in a workspace of its own, and ingests it once", async () => {
    const run = await add(admin(), `${CODE}.git/`);
    assert.equal(run.status, "success", JSON.stringify(run.error));
    const r = await repo(CODE);
    assert.ok(r, "listed");
    assert.equal(r.name, "strut-code");
    assert.equal(r.branch, "main");
    assert.match(r.head, HEX);
    assert.ok(Date.now() - Date.parse(r.checked) < 120_000, "checked now");
    assert.equal(r.ingested, r.head, "ingest ran once");
    assert.deepEqual(r.workspaces, ["strut-code"]);
    assert.deepEqual(await space("strut-code"), { name: "strut-code", main: CODE, repositories: [CODE] });
  });

  it("refuses an admin's change from any app but the Code app, and lists nothing changed", async () => {
    const elsewhere = () => page("root", true, OTHER_APP);
    const before = await list();
    const seen = await elsewhere()("stadeum/code/repositories");
    assert.equal(seen.error, undefined, seen.error);
    assert.equal(seen.result.admin, false, "the other app draws no admin controls");
    const refused = /the box's repositories are changed in the Code app \(stadeum\/code\/code\), not from acme\/other\/console/;
    for (const [type, config] of [
      ["stadeum/code/remove", { url: CODE }],
      ["stadeum/code/place", { url: CODE, workspaces: ["elsewhere"] }],
      ["stadeum/code/main", { workspace: "strut-code", url: CODE }],
    ] as const) {
      assert.match((await elsewhere()(type, config)).error ?? "", refused, type);
    }
    const run = await add(elsewhere(), PODS);
    assert.equal(run.status, "error");
    assert.match(run.error?.message ?? "", refused);
    assert.deepEqual(await list(), before);
  });

  it("makes one node however the same repository is typed", async () => {
    const run = await add(admin(), "HTTPS://GitHub.com/stakwork/strut-code");
    assert.equal(run.status, "success", JSON.stringify(run.error));
    const l = await list();
    assert.equal(l.repositories.filter((r) => r.url === CODE).length, 1);
    assert.equal(l.workspaces.length, 1);
  });

  it("refuses a private repository, or none, plainly, and lists nothing", async () => {
    const run = await add(admin(), MISSING);
    assert.equal(run.status, "error");
    assert.match(run.error?.message ?? "", /asks for a sign-in: it is private, or there is no repository there/);
    const ssh = await add(admin(), "git@github.com:stakwork/strut-code.git");
    assert.match(ssh.error?.message ?? "", /an ssh address/);
    assert.equal((await list()).repositories.length, 1);
  });

  it("puts a repository in a second workspace, and names a workspace's main one", async () => {
    assert.equal((await add(admin(), PODS)).status, "success");
    const placed = await admin()("stadeum/code/place", { url: PODS, workspaces: ["strut-pods", "strut-code"] });
    assert.equal(placed.error, undefined, placed.error);
    assert.deepEqual((await repo(PODS)).workspaces, ["strut-code", "strut-pods"]);
    assert.deepEqual((await space("strut-code")).repositories, [CODE, PODS], "the main one first");
    const main = await admin()("stadeum/code/main", { workspace: "strut-code", url: PODS });
    assert.equal(main.error, undefined, main.error);
    assert.deepEqual(await space("strut-code"), { name: "strut-code", main: PODS, repositories: [PODS, CODE] });
    assert.match((await admin()("stadeum/code/main", { workspace: "strut-pods", url: CODE })).error ?? "", /is not in strut-pods: put it there first/);
    // A new name makes a workspace, with it as main; one it leaves empty goes.
    const moved = await admin()("stadeum/code/place", { url: PODS, workspaces: ["strut-code", "Stadeum"] });
    assert.equal(moved.error, undefined, moved.error);
    assert.deepEqual(moved.result.deleted, ["strut-pods"]);
    assert.deepEqual(await space("stadeum"), { name: "stadeum", main: PODS, repositories: [PODS] });
    assert.equal(await space("strut-pods"), undefined);
    assert.match((await admin()("stadeum/code/place", { url: PODS, workspaces: [] })).error ?? "", /one workspace at least|too_small|at least 1/i);
  });

  it("checks each remote, records a head that moved, and ingests it", async () => {
    const before = await repo(CODE);
    // Make the graph think the remote moved since: an old head, ingested.
    const stale = "0".repeat(40);
    const found = await once("find", "graph/find", { node_type: "Repository", where: { url: CODE } });
    await once("stale", "graph/edit-node", { ref_id: found.nodes[0].ref_id, node_data: { head: stale, ingested: stale } });
    assert.equal((await repo(CODE)).head, stale);

    const run = await strut.run("stadeum/code/check", {}, { actor: "root", principal: "root" });
    assert.equal(run.status, "success", JSON.stringify(run.error));
    const after = await repo(CODE);
    assert.equal(after.head, before.head, "the remote's head, recorded");
    assert.equal(after.ingested, after.head, "and ingested");
    assert.ok(Date.parse(after.checked) >= Date.parse(before.checked));
    assert.equal(after.problem, undefined);
  });

  it("gives a baked workspace its page, the Concept `<workspace> workspace`, and none to one never baked", async () => {
    assert.equal((await space("stadeum")).page, undefined, "not baked: no page");
    // The bare name is the main repository's page, not the workspace's.
    await bake("strut-code");
    const stadeum = await bake("stadeum workspace");
    const codeSpace = await bake("strut-code workspace");
    assert.deepEqual((await space("stadeum")).page, { name: "stadeum workspace", ref_id: stadeum });
    assert.deepEqual(await space("strut-code"), { name: "strut-code", main: PODS, repositories: [PODS, CODE], page: { name: "strut-code workspace", ref_id: codeSpace } });
    // A member sees it too: the link is every person's.
    const seen = await member()("stadeum/code/repositories");
    assert.deepEqual(seen.result.workspaces.find((w: any) => w.name === "stadeum").page, { name: "stadeum workspace", ref_id: stadeum });
  });

  it("answers the job agent's tool with the list, each baked workspace's page, and no admin flag", async () => {
    const out = await once("tool", "stadeum/code/repositories", {}, "ada");
    assert.equal(out.admin, undefined);
    assert.deepEqual(out.workspaces.map((w: any) => w.name), ["stadeum", "strut-code"]);
    assert.deepEqual(out.workspaces.map((w: any) => w.page?.name), ["stadeum workspace", "strut-code workspace"]);
    assert.deepEqual(out.repositories.map((r: any) => r.url), [CODE, PODS]);
  });

  it("removes a repository from every workspace, and a workspace left empty goes, its page with it", async () => {
    const pageOf = async (name: string) => (await space(name))?.page;
    const kept = await pageOf("strut-code");
    const one = await admin()("stadeum/code/remove", { url: PODS });
    assert.equal(one.error, undefined, one.error);
    assert.deepEqual(one.result, { removed: PODS, left: ["strut-code"], deleted: ["stadeum"] });
    assert.deepEqual(await space("strut-code"), { name: "strut-code", main: CODE, repositories: [CODE], page: kept }, "its main moved to the one left, its page kept");
    assert.match(String(await concept("stadeum workspace")), /node not found: Concept "stadeum workspace"/, "the empty workspace's page went with it");
    assert.equal((await concept("strut-code workspace")).ref_id, kept!.ref_id);
    const two = await admin()("stadeum/code/remove", { url: CODE });
    assert.deepEqual(two.result.deleted, ["strut-code"]);
    assert.deepEqual(await list(), { repositories: [], workspaces: [], admin: true });
    assert.match(String(await concept("strut-code workspace")), /node not found/);
    assert.equal((await concept("strut-code")).name, "strut-code", "the repository's own page is not the workspace's");
    assert.equal((await concept("Codebase")).name, "Codebase", "and the root stays");
    // Added again, it starts over as new: its own workspace, ingested once more, with no page until it is baked again.
    assert.equal((await add(admin(), CODE)).status, "success");
    const back = await repo(CODE);
    assert.deepEqual(back.workspaces, ["strut-code"]);
    assert.equal(back.ingested, back.head);
    assert.equal((await space("strut-code")).page, undefined);
  });

  it("reads a private repository with the caller's own token for its host, and refuses it without one", async () => {
    const first = git(work, "rev-parse", "HEAD");
    // No token of the admin's own: refused, said so, and nothing listed.
    const refused = await add(admin(), SECRET);
    assert.equal(refused.status, "error");
    assert.match(
      refused.error?.message ?? "",
      new RegExp(`${esc(SECRET)} asks for a sign-in: it is private, or there is no repository there, and you have no access to it: you have not connected an account for ${esc(priv.host)}, or that account cannot read it\\. Connect one that can, then add it again\\.`),
    );
    assert.equal(await repo(SECRET), undefined);
    assert.ok(priv.seen.length > 0 && priv.seen.every((s) => s.password === undefined), "asked with no token");

    // The admin connects their account for that host: read with their token.
    await ownSecret("root", "LAB_TOKEN", TOKEN);
    const run = await add(admin(), SECRET);
    assert.equal(run.status, "success", JSON.stringify(run.error));
    const r = await repo(SECRET);
    assert.equal(r.name, "secret");
    assert.equal(r.branch, "trunk", "the remote's own default branch");
    assert.equal(r.head, first);
    assert.equal(r.ingested, first, "ingested once");
    assert.deepEqual(r.workspaces, ["secret"]);
    assert.ok(priv.seen.some((s) => s.password === TOKEN), "the token reached its own host");

    // It is the caller's own: another admin with none of their own, or one
    // the host refuses, can't add a private repository though root can.
    const bob = await add(page("bob", true), OTHER_SECRET);
    assert.equal(bob.status, "error");
    assert.match(bob.error?.message ?? "", /and you have no access to it: you have not connected an account for/);
    await ownSecret("bob", "LAB_TOKEN", WRONG);
    const wrong = await add(page("bob", true), OTHER_SECRET);
    assert.equal(wrong.status, "error");
    assert.match(wrong.error?.message ?? "", /and you have no access to it/);
    assert.ok(!(wrong.error?.message ?? "").includes(WRONG));
    assert.equal(await repo(OTHER_SECRET), undefined);
    // A public repository is read as before, whatever the caller holds.
    assert.equal((await repo(CODE))?.problem, undefined);
  });

  it("checks a private repository as the check workflow's owner, and names them in its problem when they have no access", async () => {
    // root installed the package, so the schedule runs as root, who has a token.
    const second = pushCommit("second");
    const ran = await fireCheck();
    assert.equal(ran.status, "success", JSON.stringify(ran.error));
    assert.equal(ran.principal, "root", "as the workflow's owner");
    let r = await repo(SECRET);
    assert.equal(r.head, second, "its new head, read with the owner's token");
    assert.equal(r.ingested, second, "and ingested");
    assert.equal(r.problem, undefined);

    // ada owns check now, and has connected no account for that host. An
    // admin opening the app reads ada's name in the problem, not their own.
    await giveCheckTo("ada");
    const third = pushCommit("third");
    const denied = await fireCheck();
    assert.equal(denied.status, "success", JSON.stringify(denied.error));
    assert.equal(denied.principal, "ada");
    r = await repo(SECRET);
    assert.equal(r.head, second, "not read");
    assert.equal(
      r.problem,
      `${SECRET} asks for a sign-in: it is private, or there is no repository there, and ada, whom the check runs as (its workflow's owner), has no access to it: ` +
        `ada has not connected an account for ${priv.host}, or that account cannot read it. Either ada connects one that can, or an admin gives the check workflow an owner whose account can.`,
    );
    assert.equal((await repo(CODE)).problem, undefined, "a public repository is read as before");

    // ada connects one: the next check reads it, and the problem goes.
    await ownSecret("ada", "LAB_TOKEN", TOKEN);
    const again = await fireCheck();
    assert.equal(again.status, "success", JSON.stringify(again.error));
    r = await repo(SECRET);
    assert.equal(r.head, third);
    assert.equal(r.ingested, third);
    assert.equal(r.problem, undefined);
    await giveCheckTo("root");
  });

  it("pushes a Code Change job's small change to a new branch as the job's person, and is refused the default branch", async () => {
    // A file to change on the private repository's default branch, trunk.
    const bare = join(root, "remotes", "team", "secret");
    await writeFile(join(work, "style.css"), "button { color: red; }\n");
    git(work, "add", "style.css");
    git(work, "commit", "--quiet", "-m", "style");
    git(work, "push", "--quiet", bare, "trunk");
    const trunk = git(work, "rev-parse", "HEAD");
    // ada's own token for the host, and root's one the host refuses: a push
    // that gets through carried ada's.
    await ownSecret("ada", "LAB_TOKEN", TOKEN);
    await ownSecret("root", "LAB_TOKEN", WRONG);
    const pushesBefore = priv.seen.length;
    const job = "code-change-small";
    const branch = "code-change/blue-button";
    const message = "Make the button blue";
    let path = "";
    const call = (id: string, toolName: string, input: unknown) => [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }];
    /** What a tool call of this run answered, as the model reads it back. */
    const answered = (prompt: Array<{ role: string; content: unknown }>, id: string): string => {
      for (const m of prompt) {
        if (m.role !== "tool") continue;
        for (const p of m.content as Array<{ toolCallId: string; output?: { value?: unknown } }>) {
          if (p.toolCallId === id) return typeof p.output?.value === "string" ? p.output.value : JSON.stringify(p.output?.value ?? p.output);
        }
      }
      return "";
    };
    let read: (id: string) => string = () => "";
    // The page's small path, by the tools' names on a box.
    script = [
      call("list", "stadeum_code_repositories", {}),
      (prompt: any) => {
        assert.ok(answered(prompt, "list").includes(SECRET), "the box lists it");
        return call("checkout", "git_checkout", { repo: SECRET, workdir: job });
      },
      (prompt: any) => {
        path = /"path":"([^"]+)"/.exec(answered(prompt, "checkout"))?.[1] ?? "";
        return call("edit", "bash", { command: `cd '${path}' && printf 'button { color: blue; }\\n' > style.css && git add -A` });
      },
      // The absolute path git_checkout returned: the default branch first, then a new one.
      () => call("default", "git_push", { path, branch: "trunk", message }),
      () => call("push", "git_push", { path, branch, message }),
      (prompt: any) => {
        read = (id) => answered(prompt, id);
        return call("done", "final_answer", { text: `Pushed ${branch} to ${SECRET}. This box has no tool to open the pull request.`, artifacts: [] });
      },
    ];
    const before = turns.length;
    try {
      const run = await strut.run("job", { prompt: "Make the Add button blue.", kind: PAGE }, { job, actor: "ada", principal: "ada" });
      assert.equal(run.status, "success", JSON.stringify(run.error));
    } finally {
      script = undefined;
      await ownSecret("root", "LAB_TOKEN", TOKEN);
    }
    assert.ok(turns[before]?.tools.includes("git_push"), "the turn holds strut's git/push");
    assert.ok(turns[before]!.prompt.includes(await pageText()), "and opens with the page");
    // The checkout is the job's own, at an absolute path.
    assert.equal(path, join(root, "jobs", job, "secret"));
    // The default branch is refused: trunk stays as it was (below).
    assert.match(read("default"), /push_rejected: trunk is origin's default branch — git\/push pushes a branch of its own, for a pull request/, read("default"));
    // The new branch is pushed, on trunk's head, with the change alone.
    assert.match(read("push"), new RegExp(`"branch":"${esc(branch)}"`), read("push"));
    const heads = git(bare, "for-each-ref", "--format=%(refname:short) %(objectname) %(authorname)", "refs/heads/").split("\n").sort();
    assert.equal(heads.length, 2, heads.join("\n"));
    assert.equal(heads[1], `trunk ${trunk} test`, "trunk as it was");
    assert.match(heads[0]!, new RegExp(`^${esc(branch)} [0-9a-f]{40} strut$`), "authored as strut: the token is not GitHub's");
    assert.equal(git(bare, "rev-parse", `${branch}^`), trunk);
    assert.equal(git(bare, "show", `${branch}:style.css`), "button { color: blue; }");
    assert.equal(git(bare, "diff", "--name-only", trunk, branch), "style.css");
    // As ada: the push carried her token, the only one the host takes.
    const pushes = priv.seen.slice(pushesBefore).filter((r) => r.path.includes("git-receive-pack"));
    assert.ok(pushes.length > 0, "a push reached the host");
    assert.ok(pushes.some((r) => r.password === TOKEN), "with ada's token");
    assert.ok(priv.seen.slice(pushesBefore).every((r) => r.password !== WRONG), "never root's");
  });

  it("never puts a token in a node, a run's output or an error", async () => {
    const said: string[] = [JSON.stringify(await list()), JSON.stringify(await once("repository-nodes", "graph/find", { node_type: "Repository" }))];
    for (const events of store.events.values()) said.push(JSON.stringify(events));
    for (const summary of store.summaries.values()) said.push(JSON.stringify(summary));
    const all = said.join("\n");
    assert.ok(all.includes(SECRET), "the runs and nodes read are the ones that used it");
    assert.ok(all.includes("has no access to it"), "and the refusals among them");
    for (const token of [TOKEN, WRONG]) assert.equal(all.includes(token), false, "a token is never said");
  });

  it("goes with the package: the Code Change page, its place under Job and the job's tool; Codebase stays while a page hangs under it", async () => {
    const res = await strut.app.request("/packages/stadeum/code", { method: "DELETE", headers: { "x-strut-actor": "root" } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    // A page that is not the package's (here the repository's own) is under it.
    assert.deepEqual(body.kept.filter((k: any) => k.kind === "concept"), [{ kind: "concept", name: "Codebase", reason: "strut-code hangs under it and stays, so it stays too" }]);
    assert.equal((await concept("Codebase")).name, "Codebase");
    const job = await once("job-kinds-after", "graph/graph-get", { node_type: "Concept", name: "Job", children: "PARENT_OF" });
    assert.equal(job.children.find((c: any) => c.name === PAGE), undefined, "no longer a kind");
    const gone = await once("code-change-page-after", "graph/graph-get", { node_type: "Concept", name: PAGE });
    assert.match(String(gone), /node not found: Concept "Code Change"/);
    const tools = (await strut.workspace.getWorkflow("job")).params.tools;
    assert.ok(!tools.includes("stadeum/code/repositories"));
    assert.ok(!tools.includes("git/push"), "strut's git/push goes with the grant");
  });
});
