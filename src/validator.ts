/**
 * Pure logic, no `vscode` import — testable on its own.
 *
 * The bug this exists for (documented in anthropics/claude-code#37245 and a
 * dedicated write-up titled "wasting everyone's time"): MCP servers can be
 * defined in `~/.claude/settings.json` or `~/.claude/mcp.json` and Claude
 * Code will accept it silently — but only `~/.claude.json` is ever actually
 * read. A server defined in either wrong file simply never loads, with no
 * error anywhere.
 *
 * Scope is deliberately narrow: this checks only the two specific home-
 * directory files named in that bug report. It does NOT touch a project's
 * own `.mcp.json` at the workspace root, which is a separate, legitimately-
 * read, project-scoped config — flagging that would be a false positive.
 */

export type WrongConfigFile = "settings.json" | "mcp.json";

export interface McpServerEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  [key: string]: unknown;
}

export interface ParsedConfig {
  raw: string;
  json: Record<string, unknown> | null;
  parseError: string | null;
}

export function parseConfig(raw: string): ParsedConfig {
  if (raw.trim().length === 0) {
    return { raw, json: {}, parseError: null };
  }
  try {
    const json = JSON.parse(raw);
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      return { raw, json: null, parseError: "Top-level JSON must be an object." };
    }
    return { raw, json: json as Record<string, unknown>, parseError: null };
  } catch (e) {
    return { raw, json: null, parseError: e instanceof Error ? e.message : String(e) };
  }
}

/** Finds the 0-indexed line/column of a top-level JSON key, for diagnostics. */
export function locateKey(raw: string, key: string): { line: number; col: number } {
  const needle = `"${key}"`;
  const idx = raw.indexOf(needle);
  if (idx === -1) return { line: 0, col: 0 };
  const before = raw.slice(0, idx);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNewline = before.lastIndexOf("\n");
  const col = idx - lastNewline - 1;
  return { line, col };
}

export interface WrongFileFinding {
  kind: "WRONG_FILE";
  file: WrongConfigFile;
  serverNames: string[];
  location: { line: number; col: number };
}

export interface SchemaFinding {
  kind: "MISSING_COMMAND" | "INVALID_ARGS" | "INVALID_ENV";
  serverName: string;
  location: { line: number; col: number };
}

export type Finding = WrongFileFinding | SchemaFinding;

/**
 * Checks a `~/.claude/settings.json` or `~/.claude/mcp.json` file for MCP
 * servers that will never load because Claude Code doesn't read this file
 * for them.
 */
export function checkWrongFile(file: WrongConfigFile, raw: string): WrongFileFinding | null {
  const { json } = parseConfig(raw);
  if (!json) return null;
  const servers = json.mcpServers ?? json.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return null;
  const serverNames = Object.keys(servers as Record<string, unknown>);
  if (serverNames.length === 0) return null;
  return {
    kind: "WRONG_FILE",
    file,
    serverNames,
    location: locateKey(raw, json.mcpServers ? "mcpServers" : "servers"),
  };
}

/**
 * Checks the correct file, `~/.claude.json`, for MCP server entries missing
 * fields Claude Code needs to actually launch them. This is the part the
 * one existing adjacent extension (a management UI, not a validator) does
 * not do at all.
 */
export function checkSchema(raw: string): SchemaFinding[] {
  const { json } = parseConfig(raw);
  if (!json) return [];
  const servers = json.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
  const findings: SchemaFinding[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as McpServerEntry;
    const loc = locateKey(raw, name);
    if (typeof e.command !== "string" || e.command.trim() === "") {
      findings.push({ kind: "MISSING_COMMAND", serverName: name, location: loc });
    }
    if (e.args !== undefined && !Array.isArray(e.args)) {
      findings.push({ kind: "INVALID_ARGS", serverName: name, location: loc });
    }
    if (e.env !== undefined && (typeof e.env !== "object" || Array.isArray(e.env) || e.env === null)) {
      findings.push({ kind: "INVALID_ENV", serverName: name, location: loc });
    }
  }
  return findings;
}

/**
 * Builds the fixed `~/.claude.json` content by merging the wrongly-placed
 * servers into whatever already exists there (existing entries win on a
 * name collision — never silently overwrite a working config).
 */
export function mergeServersIntoCorrectConfig(
  correctFileRaw: string,
  serversToMove: Record<string, unknown>,
): { merged: string; movedNames: string[]; skippedNames: string[] } {
  const { json } = parseConfig(correctFileRaw || "{}");
  const base: Record<string, unknown> = json ?? {};
  const existing = (base.mcpServers as Record<string, unknown> | undefined) ?? {};
  const movedNames: string[] = [];
  const skippedNames: string[] = [];
  const nextServers: Record<string, unknown> = { ...existing };
  for (const [name, def] of Object.entries(serversToMove)) {
    if (name in existing) {
      skippedNames.push(name);
      continue;
    }
    nextServers[name] = def;
    movedNames.push(name);
  }
  base.mcpServers = nextServers;
  return { merged: JSON.stringify(base, null, 2) + "\n", movedNames, skippedNames };
}

export function stripServersFromWrongFile(raw: string): string {
  const { json } = parseConfig(raw);
  if (!json) return raw;
  delete json.mcpServers;
  delete json.servers;
  return JSON.stringify(json, null, 2) + "\n";
}
