/**
 * Checks the output of `SHOW GRANTS` for the current user.
 */

/** Removes password hashes (`IDENTIFIED BY PASSWORD '*...'`, `IDENTIFIED VIA ... USING '...'`) from a grant line. */
export const redactGrant = (grant: string): string =>
  grant.trim().replace(/\s+IDENTIFIED\b.*?(?=\s+WITH\s+GRANT\s+OPTION\b|$)/i, " IDENTIFIED [hidden]");

const READ_ONLY_PRIVILEGES = new Set(["SELECT", "USAGE", "SHOW VIEW"]);

/** Privileges in one `GRANT ... ON ...` line, with column lists like `SELECT (a, b)` removed. */
const privilegesOf = (grant: string): ReadonlyArray<string> | undefined => {
  const match = /^GRANT\s+(.+?)\s+ON\s+/i.exec(grant.trim());
  if (!match?.[1]) return undefined;
  return match[1]
    .replaceAll(/\([^)]*\)/g, "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p.length > 0);
};

/**
 * Returns a description of every grant that allows more than reading, or an
 * empty list when the user is read-only. Role grants (`GRANT role TO user`)
 * count as unsafe because their privileges are not visible here.
 */
export const findWritePrivileges = (grants: ReadonlyArray<string>): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  for (const grant of grants) {
    const privileges = privilegesOf(grant);
    if (privileges === undefined) {
      problems.push(redactGrant(grant));
      continue;
    }
    const unsafe = privileges.filter((p) => !READ_ONLY_PRIVILEGES.has(p));
    if (unsafe.length > 0) problems.push(redactGrant(grant));
  }
  return problems;
};

/**
 * Grants the write user must not have: privileges on every database
 * (`ON *.*`) except USAGE, any PROXY grant, role grants, and anything
 * WITH GRANT OPTION. The write user should only hold table-level grants on
 * the fix allow-list.
 */
export const findGlobalPrivileges = (grants: ReadonlyArray<string>): ReadonlyArray<string> =>
  grants
    .filter((grant) => {
      const privileges = privilegesOf(grant);
      if (privileges === undefined) return true;
      if (/WITH\s+GRANT\s+OPTION/i.test(grant) || privileges.includes("PROXY")) return true;
      return /\sON\s+\*\.\*\s/i.test(grant) && privileges.some((p) => p !== "USAGE");
    })
    .map(redactGrant);
