import { z, defineStep } from "strut";
import { asCtx, recent } from "./_code.js";

export default defineStep({
  type: "stadeum/code/recent",
  description:
    "The workspaces you most likely mean, for strut's Recent Work: { items: [{ name, what (whose: you chatted about it, or on this server; then its repositories as host/owner/name), at? (your newest chat about it) }] }, " +
    "the ones you chatted about first, newest day first, then the rest by name. stadeum/code/repositories for every workspace and repository in full.",
  effect: "read",
  input: z.object({}),
  output: z.object({
    items: z.array(z.object({ name: z.string(), what: z.string().optional(), at: z.string().optional() })),
  }),
  async run(_cfg, ctx) {
    return recent(asCtx(ctx));
  },
});
