import { z } from 'zod';
import type { Bindings, User } from './types';
import { id, now, passwordHash, passwordMatches } from './security';

const bootstrapAdminSchema = z.object({
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(100).default('Admin'),
});

export interface BootstrapAdminResult extends User {
  created: boolean;
}

const pending = new WeakMap<object, Promise<BootstrapAdminResult | null>>();

function rawConfig(env: Bindings) {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim() ?? '';
  const password = env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  const name = env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Admin';
  if (!email && !password) return null;
  if (!email || !password)
    throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be configured together.');
  return bootstrapAdminSchema.parse({ email, password, name });
}

/**
 * Creates the configured admin account once. An existing account is adopted only when
 * the configured password already matches it; credentials and profile data are never overwritten.
 */
export function ensureBootstrapAdmin(env: Bindings): Promise<BootstrapAdminResult | null> {
  const config = rawConfig(env);
  if (!config) return Promise.resolve(null);
  const key = env.DB as object;
  const current = pending.get(key);
  if (current) return current;
  const provisioning = (async () => {
    const existing = await env.DB.prepare('SELECT id,email,name,password FROM users WHERE email=?')
      .bind(config.email)
      .first<User & { password: string }>();
    if (existing) {
      if (!await passwordMatches(config.password, existing.password))
        throw new Error('Bootstrap admin email already belongs to an account with a different password. Refusing to promote or reset it.');
      const { password: _password, ...user } = existing;
      return { ...user, created: false };
    }

    const userId = id();
    const password = await passwordHash(config.password);
    await env.DB.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING')
      .bind(userId, config.email, config.name, password, now())
      .run();

    const user = await env.DB.prepare('SELECT id,email,name,password FROM users WHERE email=?')
      .bind(config.email)
      .first<User & { password: string }>();
    if (!user) throw new Error('Bootstrap admin account could not be created.');
    if (user.id !== userId && !await passwordMatches(config.password, user.password))
      throw new Error('Bootstrap admin email was claimed concurrently with a different password. Refusing to promote it.');
    const { password: _password, ...safeUser } = user;
    return { ...safeUser, created: user.id === userId };
  })().catch(error => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, provisioning);
  return provisioning;
}

export async function isBootstrapAdminUserId(env: Bindings, userId: string): Promise<boolean> {
  const admin = await ensureBootstrapAdmin(env);
  return admin?.id === userId;
}
