export type DatabaseResult = {
  meta?: { changes?: number };
};

export type DatabaseStatement = {
  bind: (...values: unknown[]) => DatabaseStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<DatabaseResult>;
};

export type Database = {
  prepare: (query: string) => DatabaseStatement;
  batch: (statements: DatabaseStatement[]) => Promise<DatabaseResult[]>;
};

export type ObjectBody = {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  writeHttpMetadata: (headers: Headers) => void;
};

export type ObjectBucket = {
  put: (
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ) => Promise<unknown>;
  get: (key: string) => Promise<ObjectBody | null>;
  delete: (key: string) => Promise<void>;
};

export type AppEnv = {
  DB: Database;
  MODEL_ASSETS: ObjectBucket;
  BOOTSTRAP_TOKEN?: string;
  SESSION_TTL_HOURS?: string;
};

export type GlobalRole = "platform_admin" | "delivery_manager" | "viewer";

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  is_active: number;
};

type RoleRow = {
  role: GlobalRole;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  roles: GlobalRole[];
};

export type PasswordRecord = {
  hash: string;
  salt: string;
  iterations: number;
};

export type Session = {
  token: string;
  maxAgeSeconds: number;
};

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const DEFAULT_PASSWORD_ITERATIONS = 310_000;
const DEFAULT_SESSION_TTL_HOURS = 24;
const SESSION_COOKIE_NAME = "factory_twin_session";

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const hashSha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64(new Uint8Array(digest));
};

const derivePasswordHash = async (
  password: string,
  salt: string,
  iterations: number,
): Promise<string> => {
  const saltBytes = fromBase64(salt);
  const saltBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength,
  ) as ArrayBuffer;
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    passwordKey,
    256,
  );

  return toBase64(new Uint8Array(bits));
};

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return difference === 0;
};

const parseSessionTtlHours = (env: AppEnv): number => {
  if (!env.SESSION_TTL_HOURS) {
    return DEFAULT_SESSION_TTL_HOURS;
  }

  const value = Number(env.SESSION_TTL_HOURS);

  if (!Number.isFinite(value) || value < 1 || value > 720) {
    throw new AppError(
      500,
      "invalid_session_ttl_configuration",
      "SESSION_TTL_HOURS must be between 1 and 720.",
    );
  }

  return Math.floor(value);
};

const rolesForUser = async (env: AppEnv, userId: string): Promise<GlobalRole[]> => {
  const result = await env.DB.prepare(
    "SELECT role FROM user_roles WHERE user_id = ? ORDER BY role ASC",
  )
    .bind(userId)
    .all<RoleRow>();

  return (result.results ?? []).map((row) => row.role);
};

const toAuthenticatedUser = async (
  env: AppEnv,
  user: Pick<UserRow, "id" | "email" | "display_name">,
): Promise<AuthenticatedUser> => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  roles: await rolesForUser(env, user.id),
});

const parseCookie = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const [key, ...value] = segment.trim().split("=");

    if (key === name) {
      return value.join("=") || null;
    }
  }

  return null;
};

export const validateEmail = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_email", "Email is required.");
  }

  const email = value.trim().toLowerCase();

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, "invalid_email", "Please provide a valid email address.");
  }

  return email;
};

export const validateDisplayName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_display_name", "Display name is required.");
  }

  const displayName = value.trim();

  if (displayName.length < 2 || displayName.length > 80) {
    throw new AppError(
      400,
      "invalid_display_name",
      "Display name must contain 2 to 80 characters.",
    );
  }

  return displayName;
};

export const validatePassword = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new AppError(400, "invalid_password", "Password is required.");
  }

  if (value.length < 12 || value.length > 256) {
    throw new AppError(
      400,
      "invalid_password",
      "Password must contain 12 to 256 characters.",
    );
  }

  return value;
};

export const createPasswordRecord = async (password: string): Promise<PasswordRecord> => {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toBase64(saltBytes);

  return {
    salt,
    hash: await derivePasswordHash(password, salt, DEFAULT_PASSWORD_ITERATIONS),
    iterations: DEFAULT_PASSWORD_ITERATIONS,
  };
};

export const isBootstrapRequired = async (env: AppEnv): Promise<boolean> => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{
    count: number;
  }>();

  return (row?.count ?? 0) === 0;
};

export const verifyBootstrapToken = async (
  env: AppEnv,
  receivedToken: string | null,
): Promise<void> => {
  if (!env.BOOTSTRAP_TOKEN) {
    throw new AppError(
      503,
      "bootstrap_not_configured",
      "The API administrator bootstrap token has not been configured.",
    );
  }

  if (!receivedToken) {
    throw new AppError(401, "invalid_bootstrap_token", "Bootstrap token is required.");
  }

  const [receivedHash, expectedHash] = await Promise.all([
    hashSha256(receivedToken),
    hashSha256(env.BOOTSTRAP_TOKEN),
  ]);

  if (!constantTimeEqual(receivedHash, expectedHash)) {
    throw new AppError(401, "invalid_bootstrap_token", "Bootstrap token is invalid.");
  }
};

export const createUser = async (
  env: AppEnv,
  input: { email: string; displayName: string; password: string; roles: GlobalRole[] },
): Promise<AuthenticatedUser> => {
  const password = await createPasswordRecord(input.password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: DatabaseStatement[] = [
    env.DB
      .prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, password_salt, password_iterations,
          is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        userId,
        input.email,
        input.displayName,
        password.hash,
        password.salt,
        password.iterations,
        now,
        now,
      ),
  ];

  for (const role of input.roles) {
    statements.push(
      env.DB
        .prepare("INSERT INTO user_roles (user_id, role, created_at) VALUES (?, ?, ?)")
        .bind(userId, role, now),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      throw new AppError(409, "email_already_exists", "An account already uses this email.");
    }

    throw error;
  }

  return {
    id: userId,
    email: input.email,
    displayName: input.displayName,
    roles: input.roles,
  };
};

export const verifyCredentials = async (
  env: AppEnv,
  email: string,
  password: string,
): Promise<AuthenticatedUser> => {
  const user = await env.DB.prepare(
    `SELECT id, email, display_name, password_hash, password_salt, password_iterations, is_active
     FROM users
     WHERE email = ?`,
  )
    .bind(email)
    .first<UserRow>();

  if (!user || user.is_active !== 1) {
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  const calculatedHash = await derivePasswordHash(
    password,
    user.password_salt,
    user.password_iterations,
  );

  if (!constantTimeEqual(calculatedHash, user.password_hash)) {
    throw new AppError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  return toAuthenticatedUser(env, user);
};

export const createSession = async (env: AppEnv, userId: string): Promise<Session> => {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const maxAgeSeconds = parseSessionTtlHours(env) * 60 * 60;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxAgeSeconds * 1_000).toISOString();

  await env.DB
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      await hashSha256(token),
      expiresAt,
      now.toISOString(),
      now.toISOString(),
    )
    .run();

  return { token, maxAgeSeconds };
};

export const getAuthenticatedUser = async (
  env: AppEnv,
  request: Request,
): Promise<AuthenticatedUser> => {
  const token = parseCookie(request, SESSION_COOKIE_NAME);

  if (!token) {
    throw new AppError(401, "unauthenticated", "Please sign in to continue.");
  }

  const now = new Date().toISOString();
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.password_salt,
            u.password_iterations, u.is_active
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashSha256(token), now)
    .first<UserRow>();

  if (!user || user.is_active !== 1) {
    throw new AppError(401, "unauthenticated", "Please sign in to continue.");
  }

  await env.DB
    .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(now, await hashSha256(token))
    .run();

  return toAuthenticatedUser(env, user);
};

export const destroyCurrentSession = async (env: AppEnv, request: Request): Promise<void> => {
  const token = parseCookie(request, SESSION_COOKIE_NAME);

  if (token) {
    await env.DB
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await hashSha256(token))
      .run();
  }
};

export const applySessionCookie = (
  response: Response,
  request: Request,
  session: Session | null,
): Response => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const maxAge = session ? session.maxAgeSeconds : 0;
  const token = session?.token ?? "";

  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );

  return response;
};

export const hasGlobalRole = (
  user: AuthenticatedUser,
  ...roles: GlobalRole[]
): boolean => roles.some((role) => user.roles.includes(role));

export const capabilitiesFor = (user: AuthenticatedUser) => ({
  canCreateProject: hasGlobalRole(user, "platform_admin", "delivery_manager"),
  canManageUsers: hasGlobalRole(user, "platform_admin"),
});
