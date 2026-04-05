import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export class Storage {
  constructor(private context: vscode.ExtensionContext) {}

  get basePath() {
    return this.context.globalStorageUri.fsPath;
  }

  ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  writeFile(filePath: string, content: string) {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf-8");
  }

  readFile(filePath: string) {
    return fs.readFileSync(filePath, "utf-8");
  }

  // Snapshot storage with deduplication by content hash
  get snapshotsPath() {
    return path.join(this.basePath, "snapshots");
  }

  writeSnapshot(sessionId: string, uri: string, content: string) {
    this.ensureDir(this.snapshotsPath);

    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const snapshotFile = path.join(this.snapshotsPath, `${hash}.txt`);

    if (!fs.existsSync(snapshotFile)) {
      fs.writeFileSync(snapshotFile, content, "utf-8");
    }

    return snapshotFile;
  }

  readSnapshot(snapshotPath: string) {
    return this.readFile(snapshotPath);
  }

  // Session metadata helpers
  get sessionsPath() {
    return path.join(this.basePath, "sessions");
  }

  writeSessionMetadata(sessionId: string, data: any) {
    const dir = path.join(this.sessionsPath, sessionId);
    this.ensureDir(dir);
    const file = path.join(dir, "session.json");
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  }

  readSessionMetadata(sessionId: string) {
    const file = path.join(this.sessionsPath, sessionId, "session.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }

  listSessions(): string[] {
    this.ensureDir(this.sessionsPath);
    return fs.readdirSync(this.sessionsPath).filter((f) => {
      try {
        return fs.statSync(path.join(this.sessionsPath, f)).isDirectory();
      } catch {
        return false;
      }
    });
  }
}
