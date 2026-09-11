-- Keep email as a verified identity attribute while restoring an explicit,
-- application-owned login name. Existing deployments assign `admin` to the
-- oldest platform administrator; new deployments set it during bootstrap.

ALTER TABLE users ADD COLUMN login_name TEXT COLLATE NOCASE;

UPDATE users
SET login_name = 'admin',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = (
  SELECT users.id
  FROM users
  INNER JOIN user_roles ON user_roles.user_id = users.id
  WHERE user_roles.role = 'platform_admin'
  ORDER BY users.created_at ASC, users.id ASC
  LIMIT 1
);

CREATE UNIQUE INDEX users_login_name_idx
ON users(login_name)
WHERE login_name IS NOT NULL;
