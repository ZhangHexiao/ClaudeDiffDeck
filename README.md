# Claude Review

> One-click review of every file change Claude Code makes in the terminal.

A VSCode extension that shows file modifications made by Claude Code (running in a terminal) in a side panel, grouped by file, with per-file explanations, risk markings, diffs, and confirm/reject buttons. Each batch also shows the user prompt that initiated the turn, so you can trace why Claude made the changes.

## How it works

1. Install the extension's `Stop` hook into your project's `.claude/settings.json` via the command **Claude Review: 安装 Hook / Install Hook**.
2. Run `claude` in a VSCode integrated terminal as usual.
3. When Claude finishes a turn, the hook script parses the transcript, collects all `Edit`/`Write`/`MultiEdit` calls, and writes a batch JSON to `.claude/pending-review/`.
4. The extension watches that folder and displays each batch in the sidebar webview.
5. Click **Confirm** / **Reject** to mark items as reviewed. (MVP: marking only — files are not modified.)

## Build

```bash
npm install
npm run build
```

Press **F5** to launch an Extension Development Host, or `npm run package` to produce a `.vsix`.

## Verification

1. Open any git repo in the dev host.
2. Click the Claude Review icon in the activity bar.
3. Run command **Claude Review: Install Hook**.
4. In the integrated terminal run `claude` and ask it to edit a file.
5. When Claude finishes, a card appears in the side panel.

## Configuration

- `claudeReview.riskyGlobs`: additional glob patterns to mark as high risk.
- `claudeReview.largeDeletionThreshold`: line count above which a file is high risk (default 50).

## Tips

- The panel opens on the right (Secondary Side Bar) by default on first activation. You can move it back with right-click → "Move View".
- Use the command **Claude Review: Move to Right Sidebar** to re-dock the panel to the right at any time.
