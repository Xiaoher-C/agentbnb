/**
 * Allow-listed SQL identifiers for `addColumnIfNotExists` and related migration helpers.
 *
 * SQLite cannot bind table or column names through prepared statement parameters —
 * `PRAGMA table_info(?)` and `ALTER TABLE ? ADD COLUMN ?` are not supported. The
 * migration helper interpolates these names directly into SQL strings, which means
 * any caller-controlled identifier would be a SQL injection vector. The current
 * call sites are all static literals, but to defend against future callers
 * accidentally introducing dynamic input we validate every identifier against
 * an explicit allow-list before constructing the statement.
 *
 * If a new migration needs a fresh table or column, add it here. Throw early if
 * an unknown identifier appears at runtime.
 */

/** Tables that may be referenced by `addColumnIfNotExists`. */
export const ALLOWED_MIGRATION_TABLES: ReadonlySet<string> = new Set([
  'credit_escrow',
  'credit_grants',
  'request_log',
]);

/** Columns that may be added by `addColumnIfNotExists`. */
export const ALLOWED_MIGRATION_COLUMNS: ReadonlySet<string> = new Set([
  'funding_source',
  'owner',
  'skill_id',
  'action_type',
  'tier_invoked',
  'failure_reason',
  'team_id',
  'role',
  'capability_type',
]);

/**
 * Defense-in-depth pattern for the column type/constraint clause.
 *
 * `typeAndConstraints` is also interpolated into raw SQL, so we restrict it to a
 * conservative character set: alphanumerics, underscores, spaces, single quotes
 * (for `DEFAULT 'literal'`), parentheses, commas, periods, and hyphens (for
 * negative defaults). This rejects semicolons, angle brackets, and other
 * characters that have no place in a DDL constraint.
 */
const TYPE_CONSTRAINTS_PATTERN = /^[A-Za-z0-9_ '(),.-]+$/;
/** Sequences that introduce SQL comments — never valid inside a column type clause. */
const COMMENT_SEQUENCES = ['--', '/*', '*/'] as const;

/**
 * Asserts that the supplied table, column, and type-constraints clause are safe
 * to interpolate into a DDL statement.
 *
 * @throws Error when any identifier is outside its allow-list, or when the
 *   type-constraints clause contains characters that could break out of the
 *   DDL grammar.
 */
export function assertSafeMigrationIdentifiers(
  table: string,
  column: string,
  typeAndConstraints: string,
): void {
  if (!ALLOWED_MIGRATION_TABLES.has(table)) {
    throw new Error(`migration: illegal identifier table=${table} column=${column}`);
  }
  if (!ALLOWED_MIGRATION_COLUMNS.has(column)) {
    throw new Error(`migration: illegal identifier table=${table} column=${column}`);
  }
  if (!TYPE_CONSTRAINTS_PATTERN.test(typeAndConstraints)) {
    throw new Error(
      `migration: illegal type/constraints for table=${table} column=${column}`,
    );
  }
  for (const marker of COMMENT_SEQUENCES) {
    if (typeAndConstraints.includes(marker)) {
      throw new Error(
        `migration: illegal type/constraints for table=${table} column=${column}`,
      );
    }
  }
}
