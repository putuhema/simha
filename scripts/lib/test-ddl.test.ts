import { describe, expect, it } from "vitest";
import { toTestDdl } from "./test-ddl.ts";

describe("toTestDdl", () => {
  it("removes foreign keys and the trailing comma they leave", () => {
    const ddl = toTestDdl(
      [
        "CREATE TABLE `kamar_inap` (",
        "  `no_rawat` varchar(17) NOT NULL DEFAULT '',",
        "  `kd_kamar` varchar(15) NOT NULL,",
        "  PRIMARY KEY (`no_rawat`),",
        "  KEY `kd_kamar` (`kd_kamar`),",
        "  CONSTRAINT `kamar_inap_ibfk_2` FOREIGN KEY (`kd_kamar`) REFERENCES `kamar` (`kd_kamar`) ON UPDATE CASCADE,",
        "  CONSTRAINT `kamar_inap_ibfk_3` FOREIGN KEY (`no_rawat`) REFERENCES `reg_periksa` (`no_rawat`)",
        ") ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=latin1",
      ].join("\n"),
    );
    expect(ddl).not.toContain("FOREIGN KEY");
    expect(ddl).not.toContain("AUTO_INCREMENT");
    expect(ddl).toContain("  KEY `kd_kamar` (`kd_kamar`)\n) ENGINE=InnoDB DEFAULT CHARSET=latin1;");
  });

  it("keeps CHECK constraints", () => {
    const ddl = toTestDdl("CREATE TABLE `t` (\n  `a` int,\n  CONSTRAINT `c` CHECK (`a` > 0)\n) ENGINE=InnoDB");
    expect(ddl).toContain("CONSTRAINT `c` CHECK (`a` > 0)\n)");
  });
});
