import { z, defineStep } from "strut";
import { asCtx, deleteWorkspace, requireMaker } from "./_code.js";

export default defineStep({
  type: "stadeum/code/delete",
  description:
    "Delete a workspace (a person's, from the Code app): its page, then the workspace, and each of its repositories that is in no other workspace, which leave the box. " +
    "What other packages keep on it goes with it.",
  effect: "write",
  input: z.object({ workspace: z.string().describe("The workspace's name") }),
  output: z.object({ deleted: z.string(), left: z.array(z.string()).describe("Repositories that left the box with it") }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireMaker(c);
    return deleteWorkspace(c, cfg.workspace);
  },
});
