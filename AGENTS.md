# Working on t3-cards

- `server.mjs` is a dependency-free stdio MCP server; `widget.html` is the one page every card uses. Keep both free
  of dependencies and the page under a few hundred KB: T3 snapshots it on every call.
- A new card: add a tool with `_meta: UI`, a handler that returns `{ data, summary }`, list any large fields in
  `HEAVY`, and a renderer in `widget.html` keyed by `data.kind`. Add a line for it to `DEFAULT_INSTRUCTIONS` only if
  sessions should use it unprompted, and say exactly when.
- Never put large data in the tool result. Claude Code counts `structuredContent` toward its output limit and the
  model reads it.
- `instructions.local.md` (gitignored) overrides the default instructions on one machine. Never commit it.
- Design: colours and fonts from T3's variables, state by shape and word, 44px targets on touch
  (`deviceCapabilities.touch`), no repeating motion, honour reduced motion. Check each change at phone and desktop
  width, light and dark, in a real T3.
- `node --test test/` must pass before a commit. Running sessions keep the old server until they restart; new
  sessions read the files on disk.
