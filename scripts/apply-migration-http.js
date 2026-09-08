/*
 * Applies a Prisma migration.sql to Neon over HTTPS (port 443) using the
 * Neon serverless driver, and records it in the _prisma_migrations table.
 *
 * Why this exists: this local dev machine has no working IPv6 route, and
 * Prisma's schema-engine only tries the first DNS result (IPv6) without
 * falling back to IPv4, so `prisma migrate dev` cannot reach Neon directly
 * here. Production hosts (Render) have normal networking and can use
 * `prisma migrate deploy` directly — this script is a local-only workaround.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

async function main() {
  const migrationDir = process.argv[2];
  if (!migrationDir) {
    console.error('Uso: node scripts/apply-migration-http.js <carpeta-de-migracion>');
    process.exit(1);
  }
  const dirName = path.basename(migrationDir);
  const sqlPath = path.join(migrationDir, 'migration.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id                      VARCHAR(36) PRIMARY KEY,
      checksum                VARCHAR(64) NOT NULL,
      finished_at             TIMESTAMPTZ,
      migration_name          VARCHAR(255) NOT NULL,
      logs                    TEXT,
      rolled_back_at          TIMESTAMPTZ,
      started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_steps_count     INTEGER NOT NULL DEFAULT 0
    )
  `;

  const already = await sql`SELECT id FROM "_prisma_migrations" WHERE migration_name = ${dirName}`;
  if (already.length > 0) {
    console.log(`Migración "${dirName}" ya estaba aplicada, se omite.`);
    return;
  }

  const statements = sqlContent
    .split(';')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((s) => s.length > 0);

  console.log(`Aplicando ${statements.length} sentencias de "${dirName}"...`);
  for (const statement of statements) {
    await sql.query(statement);
  }

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
    VALUES (${id}, ${checksum}, now(), ${dirName}, ${statements.length})
  `;

  console.log(`Migración "${dirName}" aplicada y registrada correctamente.`);
}

main().catch((err) => {
  console.error('Error aplicando migración:', err);
  process.exit(1);
});
