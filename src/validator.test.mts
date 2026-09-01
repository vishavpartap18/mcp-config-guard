// Standalone smoke test — no test framework, just asserts + exit code.
// Run with: npx tsx src/validator.test.mts
import assert from "node:assert";
import {
  checkWrongFile,
  checkSchema,
  mergeServersIntoCorrectConfig,
  stripServersFromWrongFile,
} from "./validator";

// 1. The exact documented bug: servers in settings.json, never read.
{
  const settingsJson = JSON.stringify(
    {
      theme: "dark",
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    },
    null,
    2,
  );
  const finding = checkWrongFile("settings.json", settingsJson);
  assert(finding, "should detect servers in settings.json");
  assert.deepStrictEqual(finding!.serverNames, ["github"]);
  console.log("PASS: detects wrong-file servers in settings.json");
}

// 2. A settings.json with no mcpServers key at all should NOT false-positive.
{
  const settingsJson = JSON.stringify({ theme: "dark" }, null, 2);
  const finding = checkWrongFile("settings.json", settingsJson);
  assert.strictEqual(finding, null, "should not flag a file with no servers");
  console.log("PASS: no false positive on a clean settings.json");
}

// 3. Schema check: missing "command" field.
{
  const claudeJson = JSON.stringify(
    {
      mcpServers: {
        broken: { args: ["-y", "something"] },
        fine: { command: "npx", args: ["-y", "ok"] },
      },
    },
    null,
    2,
  );
  const issues = checkSchema(claudeJson);
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].kind, "MISSING_COMMAND");
  assert.strictEqual(issues[0].serverName, "broken");
  console.log("PASS: flags missing command, leaves valid entries alone");
}

// 4. Merge: moves servers into an existing ~/.claude.json without clobbering.
{
  const existing = JSON.stringify({ mcpServers: { keep: { command: "already-here" } } }, null, 2);
  const toMove = { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] } };
  const { merged, movedNames, skippedNames } = mergeServersIntoCorrectConfig(existing, toMove);
  assert.deepStrictEqual(movedNames, ["github"]);
  assert.deepStrictEqual(skippedNames, []);
  const parsed = JSON.parse(merged);
  assert.strictEqual(parsed.mcpServers.keep.command, "already-here");
  assert.strictEqual(parsed.mcpServers.github.command, "npx");
  console.log("PASS: merges into existing ~/.claude.json without clobbering");
}

// 5. Merge: a name collision is skipped, never silently overwritten.
{
  const existing = JSON.stringify({ mcpServers: { github: { command: "the-real-one" } } }, null, 2);
  const toMove = { github: { command: "duplicate-should-not-win" } };
  const { movedNames, skippedNames } = mergeServersIntoCorrectConfig(existing, toMove);
  assert.deepStrictEqual(movedNames, []);
  assert.deepStrictEqual(skippedNames, ["github"]);
  console.log("PASS: name collision is skipped, not clobbered");
}

// 6. Strip: removes mcpServers from the wrong file, keeps everything else.
{
  const settingsJson = JSON.stringify({ theme: "dark", mcpServers: { x: { command: "y" } } }, null, 2);
  const stripped = stripServersFromWrongFile(settingsJson);
  const parsed = JSON.parse(stripped);
  assert.strictEqual(parsed.theme, "dark");
  assert.strictEqual(parsed.mcpServers, undefined);
  console.log("PASS: strips mcpServers, keeps unrelated settings");
}

console.log("\nAll validator smoke tests passed.");
