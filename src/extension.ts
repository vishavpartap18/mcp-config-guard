import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  checkWrongFile,
  checkSchema,
  mergeServersIntoCorrectConfig,
  stripServersFromWrongFile,
  parseConfig,
  type WrongConfigFile,
} from "./validator";

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const WRONG_FILES: { file: WrongConfigFile; fullPath: string }[] = [
  { file: "settings.json", fullPath: path.join(CLAUDE_DIR, "settings.json") },
  { file: "mcp.json", fullPath: path.join(CLAUDE_DIR, "mcp.json") },
];
const CORRECT_FILE = path.join(HOME, ".claude.json");

let diagnostics: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function rangeForLocation(loc: { line: number; col: number }, keyLength: number): vscode.Range {
  const start = new vscode.Position(loc.line, loc.col);
  const end = new vscode.Position(loc.line, loc.col + keyLength);
  return new vscode.Range(start, end);
}

/** The core check, re-run on activation, on demand, and on every relevant file save. */
function runCheck(): { wrongFileCount: number; schemaIssueCount: number } {
  diagnostics.clear();
  let wrongFileCount = 0;
  let schemaIssueCount = 0;

  for (const { file, fullPath } of WRONG_FILES) {
    const raw = readIfExists(fullPath);
    if (raw === null) continue;
    const finding = checkWrongFile(file, raw);
    if (!finding) continue;
    wrongFileCount += finding.serverNames.length;
    const range = rangeForLocation(finding.location, finding.serverNames.length ? 12 : 1);
    const names = finding.serverNames.join(", ");
    const diag = new vscode.Diagnostic(
      range,
      `MCP Config Guard: ${finding.serverNames.length} server(s) defined here (${names}) will NEVER load — ` +
        `Claude Code only reads ~/.claude.json for MCP servers, not ~/.claude/${file}. ` +
        `Run "MCP Config Guard: Move MCP Servers to the File Claude Code Actually Reads" to fix this.`,
      vscode.DiagnosticSeverity.Error,
    );
    diag.source = "MCP Config Guard";
    diag.code = "wrong-config-file";
    diagnostics.set(vscode.Uri.file(fullPath), [diag]);
  }

  const correctRaw = readIfExists(CORRECT_FILE);
  if (correctRaw !== null) {
    const issues = checkSchema(correctRaw);
    schemaIssueCount += issues.length;
    if (issues.length > 0) {
      const diags = issues.map((issue) => {
        const range = rangeForLocation(issue.location, issue.serverName.length);
        const message =
          issue.kind === "MISSING_COMMAND"
            ? `MCP server "${issue.serverName}" has no "command" field — Claude Code cannot launch it.`
            : issue.kind === "INVALID_ARGS"
              ? `MCP server "${issue.serverName}"'s "args" must be an array of strings.`
              : `MCP server "${issue.serverName}"'s "env" must be an object.`;
        const d = new vscode.Diagnostic(range, `MCP Config Guard: ${message}`, vscode.DiagnosticSeverity.Warning);
        d.source = "MCP Config Guard";
        d.code = "schema-issue";
        return d;
      });
      diagnostics.set(vscode.Uri.file(CORRECT_FILE), diags);
    }
  }

  return { wrongFileCount, schemaIssueCount };
}

async function fixWrongFiles(): Promise<void> {
  let totalMoved = 0;
  let totalSkipped = 0;
  const touchedFiles: string[] = [];

  for (const { file, fullPath } of WRONG_FILES) {
    const raw = readIfExists(fullPath);
    if (raw === null) continue;
    const finding = checkWrongFile(file, raw);
    if (!finding) continue;

    const { json } = parseConfig(raw);
    const servers = (json?.mcpServers ?? json?.servers) as Record<string, unknown> | undefined;
    if (!servers) continue;

    const correctRaw = readIfExists(CORRECT_FILE) ?? "{}";
    const { merged, movedNames, skippedNames } = mergeServersIntoCorrectConfig(correctRaw, servers);

    fs.writeFileSync(CORRECT_FILE, merged, "utf8");
    const stripped = stripServersFromWrongFile(raw);
    fs.writeFileSync(fullPath, stripped, "utf8");

    totalMoved += movedNames.length;
    totalSkipped += skippedNames.length;
    if (movedNames.length > 0 || skippedNames.length > 0) touchedFiles.push(file);
  }

  if (totalMoved === 0 && totalSkipped === 0) {
    vscode.window.showInformationMessage("MCP Config Guard: nothing to fix — no misplaced servers found.");
    return;
  }

  const skippedNote = totalSkipped > 0 ? ` ${totalSkipped} skipped (name already exists in ~/.claude.json — resolve manually).` : "";
  vscode.window.showInformationMessage(
    `MCP Config Guard: moved ${totalMoved} server(s) to ~/.claude.json.${skippedNote} Restart Claude Code to pick them up.`,
  );
  outputChannel.appendLine(`Fixed: moved ${totalMoved}, skipped ${totalSkipped}, touched files: ${touchedFiles.join(", ")}`);
  runCheck();
}

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection("mcpConfigGuard");
  outputChannel = vscode.window.createOutputChannel("MCP Config Guard");
  context.subscriptions.push(diagnostics, outputChannel);

  const checkCommand = vscode.commands.registerCommand("mcpConfigGuard.checkNow", () => {
    const { wrongFileCount, schemaIssueCount } = runCheck();
    if (wrongFileCount === 0 && schemaIssueCount === 0) {
      vscode.window.showInformationMessage("MCP Config Guard: your Claude Code MCP config looks correct.");
    } else {
      vscode.window.showWarningMessage(
        `MCP Config Guard: found ${wrongFileCount} server(s) in the wrong file and ${schemaIssueCount} schema issue(s). See Problems panel.`,
      );
    }
  });
  const fixCommand = vscode.commands.registerCommand("mcpConfigGuard.fixFile", fixWrongFiles);
  context.subscriptions.push(checkCommand, fixCommand);

  // Re-check whenever any of the watched files change, so diagnostics stay live.
  const watchedGlobs = [CORRECT_FILE, ...WRONG_FILES.map((w) => w.fullPath)];
  for (const p of watchedGlobs) {
    const watcher = fs.existsSync(path.dirname(p))
      ? vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(p)), path.basename(p)))
      : null;
    if (watcher) {
      watcher.onDidChange(() => runCheck());
      watcher.onDidCreate(() => runCheck());
      watcher.onDidDelete(() => runCheck());
      context.subscriptions.push(watcher);
    }
  }

  runCheck();
}

export function deactivate() {
  diagnostics?.dispose();
}
