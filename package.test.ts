/**
 * stadeum/code on a strut server, the way it runs on a box: installed from
 * this directory (`file:`) into a strut started in this process from a
 * checkout of stakwork/strut's main (`STRUT_DIR`, default `../strut`, with
 * its install), on a LadybugDB file. Then driven as the Code app's page
 * drives it (an admin's call and a member's), as the schedule runs `check`,
 * and as the job agent calls `repositories`. A job of the kind `Code Change`
 * is launched too, to see its turn open with the package's page: the model
 * is stood in for by an `agent` step that records what the turn gave it.
 *
 * It reaches github.com: the repositories it adds are public ones (this
 * package's own repository and stadeum/pods'), and a missing one stands in
 * for a private one, which GitHub answers the same way.
 *
 *   STRUT_DIR=../strut npm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { address, remoteProblem, workspaceName, workspaceNames } from "./steps/_code.ts";

const STRUT = resolve(process.env["STRUT_DIR"] ?? "../strut");
const from = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(STRUT, "src", path)).href)) as T;

const HERE = resolve(".");
const CODE = "https://github.com/stakwork/strut-code";
const PODS = "https://github.com/stakwork/strut-pods";
const MISSING = "https://github.com/stakwork/strut-code-no-such-repository-7f3a";
const APP = "stadeum/code/code";
const HEX = /^[0-9a-f]{40}$/;
const PAGE = "Code Change";

/** Another package, whose app an admin may open, granting this package's
 *  steps and its `add` workflow: it must change nothing. */
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

  it("says plainly why a remote refused", () => {
    assert.match(remoteProblem(CODE, "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"), /private, or there is no repository there.*public repositories only/);
    assert.match(remoteProblem(CODE, "remote: HTTP Basic: Access denied\nfatal: Authentication failed"), /asks for a sign-in/);
    assert.match(remoteProblem(CODE, "fatal: repository 'x' not found"), /there is no repository at/);
    assert.match(remoteProblem(CODE, "fatal: unable to access 'x': Could not resolve host: nowhere.invalid"), /can't be reached/);
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
  /** The page's text as its file holds it, front matter left out. */
  const pageText = async () => (await readFile(join(HERE, "concepts", `${PAGE}.md`), "utf8")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const repo = async (url: string) => (await list()).repositories.find((r) => r.url === url);
  const space = async (name: string) => (await list()).workspaces.find((w) => w.name === name);

  before(async () => {
    delete process.env["STRUT_API_KEY"];
    root = await mkdtemp(join(tmpdir(), "strut-code-test-"));
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
    registerModelWrapper((model: object) => {
      const handed = async (options: { prompt: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> }) => {
        const text = (c: unknown) => (typeof c === "string" ? c : (c as Array<{ text?: string }>).map((p) => p.text ?? "").join(""));
        turns.push({
          system: options.prompt.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n"),
          prompt: text(options.prompt.find((m) => m.role === "user")?.content ?? ""),
          tools: (options.tools ?? []).map((t) => t.name),
        });
        throw new Error("stand-in model: the turn is recorded");
      };
      return new Proxy(model, { get: (m, k) => (k === "doGenerate" || k === "doStream" ? handed : Reflect.get(m, k, m)) });
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
    });
    // Installed by a person, as a box's admin does: they own its workflows,
    // so its schedule runs as them.
    const install = async (dir: string) => {
      const res = await strut.app.request("/packages/install", {
        method: "POST",
        headers: { "content-type": "application/json", "x-strut-actor": "root" },
        body: JSON.stringify({ ref: `file:${dir}` }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
    };
    await install(HERE);
    const other = join(root, "acme-other");
    for (const [rel, text] of Object.entries(OTHER)) {
      await mkdir(dirname(join(other, rel)), { recursive: true });
      await writeFile(join(other, rel), text);
    }
    await install(other);
    for (const app of [APP, OTHER_APP]) versions[app] = (await strut.apps.manifestOf(app)).version;
  });
  after(async () => {
    await strut?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("installs whole: its types, app, workflows, the job's tool and the schedule", async () => {
    const { packages } = await (await strut.app.request("/packages")).json();
    const pkg = packages.find((p: any) => p.package === "stadeum/code");
    assert.ok(pkg, "installed");
    assert.equal(pkg.version, "0.2.0");
    const job = await strut.workspace.getWorkflow("job");
    assert.ok(job.params.tools.includes("stadeum/code/repositories"), "the job agent is granted the tool");
    const { automations } = await (await strut.app.request("/automations")).json();
    const check = automations.find((a: any) => a.package === "stadeum/code");
    assert.ok(check, "check's schedule is installed");
    assert.equal(check.workflow, "stadeum/code/check");
    assert.equal(check.trigger.every, "interval");
    assert.equal(check.trigger.minutes, 15);
    assert.equal(check.enabled ?? true, true, "on");
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

  it("answers the job agent's tool with the list, and no admin flag", async () => {
    const out = await once("tool", "stadeum/code/repositories", {}, "ada");
    assert.equal(out.admin, undefined);
    assert.deepEqual(out.workspaces.map((w: any) => w.name), ["stadeum", "strut-code"]);
    assert.deepEqual(out.repositories.map((r: any) => r.url), [CODE, PODS]);
  });

  it("removes a repository from every workspace, and a workspace left empty goes", async () => {
    const one = await admin()("stadeum/code/remove", { url: PODS });
    assert.equal(one.error, undefined, one.error);
    assert.deepEqual(one.result, { removed: PODS, left: ["strut-code"], deleted: ["stadeum"] });
    assert.deepEqual(await space("strut-code"), { name: "strut-code", main: CODE, repositories: [CODE] }, "its main moved to the one left");
    const two = await admin()("stadeum/code/remove", { url: CODE });
    assert.deepEqual(two.result.deleted, ["strut-code"]);
    assert.deepEqual(await list(), { repositories: [], workspaces: [], admin: true });
    // Added again, it starts over as new: its own workspace, ingested once more.
    assert.equal((await add(admin(), CODE)).status, "success");
    const back = await repo(CODE);
    assert.deepEqual(back.workspaces, ["strut-code"]);
    assert.equal(back.ingested, back.head);
  });

  it("goes with the package: the Code Change page, its place under Job and the job's tool", async () => {
    const res = await strut.app.request("/packages/stadeum/code", { method: "DELETE", headers: { "x-strut-actor": "root" } });
    assert.equal(res.status, 200, await res.text());
    const job = await once("job-kinds-after", "graph/graph-get", { node_type: "Concept", name: "Job", children: "PARENT_OF" });
    assert.equal(job.children.find((c: any) => c.name === PAGE), undefined, "no longer a kind");
    const gone = await once("code-change-page-after", "graph/graph-get", { node_type: "Concept", name: PAGE });
    assert.match(String(gone), /node not found: Concept "Code Change"/);
    assert.ok(!(await strut.workspace.getWorkflow("job")).params.tools.includes("stadeum/code/repositories"));
  });
});
