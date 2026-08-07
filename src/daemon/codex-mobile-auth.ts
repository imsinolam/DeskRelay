import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;

type CodexMobileAuthState = {
  version: 1;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  updatedAt: string;
};

export type CodexMobileAuthStoreOptions = {
  stateFile: string;
  now?: () => number;
  sessionTtlMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeState(value: unknown): CodexMobileAuthState | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }
  const passwordSalt = value.passwordSalt;
  const passwordHash = value.passwordHash;
  const sessionSecret = value.sessionSecret;
  const updatedAt = value.updatedAt;
  if (
    typeof passwordSalt !== "string" || !passwordSalt.trim() ||
    typeof passwordHash !== "string" || !passwordHash.trim() ||
    typeof sessionSecret !== "string" || !sessionSecret.trim() ||
    typeof updatedAt !== "string" || !updatedAt.trim()
  ) {
    return null;
  }
  return {
    version: 1,
    passwordSalt,
    passwordHash,
    sessionSecret,
    updatedAt,
  };
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32);
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validatePassword(password: string): void {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) {
    throw new Error(`密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符。`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    throw new Error(`密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符。`);
  }
}

export class CodexMobileAuthStore {
  private readonly stateFile: string;
  private readonly now: () => number;
  private readonly sessionTtlMs: number;
  private state: CodexMobileAuthState | null;

  constructor(options: CodexMobileAuthStoreOptions) {
    this.stateFile = options.stateFile;
    this.now = options.now ?? (() => Date.now());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.state = this.readState();
  }

  isConfigured(): boolean {
    return Boolean(this.state);
  }

  setPassword(password: string): void {
    validatePassword(password);
    const salt = crypto.randomBytes(16);
    this.state = {
      version: 1,
      passwordSalt: salt.toString("base64url"),
      passwordHash: hashPassword(password, salt).toString("base64url"),
      sessionSecret: crypto.randomBytes(32).toString("base64url"),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.persist();
  }

  verifyPassword(password: string): boolean {
    const state = this.state;
    if (!state) {
      return false;
    }
    try {
      const salt = Buffer.from(state.passwordSalt, "base64url");
      const expected = Buffer.from(state.passwordHash, "base64url");
      return safeEqual(hashPassword(password, salt), expected);
    } catch {
      return false;
    }
  }

  createSessionToken(): string {
    const state = this.state;
    if (!state) {
      throw new Error("请先设置移动版访问密码。");
    }
    const expiresAtMs = this.now() + this.sessionTtlMs;
    const nonce = crypto.randomBytes(16).toString("base64url");
    const payload = `v1.${expiresAtMs}.${nonce}`;
    const signature = this.sign(payload, state.sessionSecret);
    return `${payload}.${signature}`;
  }

  verifySessionToken(token: string | undefined): boolean {
    const state = this.state;
    if (!state || !token) {
      return false;
    }
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") {
      return false;
    }
    const expiresAtMs = Number(parts[1]);
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < this.now()) {
      return false;
    }
    const payload = parts.slice(0, 3).join(".");
    const expected = Buffer.from(this.sign(payload, state.sessionSecret));
    const actual = Buffer.from(parts[3] ?? "");
    return safeEqual(actual, expected);
  }

  private sign(payload: string, secret: string): string {
    return crypto
      .createHmac("sha256", Buffer.from(secret, "base64url"))
      .update(payload)
      .digest("base64url");
  }

  private readState(): CodexMobileAuthState | null {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return null;
      }
      return normalizeState(JSON.parse(fs.readFileSync(this.stateFile, "utf8")));
    } catch {
      return null;
    }
  }

  private persist(): void {
    const state = this.state;
    if (!state) {
      return;
    }
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(tempFile, this.stateFile);
    fs.chmodSync(this.stateFile, 0o600);
  }
}
