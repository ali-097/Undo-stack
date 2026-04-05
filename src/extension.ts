import * as vscode from "vscode";
import { Storage } from "./storage";
import { SessionManager } from "./sessionManager";
import { SessionTreeProvider } from "./treeView";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  const storage = new Storage(context);
  const manager = new SessionManager(storage);
  const tree = new SessionTreeProvider(manager);

  const treeView = vscode.window.createTreeView("sessions", {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Status bar item for quick session control
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.show();
  context.subscriptions.push(statusBar);

  function updateUi() {
    const active = manager.isActive();
    vscode.commands.executeCommand("setContext", "session.active", active);
    if (active) {
      statusBar.text = "$(pulse) Session: On";
      statusBar.tooltip = "Session actions (End / Undo / View)";
      statusBar.command = "session.statusActions";
    } else {
      statusBar.text = "$(circle-slash) Session: Off";
      statusBar.tooltip = "Session actions (Start / View)";
      statusBar.command = "session.statusActions";
    }
  }
  updateUi();

  context.subscriptions.push(
    vscode.commands.registerCommand("session.start", () => {
      manager.startSession();
      tree.refresh();
      updateUi();
    }),

    vscode.commands.registerCommand("session.undo", async () => {
      await manager.undoSession();
      updateUi();
      tree.refresh();
    }),

    vscode.commands.registerCommand(
      "session.undoSessionItem",
      async (element: any) => {
        let sessionId: string | undefined;
        if (!element) return;
        if (typeof element === "string") sessionId = element;
        else if ((element as any).id) sessionId = (element as any).id;
        else if ((element as any).session && (element as any).session.id)
          sessionId = (element as any).session.id;
        if (!sessionId) return;

        const action = await vscode.window.showQuickPick(
          [
            {
              label: "Preview diffs",
              description: "Open diffs for this session",
            },
            {
              label: "Undo session",
              description: "Undo all changes from this session",
            },
            { label: "Cancel" },
          ],
          { placeHolder: "Preview or undo session" },
        );

        if (!action) return;

        if (action.label === "Preview diffs") {
          const s = manager.getSessions().find((x) => x.id === sessionId);
          if (s) {
            for (const change of s.changes) {
              try {
                const left = vscode.Uri.file(change.beforePath);
                const right = vscode.Uri.parse(change.uri);
                const title = `${path.basename(right.fsPath)} — Session ${s.id}`;
                try {
                  await vscode.commands.executeCommand(
                    "vscode.diff",
                    left,
                    right,
                    title,
                    { preview: false, preserveFocus: false },
                  );
                } catch {
                  // ignore individual diff failures
                }
              } catch {
                // ignore
              }
            }
          }

          // Non-blocking prompt to apply undo
          vscode.window
            .showInformationMessage("Diffs opened for session.", "Apply")
            .then(async (choice) => {
              if (choice === "Apply") {
                await manager.undoPersistedSession(sessionId);
                updateUi();
                tree.refresh();
              }
            });
        } else if (action.label === "Undo session") {
          const confirm = await vscode.window.showWarningMessage(
            "Undoing will overwrite workspace files. Continue?",
            { modal: true },
            "Undo",
          );
          if (confirm === "Undo") {
            await manager.undoPersistedSession(sessionId);
            updateUi();
            tree.refresh();
          }
        }
      },
    ),

    vscode.commands.registerCommand("session.end", () => {
      manager.endSession();
      tree.refresh();
      updateUi();
    }),

    // Status bar quick actions menu
    vscode.commands.registerCommand("session.statusActions", async () => {
      const active = manager.isActive();
      const items: vscode.QuickPickItem[] = active
        ? [
            {
              label: "End (Keep Changes)",
              description: "End the session and keep changes",
            },
            {
              label: "Undo Current Session",
              description: "Undo all session changes",
            },
          ]
        : [
            {
              label: "Start Session",
              description: "Start tracking a new session",
            },
          ];

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "Session actions",
      });
      if (!pick) return;

      if (pick.label === "Start Session") {
        manager.startSession();
        updateUi();
        tree.refresh();
        return;
      }

      if (pick.label === "End (Keep Changes)") {
        manager.endSession();
        updateUi();
        tree.refresh();
        return;
      }

      if (pick.label === "Undo Current Session") {
        const action = await vscode.window.showQuickPick(
          [
            {
              label: "Preview diffs",
              description: "Open diffs for this session",
            },
            {
              label: "Apply undo now",
              description: "Apply undo for entire session",
            },
            { label: "Cancel" },
          ],
          { placeHolder: "Preview or apply undo" },
        );

        if (!action) return;

        if (action.label === "Preview diffs") {
          // Preview diffs for the active session
          const s = manager.getActiveSession();
          if (s) {
            for (const change of s.changes) {
              try {
                const left = vscode.Uri.file(change.beforePath);
                const right = vscode.Uri.parse(change.uri);
                const title = `${path.basename(right.fsPath)} — Session ${s.id}`;
                try {
                  await vscode.commands.executeCommand(
                    "vscode.diff",
                    left,
                    right,
                    title,
                    { preview: false, preserveFocus: false },
                  );
                } catch {
                  // ignore individual diff failures
                }
              } catch (err) {
                // ignore
              }
            }
          }

          vscode.window
            .showInformationMessage(
              "Diffs opened for current session.",
              "Apply",
            )
            .then(async (c) => {
              if (c === "Apply") {
                await manager.undoSession();
                updateUi();
                tree.refresh();
              }
            });
        } else if (action.label === "Apply undo now") {
          const confirm = await vscode.window.showWarningMessage(
            "Undoing will overwrite workspace files. Continue?",
            { modal: true },
            "Undo",
          );
          if (confirm === "Undo") {
            await manager.undoSession();
            updateUi();
            tree.refresh();
          }
        }

        return;
      }
    }),

    // Preview a single file from the tree (open diff or file)
    vscode.commands.registerCommand(
      "session.previewFile",
      async (file: any) => {
        if (!file) return;
        const s = manager.getSessions().find((x) => x.id === file.sessionId);
        if (!s) return;

        const uri = vscode.Uri.parse(file.uri);

        try {
          if (file.changeType === "modified") {
            const change = s.changes.find((c) => c.uri === file.uri);
            if (!change) return;
            const left = vscode.Uri.file(change.beforePath);
            const right = vscode.Uri.parse(change.uri);
            const title = `${path.basename(right.fsPath)} — Session ${s.id}`;
            await vscode.commands.executeCommand(
              "vscode.diff",
              left,
              right,
              title,
              { preview: false, preserveFocus: false },
            );
            return;
          }

          if (file.changeType === "deleted") {
            const del = s.deletedFiles.find((d: any) => d.uri === file.uri);
            if (!del) return;
            const left = vscode.Uri.file(del.backupPath);
            const title = `${path.basename(left.fsPath)} — Session ${s.id}`;
            try {
              await vscode.commands.executeCommand(
                "vscode.diff",
                left,
                uri,
                title,
                { preview: false, preserveFocus: false },
              );
            } catch {
              // fall back to opening backup file
              try {
                await vscode.window.showTextDocument(left, { preview: false });
              } catch {}
            }
            return;
          }

          // created file or unknown: just open
          await vscode.window.showTextDocument(uri, { preview: false });
        } catch (err) {
          // ignore preview failures
        }
      },
    ),

    vscode.commands.registerCommand(
      "session.previewSessionItem",
      async (element: any) => {
        let sessionId: string | undefined;
        if (!element) return;
        if (typeof element === "string") sessionId = element;
        else if ((element as any).id) sessionId = (element as any).id;
        else if ((element as any).session && (element as any).session.id)
          sessionId = (element as any).session.id;
        if (!sessionId) return;

        const s = manager.getSessions().find((x) => x.id === sessionId);
        if (!s) return;

        for (const change of s.changes) {
          try {
            const left = vscode.Uri.file(change.beforePath);
            const right = vscode.Uri.parse(change.uri);
            const title = `${path.basename(right.fsPath)} — Session ${s.id}`;
            await vscode.commands.executeCommand(
              "vscode.diff",
              left,
              right,
              title,
              { preview: false, preserveFocus: false },
            );
          } catch (err) {
            // ignore
          }
        }
      },
    ),

    vscode.commands.registerCommand(
      "session.deleteSessionItem",
      async (element: any) => {
        let sessionId: string | undefined;
        if (!element) return;
        if (typeof element === "string") sessionId = element;
        else if ((element as any).id) sessionId = (element as any).id;
        else if ((element as any).session && (element as any).session.id)
          sessionId = (element as any).session.id;
        if (!sessionId) return;

        const confirm = await vscode.window.showWarningMessage(
          "Delete this session and all stored snapshots?",
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") return;

        manager.deleteSession(sessionId);
        tree.refresh();
      },
    ),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (manager.isActive()) {
        manager.trackChange(event.document);
      }
    }),
    vscode.workspace.onDidCreateFiles((e) => {
      for (const f of e.files) manager.trackCreatedFile(f);
    }),

    vscode.workspace.onDidDeleteFiles((e) => {
      for (const f of e.files) manager.trackDeletedFile(f);
    }),
  );
}

export function deactivate() {}
