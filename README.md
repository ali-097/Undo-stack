# UndoStack

Restore your workspace to a previous editing session — start a session, review changes, and safely undo edits.

UndoStack records explicit editing sessions by snapshotting file contents. Use the Sessions view to inspect changes, open diffs for every changed file, and restore files using a patch-first undo (with a reliable full-file fallback when needed).

Features

- Record explicit sessions (Start / End)
- Preview diffs for all files in a session
- Apply undo with patch-first then full-file fallback to preserve whitespace and EOLs
- Optional read-only Git assistance to restore files from a recorded commit
- Snapshot deduplication to minimize storage

Quick start

1. Start a session: run **Session: Start Session** (or use the status bar action).
2. Edit files as usual; UndoStack snapshots the changed files.
3. End the session: run **Session: End Session (Keep Changes)** to persist the session.
4. Preview a session: open the **Sessions** view and select a session to open diffs for each changed file.
5. Undo a session: from the preview choose **Apply**, or run **Session: Undo Session** and confirm.

Commands

- `Session: Start Session` — begin a new session
- `Session: End Session (Keep Changes)` — end the current session and persist snapshots
- `Session: Undo Session` — preview or apply undo for the current session

Configuration

- `session.useGit` (boolean) — if enabled, UndoStack will attempt read-only restores from Git for files inside the repository.

Privacy & data

All snapshots are stored locally using VS Code's global storage for this extension. No data is sent to external services.

Support

Report issues and feature requests at: https://github.com/ali-097/Undo-stack/issues

License

This extension is licensed under the MIT License. See `LICENSE` for details.

Changelog

See `CHANGELOG.md` for release notes.
