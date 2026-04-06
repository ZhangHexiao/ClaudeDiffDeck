# Changelog

## 1.0.0 — 2026-04-06

### Added

- **Change Review Panel** — Sidebar webview that displays Claude Code's file modifications as diff cards
  - Risk badges (HIGH / MED / LOW) with built-in + custom glob patterns
  - AI-extracted explanations from Claude's responses
  - User prompt tracking per turn
  - Confirm / Reject workflow (reject opens VS Code diff editor)
- **Stop Hook** — Automatic detection of Claude Code edits via the `Stop` hook
  - Parses transcript to extract Edit / Write / MultiEdit operations
  - Reconstructs before/after content for accurate diffs
  - Atomic JSON output to `.claude/pending-review/`
- **Git Workflow Buttons**
  - **Start** — Create a branch from `main` + draft PR from a plain-language description
  - **Save to Remote** — Auto-commit with smart directory-based splitting + push
  - **Re-request Review** — Push, mark PR ready, or re-request previous reviewers
- **Activity History** — All workflow actions logged in the same timeline as change reviews
- **Install Hook** command — One-click hook setup per project
- **Auto-dock** to right sidebar on first activation
