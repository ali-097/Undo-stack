import * as vscode from "vscode";
import { Storage } from "./storage";
import { Session, FileChange } from "./types";
import * as path from "path";
import * as Diff from "diff";
import * as fs from "fs";
import { execFile } from "child_process";

export class SessionManager {
  private session: Session | null = null;
  private sessions: Session[] = [];

  constructor(private storage: Storage) {
    this.loadPersistedSessions();
  }

  isActive() {
    return this.session !== null;
  }

  startSession() {
    this.session = {
      id: Date.now().toString(),
      startedAt: Date.now(),
      changes: [],
      createdFiles: [],
      deletedFiles: [],
      baseline: {},
    };

    // Snapshot open text documents as pre-session baseline
    try {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme !== "file") continue;
        try {
          const content = doc.getText();
          const snap = this.storage.writeSnapshot(
            this.session.id,
            doc.uri.toString(),
            content,
          );
          this.session.baseline![doc.uri.toString()] = snap;
        } catch {
          // ignore per-file failures
        }
      }
    } catch {
      // ignore
    }

    this.sessions.unshift(this.session);
    this.storage.writeSessionMetadata(this.session.id, this.session);

    vscode.window.showInformationMessage("Session Started");
  }

  async trackChange(doc: vscode.TextDocument) {
    if (!this.session) return;

    const uriStr = doc.uri.toString();

    // Always write an 'after' snapshot for the current state
    const afterContent = doc.getText();
    const afterPath = this.storage.writeSnapshot(
      this.session.id,
      uriStr,
      afterContent,
    );

    let change = this.session.changes.find((c) => c.uri === uriStr);
    if (!change) {
      // Determine before snapshot: prefer baseline, then disk content, else empty
      let beforePath = this.session.baseline
        ? this.session.baseline[uriStr]
        : undefined;

      if (!beforePath) {
        try {
          if (doc.uri.scheme === "file" && fs.existsSync(doc.uri.fsPath)) {
            const disk = fs.readFileSync(doc.uri.fsPath, "utf-8");
            beforePath = this.storage.writeSnapshot(
              this.session.id,
              uriStr,
              disk,
            );
          }
        } catch {
          // ignore
        }
      }

      if (!beforePath) {
        beforePath = this.storage.writeSnapshot(this.session.id, uriStr, "");
      }

      change = { uri: uriStr, beforePath, afterPath };
      this.session.changes.push(change);
    } else {
      change.afterPath = afterPath;
    }

    this.storage.writeSessionMetadata(this.session.id, this.session);
  }

  trackCreatedFile(uri: vscode.Uri) {
    if (!this.session) return;
    if (!this.session.createdFiles.includes(uri.toString())) {
      this.session.createdFiles.push(uri.toString());
      this.storage.writeSessionMetadata(this.session.id, this.session);
    }
  }

  trackDeletedFile(uri: vscode.Uri) {
    if (!this.session) return;
    try {
      const content = fs.readFileSync(uri.fsPath, "utf-8");
      const backupPath = this.storage.writeSnapshot(
        this.session.id,
        uri.toString(),
        content,
      );
      this.session.deletedFiles.push({ uri: uri.toString(), backupPath });
      this.storage.writeSessionMetadata(this.session.id, this.session);
    } catch (err) {
      // ignore if file not readable
    }
  }

  async undoSession() {
    if (!this.session) return;

    await this.undoPersistedSession(this.session.id);
    this.session = null;
  }

  async undoPersistedSession(sessionId: string) {
    const s = this.sessions.find((x) => x.id === sessionId);
    if (!s) return;

    const config = vscode.workspace.getConfiguration("session");

    // If Git mode enabled and we have a prev head, try using git (read-only) to restore file contents.
    const workspaceRoot = vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

    if (config.get("useGit") && s.gitPrevHead && workspaceRoot) {
      for (const change of s.changes.slice().reverse()) {
        try {
          const uri = vscode.Uri.parse(change.uri);
          const fsPath = uri.fsPath;
          // compute repo-relative path
          const rel = path.relative(workspaceRoot, fsPath).replace(/\\/g, "/");
          if (rel.startsWith("..")) continue; // file outside repo

          const content = await this.runGitShow(s.gitPrevHead, rel);
          if (content !== null) {
            // write file content read from git commit
            this.storage.ensureDir(path.dirname(fsPath));
            fs.writeFileSync(fsPath, content, "utf-8");
            continue; // move to next change
          }
        } catch (err) {
          // ignore and fallback to snapshot restore below
        }
      }
      // continue to perform snapshot-based restores for any remaining files
    }

    // Restore modified files using diff hunks (best-effort), fallback to full replace when necessary
    for (const change of s.changes.slice().reverse()) {
      try {
        const uri = vscode.Uri.parse(change.uri);

        // Read initial content
        const initial = this.storage.readSnapshot(change.beforePath);

        // Read current content from workspace or disk
        let doc: vscode.TextDocument | undefined;
        try {
          doc = await vscode.workspace.openTextDocument(uri);
        } catch {
          // not in workspace, will use disk read
        }

        const current = doc
          ? doc.getText()
          : fs.existsSync(uri.fsPath)
            ? fs.readFileSync(uri.fsPath, "utf-8")
            : "";

        // Try to apply structured patch; if anything goes wrong, fall back to full replace
        let applied = false;
        try {
          const patch = Diff.structuredPatch(
            change.uri,
            change.uri,
            initial,
            current,
            "",
            "",
          );
          if (patch && patch.hunks && patch.hunks.length > 0) {
            const edit = new vscode.WorkspaceEdit();

            for (const hunk of patch.hunks) {
              const newStart = Math.max(0, hunk.newStart - 1); // zero-based
              const newLines = hunk.newLines;

              const oldStart = Math.max(0, hunk.oldStart - 1);
              const oldLines = hunk.oldLines;

              const eol = initial.indexOf("\r\n") !== -1 ? "\r\n" : "\n";
              const allLines = initial.split(/\r?\n/);
              const oldLinesArr = allLines.slice(oldStart, oldStart + oldLines);
              const oldText = oldLinesArr.join(eol);

              // Determine start and end positions in the current document
              let startPos: vscode.Position;
              let endPos: vscode.Position;

              if (doc) {
                startPos = new vscode.Position(newStart, 0);
                const endLine = Math.max(0, newStart + newLines - 1);
                const line = doc.lineAt(Math.min(endLine, doc.lineCount - 1));
                endPos = line.range.end;
              } else {
                // open the document to compute ranges
                const opened = await vscode.workspace.openTextDocument(uri);
                startPos = new vscode.Position(newStart, 0);
                const endLine = Math.max(0, newStart + newLines - 1);
                const line = opened.lineAt(
                  Math.min(endLine, opened.lineCount - 1),
                );
                endPos = line.range.end;
                doc = opened;
              }

              const range = new vscode.Range(startPos, endPos);
              edit.replace(uri, range, oldText);
            }

            const ok = await vscode.workspace.applyEdit(edit);
            applied = ok;

            // Verify that the resulting document matches the original snapshot exactly.
            // If it doesn't, fall back to a full-file replace to ensure trailing newline
            // and EOLs are preserved (fixes missing trailing whitespace lines).
            if (applied) {
              try {
                const verifyDoc = await vscode.workspace.openTextDocument(uri);
                const verifyText = verifyDoc.getText();
                if (verifyText !== initial) {
                  const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    verifyDoc.lineAt(Math.max(0, verifyDoc.lineCount - 1)).range
                      .end,
                  );
                  const fullEdit = new vscode.WorkspaceEdit();
                  fullEdit.replace(uri, fullRange, initial);
                  const ok2 = await vscode.workspace.applyEdit(fullEdit);
                  applied = ok2;
                }
              } catch {
                // verification failed, will fall back below
              }
            }
          }
        } catch (err) {
          // patch failed; will fallback to full replace below
          applied = false;
        }

        if (!applied) {
          // Full-file replace fallback
          try {
            if (doc) {
              const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                doc.lineAt(Math.max(0, doc.lineCount - 1)).range.end,
              );
              const edit = new vscode.WorkspaceEdit();
              edit.replace(uri, fullRange, initial);
              await vscode.workspace.applyEdit(edit);
            } else {
              // write file to disk
              this.storage.ensureDir(path.dirname(uri.fsPath));
              fs.writeFileSync(uri.fsPath, initial, "utf-8");
            }
          } catch (err) {
            console.error("Full replace failed for", change.uri, err);
          }
        }
      } catch (err) {
        // best-effort per file
        console.error("Undo file failed", err);
      }
    }

    // Delete newly created files
    for (const created of s.createdFiles) {
      try {
        const uri = vscode.Uri.parse(created);
        await vscode.workspace.fs.delete(uri);
      } catch (err) {
        // ignore
      }
    }

    // Recreate deleted files from backups
    for (const del of s.deletedFiles) {
      try {
        const uri = vscode.Uri.parse(del.uri);
        const content = this.storage.readSnapshot(del.backupPath);
        this.storage.ensureDir(path.dirname(uri.fsPath));
        fs.writeFileSync(uri.fsPath, content, "utf-8");
      } catch (err) {
        // ignore
      }
    }

    // Save any open editors modified by the undo operations so users
    // don't have to manually save each file after undoing.
    try {
      await vscode.workspace.saveAll(false);
    } catch {
      // ignore save failures
    }

    vscode.window.showInformationMessage(`Session ${sessionId} undone`);

    // Remove session metadata (cleanup)
    try {
      const sessionDir = path.join(this.storage.sessionsPath, sessionId);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    // Remove from in-memory list
    this.sessions = this.sessions.filter((x) => x.id !== sessionId);
  }

  endSession() {
    if (!this.session) return;

    // Optionally capture Git head
    const config = vscode.workspace.getConfiguration("session");
    if (config.get("useGit")) {
      this.runGitSafeArgs(["rev-parse", "--verify", "HEAD"]).then((head) => {
        if (head) {
          this.session!.gitPrevHead = head.trim();
          this.storage.writeSessionMetadata(this.session!.id, this.session);
        }
      });
    }

    this.storage.writeSessionMetadata(this.session.id, this.session);
    vscode.window.showInformationMessage("Session saved");
    this.session = null;
  }

  private loadPersistedSessions() {
    try {
      const ids = this.storage.listSessions();
      for (const id of ids) {
        const data = this.storage.readSessionMetadata(id);
        if (data) this.sessions.push(data);
      }
    } catch (err) {
      // ignore
    }
  }

  getSessions() {
    return this.sessions;
  }

  getActiveSession() {
    return this.session;
  }

  deleteSession(sessionId: string) {
    this.sessions = this.sessions.filter((x) => x.id !== sessionId);
    try {
      const sessionDir = path.join(this.storage.sessionsPath, sessionId);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  private runGitSafeArgs(args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      const cwd = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : undefined;
      execFile("git", args, { cwd }, (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout ? stdout.toString() : null);
      });
    });
  }

  private runGitShow(commit: string, relPath: string): Promise<string | null> {
    return this.runGitSafeArgs(["show", `${commit}:${relPath}`]);
  }
}
