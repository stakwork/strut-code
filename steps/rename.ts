import { z, defineStep } from "strut";
import { asCtx, renameWorkspace, requireMaker } from "./_code.js";

export default defineStep({
  type: "stadeum/code/rename",
  description:
    "Rename a workspace (a person's, from the Code app). It stays the same node, so what other packages keep on it stays with it; its page, once it has one, is renamed with it.",
  effect: "write",
  input: z.object({
    workspace: z.string().describe("The workspace's name now"),
    name: z.string().describe("Its new name: lowercase letters, digits, '.', '_' and '-'"),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireMaker(c);
    return renameWorkspace(c, cfg.workspace, cfg.name);
  },
});
