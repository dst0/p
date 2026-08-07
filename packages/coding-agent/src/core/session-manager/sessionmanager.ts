import type { ImageContent, Message, TextContent } from "@dst0/p-ai";
import { existsSync, mkdirSync } from "fs";
import { normalizePath, resolvePath } from "../../utils/paths.ts";
import type { BashExecutionMessage, CustomMessage } from "../messages.ts";
import {
  do__appendEntry,
  do__buildIndex,
  do__persist,
  do__rewriteFile,
  do_getCwd,
  do_getSessionDir,
  do_getSessionFile,
  do_getSessionId,
  do_isPersisted,
  do_newSession,
  do_setSessionFile,
  do_usesDefaultSessionDir,
} from "./sessionmanager-methods/methods-part1.ts";
import {
  do_appendCompaction,
  do_appendCustomEntry,
  do_appendCustomMessageEntry,
  do_appendLabelChange,
  do_appendMessage,
  do_appendModelChange,
  do_appendSessionInfo,
  do_appendThinkingLevelChange,
  do_getChildren,
  do_getEntry,
  do_getLabel,
  do_getLeafEntry,
  do_getLeafId,
  do_getSessionName,
} from "./sessionmanager-methods/methods-part2.ts";
import {
  do_branch,
  do_branchWithSummary,
  do_buildSessionContext,
  do_getBranch,
  do_getEntries,
  do_getHeader,
  do_getTree,
  do_resetLeaf,
} from "./sessionmanager-methods/methods-part3.ts";
import {
  do_continueRecent,
  do_create,
  do_createBranchedSession,
  do_inMemory,
  do_open,
} from "./sessionmanager-methods/methods-part4.ts";
import { do_forkFrom, do_list, do_listAll } from "./sessionmanager-methods/methods-part5.ts";
import type {
  FileEntry,
  NewSessionOptions,
  SessionContext,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionListProgress,
  SessionTreeNode,
} from "./types-part1.ts";

export class SessionManager {
  public sessionId: string = "";

  public sessionFile: string | undefined;

  public sessionDir: string;

  public cwd: string;

  public persist: boolean;

  public flushed: boolean = false;

  public fileEntries: FileEntry[] = [];

  public byId: Map<string, SessionEntry> = new Map();

  public labelsById: Map<string, string> = new Map();

  public labelTimestampsById: Map<string, string> = new Map();

  public leafId: string | null = null;

  public constructor(
    cwd: string,
    sessionDir: string,
    sessionFile: string | undefined,
    persist: boolean,
    newSessionOptions?: NewSessionOptions,
  ) {
    this.cwd = resolvePath(cwd);
    this.sessionDir = normalizePath(sessionDir);
    this.persist = persist;
    if (persist && this.sessionDir && !existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    if (sessionFile) {
      this.setSessionFile(sessionFile);
    } else {
      this.newSession(newSessionOptions);
    }
  }

  setSessionFile(sessionFile: string): void {
    do_setSessionFile(this, sessionFile);
  }

  newSession(options?: NewSessionOptions): string | undefined {
    return do_newSession(this, options);
  }

  _buildIndex(): void {
    do__buildIndex(this);
  }

  _rewriteFile(): void {
    do__rewriteFile(this);
  }

  isPersisted(): boolean {
    return do_isPersisted(this);
  }

  getCwd(): string {
    return do_getCwd(this);
  }

  getSessionDir(): string {
    return do_getSessionDir(this);
  }

  usesDefaultSessionDir(): boolean {
    return do_usesDefaultSessionDir(this);
  }

  getSessionId(): string {
    return do_getSessionId(this);
  }

  getSessionFile(): string | undefined {
    return do_getSessionFile(this);
  }

  _persist(entry: SessionEntry): void {
    do__persist(this, entry);
  }

  _appendEntry(entry: SessionEntry): void {
    do__appendEntry(this, entry);
  }

  appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
    return do_appendMessage(this, message);
  }

  appendThinkingLevelChange(thinkingLevel: string): string {
    return do_appendThinkingLevelChange(this, thinkingLevel);
  }

  appendModelChange(provider: string, modelId: string): string {
    return do_appendModelChange(this, provider, modelId);
  }

  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    tokensAfter?: number,
    details?: T,
    fromHook?: boolean,
  ): string {
    return do_appendCompaction(this, summary, firstKeptEntryId, tokensBefore, tokensAfter, details, fromHook);
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    return do_appendCustomEntry(this, customType, data);
  }

  appendSessionInfo(name: string): string {
    return do_appendSessionInfo(this, name);
  }

  getSessionName(): string | undefined {
    return do_getSessionName(this);
  }

  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): string {
    return do_appendCustomMessageEntry(this, customType, content, display, details);
  }

  getLeafId(): string | null {
    return do_getLeafId(this);
  }

  getLeafEntry(): SessionEntry | undefined {
    return do_getLeafEntry(this);
  }

  getEntry(id: string): SessionEntry | undefined {
    return do_getEntry(this, id);
  }

  getChildren(parentId: string): SessionEntry[] {
    return do_getChildren(this, parentId);
  }

  getLabel(id: string): string | undefined {
    return do_getLabel(this, id);
  }

  appendLabelChange(targetId: string, label: string | undefined): string {
    return do_appendLabelChange(this, targetId, label);
  }

  getBranch(fromId?: string): SessionEntry[] {
    return do_getBranch(this, fromId);
  }

  buildSessionContext(): SessionContext {
    return do_buildSessionContext(this);
  }

  getHeader(): SessionHeader | null {
    return do_getHeader(this);
  }

  getEntries(): SessionEntry[] {
    return do_getEntries(this);
  }

  getTree(): SessionTreeNode[] {
    return do_getTree(this);
  }

  branch(branchFromId: string): void {
    do_branch(this, branchFromId);
  }

  resetLeaf(): void {
    do_resetLeaf(this);
  }

  branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string {
    return do_branchWithSummary(this, branchFromId, summary, details, fromHook);
  }

  createBranchedSession(leafId: string): string | undefined {
    return do_createBranchedSession(this, leafId);
  }

  static create(cwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager {
    return do_create(cwd, sessionDir, options);
  }

  static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager {
    return do_open(path, sessionDir, cwdOverride);
  }

  static continueRecent(cwd: string, sessionDir?: string): SessionManager {
    return do_continueRecent(cwd, sessionDir);
  }

  static inMemory(cwd: string = process.cwd()): SessionManager {
    return do_inMemory(cwd);
  }

  static forkFrom(
    sourcePath: string,
    targetCwd: string,
    sessionDir?: string,
    options?: NewSessionOptions,
  ): SessionManager {
    return do_forkFrom(sourcePath, targetCwd, sessionDir, options);
  }

  static async list(cwd: string, sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]> {
    return do_list(cwd, sessionDir, onProgress);
  }

  static async listAll(onProgress?: SessionListProgress): Promise<SessionInfo[]>;
  static async listAll(sessionDir?: string, onProgress?: SessionListProgress): Promise<SessionInfo[]>;
  static async listAll(
    sessionDirOrOnProgress?: string | SessionListProgress,
    onProgress?: SessionListProgress,
  ): Promise<SessionInfo[]> {
    return do_listAll(sessionDirOrOnProgress, onProgress);
  }
}
