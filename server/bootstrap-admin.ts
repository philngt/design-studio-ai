import { z } from 'zod';
import type { Bindings, User } from './types';
import { id, now, passwordHash } from './security';

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

/** Returns the configured bootstrap-admin email without exposing any credential. */
export function bootstrapAdminEmail(env: Bindings): string | null {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  return email || null;
}

export function isBootstrapAdminEmail(env: Bindings, email: string | null | undefined): boolean {
  const configured = bootstrapAdminEmail(env);
  return !!configured && configured === email?.trim().toLowerCase();
}

/**
 * Creates the configured admin account once. Existing accounts are never overwritten,
 * so changing BOOTSTRAP_ADMIN_PASSWORD cannot silently reset a real user's password.
 */
export function ensureBootstrapAdmin(env: Bindings): Promise<BootstrapAdminResult | null> {
  const config = rawConfig(env);
  if (!config) return Promise.resolve(null);
  const key = env.DB as object;
  const current = pending.get(key);
  if (current) return current;
  const provisioning = (async () => {
    const existing = await env.DB.prepare('SELECT id,email,name FROM users WHERE email=?')
      .bind(config.email)
      .first<User>();
    if (existing) return { ...existing, created: false };

    const userId = id();
    const password = await passwordHash(config.password);
    await env.DB.prepare('INSERT INTO users(id,email,name,password,created_at) VALUES(?,?,?,?,?) ON CONFLICT(email) DO NOTHING')
      .bind(userId, config.email, config.name, password, now())
      .run();

    const user = await env.DB.prepare('SELECT id,email,name FROM users WHERE email=?')
      .bind(config.email)
      .first<User>();
    if (!user) throw new Error('Bootstrap admin account could not be created.');
    return { ...user, created: user.id === userId };
  })().catch(error => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, provisioning);
  return provisioning;
}

export async function isBootstrapAdminUserId(env: Bindings, userId: string): Promise<boolean> {
  const configured = bootstrapAdminEmail(env);
  if (!configured) return false;
  const user = await env.DB.prepare('SELECT email FROM users WHERE id=?')
    .bind(userId)
    .first<{ email: string }>();
  return isBootstrapAdminEmail(env, user?.email);
}
