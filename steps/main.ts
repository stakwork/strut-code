import { z, defineStep } from "strut";
import { asCtx, requireAdmin, setMain } from "./_code.js";

export default defineStep({
  type: "stadeum/code/main",
  description: "Name a workspace's main repository (an admin's, from the Code app): one of the repositories already in it.",
  effect: "write",
  input: z.object({
    workspace: z.string().describe("The workspace's name"),
    url: z.string().describe("The url of a repository in it"),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    return setMain(c, cfg.workspace, cfg.url);
  },
});
