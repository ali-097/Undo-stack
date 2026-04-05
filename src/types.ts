import * as vscode from "vscode";

export type FileChange = {
  uri: string;
  beforePath: string; // snapshot path
  afterPath: string;
};

export type Session = {
  id: string;
  startedAt: number;
  changes: FileChange[];
  createdFiles: string[];
  deletedFiles: { uri: string; backupPath: string }[];
  // Optional Git metadata
  gitPrevHead?: string;
  gitCommit?: string;
  // Map of uri -> snapshotPath for pre-session baseline
  baseline?: { [uri: string]: string };
};
