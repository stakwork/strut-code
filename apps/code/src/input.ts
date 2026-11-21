/**
 * What the Code app is opened with. Only this app changes the box's list,
 * so another app that finds a repository sends an admin here with its
 * address (stadeum/github's picker: `appLink("stadeum/code/code", { add:
 * "<https address>" })`). A plain function, so the package's test reads it
 * as the page does.
 */

/**
 * The address to put in the Add field: the input's `add`, trimmed, when the
 * viewer is an admin and it is an https address; otherwise none, and the
 * app is as it would be with no input. It only fills the field: nothing is
 * added until the admin presses Add, and `add` checks the address then
 * exactly as one typed there (steps/_code.ts `address`).
 */
export function addressToAdd(input: Record<string, unknown> | undefined, admin: boolean): string | undefined {
  if (!admin) return undefined;
  const raw = input?.["add"];
  const given = typeof raw === "string" ? raw.trim() : "";
  if (!given) return undefined;
  try {
    return new URL(given).protocol === "https:" ? given : undefined;
  } catch {
    return undefined;
  }
}
