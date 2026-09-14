# Bootstrap admin account

Design Studio AI can create an initial administrator account from runtime environment variables. This is intended for a fresh installation where the operator wants an account ready before public registration is enabled.

## Configuration

Set the email and password together. The name is optional:

```sh
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD='use-a-long-unique-password'
BOOTSTRAP_ADMIN_NAME='Studio Admin'
```

The password must be 12–128 characters. Do not commit a real password to `.env.example`, Compose files, source code, CI logs, or shell history.

On Node/Docker, the account is provisioned after migrations and before the HTTP server starts. The shared request runtime also performs the same idempotent check, so Cloudflare deployments can use the feature after D1 migrations are applied.

For Cloudflare, configure the values as runtime secrets rather than source-controlled `vars`, for example:

```sh
npm run cf -- secret put BOOTSTRAP_ADMIN_EMAIL
npm run cf -- secret put BOOTSTRAP_ADMIN_PASSWORD
npm run cf -- secret put BOOTSTRAP_ADMIN_NAME
```

## Behavior

The bootstrap operation is intentionally conservative:

- If neither email nor password is configured, nothing changes.
- If only one of email/password is configured, startup/request initialization fails instead of creating a partially configured account.
- If the configured email does not exist, Design Studio creates it using the same PBKDF2 password hashing used by normal registration.
- If the email already exists, bootstrap succeeds only when the configured password already matches that account. This prevents an operator typo from silently promoting an unrelated pre-existing account.
- Existing profile data and password hashes are never overwritten by bootstrap provisioning.
- Provisioning is idempotent and safe to run again after restarts with the same credential.
- Removing the bootstrap environment variables does not delete the account, but bootstrap-derived operator privileges are no longer granted until the identity is configured again or granted through the normal explicit operator settings.

The configured bootstrap identity is treated as the deployment administrator for existing operator-only areas: Community moderation and global Activity/observability. OAuth remains owner-scoped; administrator operations require the account session or an API key belonging to that account.

## Recommended first deployment

A closed self-host installation can start with public signup disabled:

```sh
ALLOW_REGISTRATION=false
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-long-random-password'
BOOTSTRAP_ADMIN_NAME='Studio Admin'
```

After startup, sign in with that email and password. Store the secret in your deployment secret manager.

If the credential must be rotated later, change the account password through an explicit password-change/reset workflow first, then update `BOOTSTRAP_ADMIN_PASSWORD` to the same new value before the next restart. Changing only the bootstrap variable deliberately fails rather than resetting or taking over an existing account.

The implementation is owned by [`server/bootstrap-admin.ts`](../server/bootstrap-admin.ts). Runtime bindings are declared in [`server/types.ts`](../server/types.ts), Node startup is in [`server/node.ts`](../server/node.ts), and `.env.example` / `compose.yaml` show the supported runtime variables.
