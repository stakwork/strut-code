import { z, defineStep } from "strut";
import { asCtx, changeWorkspace, MOST, requireMaker } from "./_code.js";

const url = z.string().describe("A repository's https address, such as https://github.com/acme/app");

export default defineStep({
  type: "stadeum/code/workspace",
  description:
    "Make a workspace, or put repositories in one or take them out, as the person this run is. A workspace is a set of the box's repositories worked on together: " +
    "what a pod is claimed for and set up for. Give its `name` and the `repositories` to put in, by https address: any from `stadeum_code_repositories` " +
    "(its workspaces' repositories, or what the forges `reachable` lists), or any address, public or private. Each is asked for at its remote as you, " +
    "so only one your own account reads goes in, and a refusal changes nothing. With no workspace of that name it is made; with one it gains them. " +
    "`remove` takes repositories out; one in no workspace after leaves the box. A workspace keeps one repository at least. " +
    "Making one may start its setup (the package that runs workspaces does that, as you). " +
    "Answers its `repositories`, which were `added` and `removed`, which are `new` to the box, and which `left` it.",
  effect: "write",
  input: z.object({
    name: z.string().describe("The workspace's name: lowercase letters, digits, '.', '_' and '-', such as hive"),
    repositories: z.array(url).max(MOST).optional().describe("Repositories to put in it. Making a workspace needs one at least"),
    remove: z.array(url).optional().describe("Repositories to take out of it"),
    create: z.boolean().optional().describe("Only make it: refuse when a workspace has this name already"),
  }),
  output: z.object({
    workspace: z.string(),
    created: z.boolean(),
    repositories: z.array(z.string()),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    new: z.array(z.string()).describe("Repositories that were not the box's before"),
    left: z.array(z.string()).describe("Repositories that left the box: they are in no workspace now"),
  }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireMaker(c);
    const { skipped: _none, ...out } = await changeWorkspace(c, { name: cfg.name, repositories: cfg.repositories ?? [], remove: cfg.remove ?? [], create: cfg.create === true });
    return out;
  },
});
