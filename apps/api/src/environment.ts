export function validateEnvironment(env: Record<string, unknown>) {
  const database = String(env.DATABASE_URL ?? '');
  if (!/^postgres(ql)?:\/\//.test(database)) throw new Error('DATABASE_URL must use PostgreSQL.');
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
  const ttl = Number(env.SESSION_TTL_HOURS ?? 8);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 24) throw new Error('SESSION_TTL_HOURS must be between 0 and 24.');
  const origin = String(env.WEB_ORIGIN ?? 'http://localhost:3000');
  if (!/^https?:\/\/[^/]+$/.test(origin)) throw new Error('WEB_ORIGIN must be an HTTP origin without a trailing slash.');
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Production WEB_ORIGIN must use HTTPS.');
  return { ...env, DATABASE_URL: database, API_PORT: port, SESSION_TTL_HOURS: ttl, WEB_ORIGIN: origin };
}
