import * as vscode from "vscode";
import { Session } from "./types";
import { SessionManager } from "./sessionManager";
import * as path from "path";

type FileElement = {
  type: "file";
  sessionId: string;
  uri: string;
  changeType?: "modified" | "created" | "deleted";
  beforePath?: string;
  afterPath?: string;
};
type Element = Session | FileElement;

export class SessionTreeProvider implements vscode.TreeDataProvider<Element> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Element | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private manager: SessionManager) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Element): vscode.TreeItem {
    if ((element as FileElement).type === "file") {
      const file = element as FileElement;
      const uri = vscode.Uri.parse(file.uri);
      const label = path.basename(uri.fsPath);
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
      );
      // keep file-type icon by assigning resourceUri, but also allow small status icon
      item.resourceUri = uri;
      item.command = {
        command: "session.previewFile",
        title: "Preview File",
        arguments: [file],
      };
      item.contextValue =
        file.changeType === "deleted" ? "deletedFile" : "file";
      item.tooltip = uri.fsPath;
      item.description = file.changeType ? `${file.changeType}` : "";

      // small status icons for change types
      if (file.changeType === "modified")
        item.iconPath = new vscode.ThemeIcon("diff");
      else if (file.changeType === "created")
        item.iconPath = new vscode.ThemeIcon("add");
      else if (file.changeType === "deleted")
        item.iconPath = new vscode.ThemeIcon("trash");

      return item;
    }

    const session = element as Session;
    const label = new Date(session.startedAt).toLocaleString();
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.tooltip = `Session ${session.id}`;
    item.description = `${session.changes.length} file(s)`;
    item.contextValue = "session";
    item.id = session.id;
    item.iconPath = new vscode.ThemeIcon("history");
    return item;
  }

  getChildren(element?: Element): Thenable<Element[]> {
    if (!element) {
      const sessions = this.manager.getSessions();
      return Promise.resolve(sessions);
    }

    if ((element as FileElement).type === "file") {
      return Promise.resolve([]);
    }

    const session = element as Session;
    const map = new Map<string, FileElement>();

    for (const c of session.changes) {
      map.set(c.uri, {
        type: "file",
        sessionId: session.id,
        uri: c.uri,
        changeType: "modified",
        beforePath: c.beforePath,
        afterPath: c.afterPath,
      });
    }

    for (const u of session.createdFiles) {
      if (!map.has(u))
        map.set(u, {
          type: "file",
          sessionId: session.id,
          uri: u,
          changeType: "created",
        });
    }

    for (const d of session.deletedFiles) {
      if (!map.has(d.uri))
        map.set(d.uri, {
          type: "file",
          sessionId: session.id,
          uri: d.uri,
          changeType: "deleted",
          beforePath: d.backupPath,
        });
    }

    return Promise.resolve(Array.from(map.values()));
  }
}
