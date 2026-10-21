import { describe, expect, it } from "vitest";
import { findGlobalPrivileges, findWritePrivileges, redactGrant } from "./grants.ts";

describe("findWritePrivileges", () => {
  it("accepts a SELECT-only user", () => {
    expect(
      findWritePrivileges([
        "GRANT USAGE ON *.* TO `harness_read`@`10.0.0.%` IDENTIFIED BY PASSWORD '*ABC'",
        "GRANT SELECT ON `sik`.* TO `harness_read`@`10.0.0.%`",
        "GRANT SELECT (`no_rkm_medis`, `nm_pasien`) ON `sik`.`pasien` TO `harness_read`@`10.0.0.%`",
        "GRANT SELECT, SHOW VIEW ON `sik`.* TO `harness_read`@`10.0.0.%`",
      ]),
    ).toEqual([]);
  });

  it("flags root, write privileges, PROXY and role grants", () => {
    const grants = [
      "GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION",
      "GRANT PROXY ON ''@'%' TO 'root'@'localhost' WITH GRANT OPTION",
      "GRANT SELECT, UPDATE ON `sik`.* TO `someone`@`%`",
      "GRANT `dba` TO `someone`@`%`",
    ];
    expect(findWritePrivileges(grants)).toEqual(grants);
  });
});

describe("findGlobalPrivileges", () => {
  it("accepts table-level write grants", () => {
    expect(
      findGlobalPrivileges([
        "GRANT USAGE ON *.* TO `harness_write`@`%`",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON `sik`.`kamar_inap` TO `harness_write`@`%`",
        "GRANT SELECT, UPDATE ON `sik`.`kamar` TO `harness_write`@`%`",
      ]),
    ).toEqual([]);
  });

  it("flags global privileges, PROXY, roles and GRANT OPTION", () => {
    const grants = [
      "GRANT SELECT, UPDATE ON *.* TO `w`@`%`",
      "GRANT PROXY ON ''@'%' TO 'w'@'%'",
      "GRANT `dba` TO `w`@`%`",
      "GRANT UPDATE ON `sik`.`kamar` TO `w`@`%` WITH GRANT OPTION",
    ];
    expect(findGlobalPrivileges(grants)).toEqual(grants);
  });
});

describe("redactGrant", () => {
  it("hides password hashes", () => {
    expect(
      redactGrant(
        "GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` IDENTIFIED VIA mysql_native_password USING '*0091' OR unix_socket WITH GRANT OPTION",
      ),
    ).toBe("GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` IDENTIFIED [hidden] WITH GRANT OPTION");
    expect(redactGrant("GRANT USAGE ON *.* TO `r`@`%` IDENTIFIED BY PASSWORD '*ABC'")).toBe(
      "GRANT USAGE ON *.* TO `r`@`%` IDENTIFIED [hidden]",
    );
  });
});
