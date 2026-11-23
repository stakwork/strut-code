/**
 * What the Code app is opened with. Another app may send a person here
 * with a repository's address (`appLink("stadeum/code/code", { add:
 * "<https address>" })`): the app opens New workspace with it filled in.
 * A plain function, so the package's test reads it as the page does.
 */

/**
 * The address to fill New workspace's address field with: the input's
 * `add`, trimmed, when the viewer may make workspaces and it is an https
 * address; otherwise none, and the app is as it would be with no input. It
 * only fills the field: nothing is made until the person presses Create,
 * and `workspace` checks the address then exactly as one typed there
 * (steps/_code.ts `address`).
 */
export function addressToAdd(input: Record<string, unknown> | undefined, may: boolean): string | undefined {
  if (!may) return undefined;
  const raw = input?.["add"];
  const given = typeof raw === "string" ? raw.trim() : "";
  if (!given) return undefined;
  try {
    return new URL(given).protocol === "https:" ? given : undefined;
  } catch {
    return undefined;
  }
}
