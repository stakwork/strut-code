import { z, defineStep } from "strut";
import { asCtx, removeRepository, requireAdmin } from "./_code.js";

export default defineStep({
  type: "stadeum/code/remove",
  description: "Take a repository off the box's list (an admin's, from the Code app): out of every workspace it is in, and a workspace left empty goes.",
  effect: "write",
  input: z.object({ url: z.string().describe("The repository's url, as the list holds it") }),
  output: z.any(),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    return removeRepository(c, cfg.url);
  },
});
