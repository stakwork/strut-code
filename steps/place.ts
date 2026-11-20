import { z, defineStep } from "strut";
import { asCtx, placeRepository, requireAdmin } from "./_code.js";

export default defineStep({
  type: "stadeum/code/place",
  description:
    "Put a repository in exactly these workspaces (an admin's, from the Code app). A name no workspace has makes one, with this repository as its main; " +
    "a workspace it leaves takes its next repository as main, and one left empty goes.",
  effect: "write",
  input: z.object({
    url: z.string().describe("The repository's url, as the list holds it"),
    workspaces: z.array(z.string()).min(1).describe("Every workspace it is to be in: lowercase names, such as hive"),
  }),
  output: z.any(),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    return placeRepository(c, cfg.url, cfg.workspaces);
  },
});
