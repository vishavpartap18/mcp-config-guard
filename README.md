# MCP Config Guard

Catches the #1 documented cause of silent MCP server failures in Claude Code — and fixes it in one click.

## The bug

Claude Code accepts MCP server definitions in three places that *look* legitimate:

- `~/.claude/settings.json`
- `~/.claude/mcp.json`
- `~/.claude.json`

Only the last one is actually read. A server defined in either of the first two loads with **zero error, zero warning** — it just silently never runs. This has cost real developers real hours (one reported [losing two days and meaningful API spend](https://www.petegypps.uk/blog/claude-code-mcp-configuration-bug-documentation-error-november-2025) to it before finding the cause), and is tracked in [anthropics/claude-code#37245](https://github.com/anthropics/claude-code/issues/37245).

## What this does

- **Flags it immediately.** If you have MCP servers defined in the wrong file, they show up as errors in the Problems panel the moment the extension activates — you don't have to go looking.
- **Fixes it in one command.** "MCP Config Guard: Move MCP Servers to the File Claude Code Actually Reads" moves the server definitions into `~/.claude.json`, merges them safely with whatever's already there, and never overwrites an existing entry with the same name.
- **Validates the file that's actually read, too.** Beyond the wrong-file bug, it checks `~/.claude.json` entries for the fields Claude Code needs to launch a server at all (a `command` field, correctly-typed `args`/`env`) — something no other tool in this space currently does.

## Try it

1. `npm install`
2. `npm run compile`
3. Press `F5` in VS Code (Extension Development Host) to run it live, or `npx vsce package` to build a `.vsix` you can install directly.
4. Command palette → "MCP Config Guard: Check My Config"

## Scope, on purpose

This checks exactly the two files named in the documented bug above — `~/.claude/settings.json` and `~/.claude/mcp.json` — and the one file that's actually read, `~/.claude.json`. It does **not** touch a project's own `.mcp.json` at the workspace root, which is a separate, legitimately project-scoped config file.

## License

MIT
