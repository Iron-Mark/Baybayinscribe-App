import { Pool, type PoolClient, type PoolConfig } from "pg";

interface DatabaseEnvironment {
  DATABASE_URL?: string;
  DATABASE_SSL_MODE?: string;
  DATABASE_CA_CERT?: string;
  NODE_ENV?: string;
  VERCEL?: string;
}

export function databasePoolOptions(env: DatabaseEnvironment = process.env): PoolConfig {
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required for database access.");

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL with an explicit host.");
  }

  // node-postgres parses URL SSL parameters after the options object, replacing
  // its ssl configuration. Remove safe redundant flags; reject weaker settings
  // and file-based overrides rather than silently losing certificate checks.
  for (const [key, value] of Array.from(url.searchParams)) {
    const name = key.toLowerCase();
    if (name.startsWith("ssl") || name === "uselibpqcompat") {
      const verified = (name === "sslmode" && ["require", "verify-full"].includes(value)) ||
        (name === "ssl" && ["true", "1"].includes(value));
      if (!verified) throw new Error("Use DATABASE_SSL_MODE and DATABASE_CA_CERT instead of DATABASE_URL TLS overrides.");
      url.searchParams.delete(key);
    }
  }

  const mode = env.DATABASE_SSL_MODE || "verify-full";
  if (mode === "disable") {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const hostOverride = Array.from(url.searchParams.keys()).some((key) => /^(host|hostaddr)$/i.test(key));
    if (env.NODE_ENV === "production" || env.VERCEL ||
        !["localhost", "127.0.0.1", "::1"].includes(host) || hostOverride) {
      throw new Error("Database TLS may only be disabled explicitly for a loopback development database.");
    }
    return { connectionString: url.toString(), ssl: false };
  }
  if (mode !== "verify-full") throw new Error("DATABASE_SSL_MODE must be verify-full or disable.");

  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (ca && (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----"))) {
    throw new Error("DATABASE_CA_CERT must contain a PEM CA certificate, not a file path.");
  }
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
  };
}

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, release: (error?: Error | boolean) => void) => void;

// The guest showcase imports routes without a configured DB. Keep imports inert,
// but never let pg fall back to PGHOST/PGUSER or a default local database on use.
// Using a real Pool subclass preserves Drizzle's Pool/transaction semantics.
export class DatabasePool extends Pool {
  private readonly configured: boolean;

  constructor(env: DatabaseEnvironment = process.env) {
    const configured = Boolean(env.DATABASE_URL?.trim());
    super(configured ? databasePoolOptions(env) : { ssl: { rejectUnauthorized: true } });
    this.configured = configured;
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (!this.configured) {
      const error = new Error("DATABASE_URL is required for database access.");
      if (callback) {
        queueMicrotask(() => callback(error, undefined, () => {}));
        return;
      }
      return Promise.reject(error);
    }
    if (callback) return super.connect(callback);
    return super.connect();
  }
}
