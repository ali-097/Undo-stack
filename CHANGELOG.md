# Changelog

## 0.1.0 - Initial release

- Initial public release: session start/end, preview diffs, undo with snapshot restore and patch-first fallback.

## 0.1.1 - 2026-04-08

- Automatically save modified files after running Undo so users don't have to save each file manually.
- Packaging: include runtime dependency `diff` in the published VSIX to avoid activation errors.
