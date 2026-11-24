/**
 * A workspace's files: what packages keep on its node (strut's files on a
 * node, stakwork/strut#851, `plans/package-seams.md` §1), such as the setup
 * whatever sets workspaces up keeps there (pods' `.pod/`: its Dockerfile,
 * compose file and scripts). The Code app reads them with strut's
 * `node/files`: `list: true` for every package's folder on the node, then
 * one folder at one version. It names no package and writes nothing.
 *
 * A folder whose newest version is empty keeps nothing now (pods writes one
 * over a workspace made again with a deleted one's name), so it isn't
 * shown, nor is any other empty version. A strut without the seam refuses
 * the call (an app's page may call only what its grants name, and a strut
 * without `node/files` has none to call): no folders, and no link.
 *
 * Plain functions, so the package's test reads them as the page does.
 */
import type { Run } from "./chat";

/** Strut's step that reads the files kept on a node. */
export const NODE_FILES = "node/files";

/** One kept version of a package's folder on a node. */
export interface Version {
  version: number;
  at: string;
  bytes: number;
  paths: string[];
  note?: string;
}
/** A package's folder on a node: its versions with files, newest first. */
export interface Folder {
  package: string;
  versions: Version[];
}
/** What a look found: the folders (none is an empty list), or a strut that can't say. */
export type Folders = { folders: Folder[] } | { unsupported: string };

/** A file as `node/files` gives it: its text, or its bytes in base64. */
export type Content = string | { base64: string };
/** One folder at one version, read. */
export interface Read {
  package: string;
  version: number;
  at: string;
  note?: string;
  files: Record<string, Content>;
}

/** Every package's folder on the node `ref_id` that keeps files now, by package. */
export async function foldersOn(run: Run, ref_id: string): Promise<Folders> {
  let out: unknown;
  try {
    out = await run(NODE_FILES, { ref_id, list: true });
  } catch (e) {
    return { unsupported: e instanceof Error ? e.message : String(e) };
  }
  const rows = (out as { versions?: unknown } | undefined)?.versions;
  if (!Array.isArray(rows)) return { unsupported: "strut's node/files answered no versions" };
  const by = new Map<string, Version[]>();
  for (const raw of rows) {
    const row = (raw ?? {}) as Partial<Version> & { package?: unknown };
    if (typeof row.package !== "string" || typeof row.version !== "number" || !Array.isArray(row.paths)) continue;
    const v: Version = { version: row.version, at: typeof row.at === "string" ? row.at : "", bytes: typeof row.bytes === "number" ? row.bytes : 0, paths: row.paths.filter((p): p is string => typeof p === "string"), ...(typeof row.note === "string" && row.note ? { note: row.note } : {}) };
    by.set(row.package, [...(by.get(row.package) ?? []), v]);
  }
  const folders: Folder[] = [];
  for (const [pkg, versions] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    const newest = versions.sort((a, b) => b.version - a.version);
    if (!newest[0]?.paths.length) continue;
    folders.push({ package: pkg, versions: newest.filter((v) => v.paths.length) });
  }
  return { folders };
}

/** A package's folder on the node at a version (the newest unless named). Throws what strut refused. */
export async function readFolder(run: Run, ref_id: string, pkg: string, version?: number): Promise<Read> {
  const out = (await run(NODE_FILES, { ref_id, package: pkg, ...(version !== undefined ? { version } : {}) })) as Partial<Read> & { version?: number | null };
  if (typeof out?.version !== "number" || !out.files || typeof out.files !== "object") throw new Error(`${pkg} keeps no files on it${version !== undefined ? ` at version ${version}` : ""}`);
  return { package: pkg, version: out.version, at: out.at ?? "", ...(out.note ? { note: out.note } : {}), files: out.files };
}

/** A file to show: its text, or how many bytes it has when it isn't text. */
export function shown(content: Content | undefined): { text: string } | { bytes: number } {
  if (typeof content === "string") return { text: content };
  const b64 = content?.base64 ?? "";
  return { bytes: Math.max(0, Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0)) };
}

/** A folder's paths in the order they are listed: top-level files first, then each folder's. */
export function ordered(paths: string[]): string[] {
  const depth = (p: string) => p.split("/").length;
  return [...paths].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}
