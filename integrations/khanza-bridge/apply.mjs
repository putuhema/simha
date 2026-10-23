/**
 * Adds the Simha bridge to a Khanza source tree (run again after
 * every Khanza update; it only changes what is missing):
 *
 *   node integrations/khanza-bridge/apply.mjs ~/Work/simrsmt
 *
 * 1. copies HarnessBridge.java to src/simrskhanza/;
 * 2. in src/simrskhanza/frmUtama.java adds HarnessBridge.start() after the
 *    login (akses.setData(...)) and HarnessBridge.stop() at logout
 *    (akses.setLogOut()).
 * Then build Khanza as usual (NetBeans: Clean and Build).
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const khanza = process.argv[2];
if (!khanza || !existsSync(path.join(khanza, "src/simrskhanza/frmUtama.java"))) {
  console.error("Usage: node integrations/khanza-bridge/apply.mjs <folder Khanza (berisi src/simrskhanza/frmUtama.java)>");
  process.exit(1);
}
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

copyFileSync(path.join(here, "HarnessBridge.java"), path.join(khanza, "src/simrskhanza/HarnessBridge.java"));
console.log("✓ src/simrskhanza/HarnessBridge.java");

const file = path.join(khanza, "src/simrskhanza/frmUtama.java");
// latin1 keeps every byte as it is, whatever encoding the file uses.
let text = readFileSync(file, "latin1");
const eol = text.includes("\r\n") ? "\r\n" : "\n";

const addAfter = (anchor, line, what) => {
  // The call itself is the marker, not the comment: a tree patched before the
  // rename still has the old comment but must not get a second call.
  const call = line.split("//")[0].trim();
  if (text.includes(call)) return console.log(`✓ ${what} (sudah ada)`);
  const match = new RegExp(`^([ \\t]*)${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*$`, "m").exec(text);
  if (!match) {
    console.error(`✕ ${what}: baris "${anchor}" tidak ditemukan di frmUtama.java. Tambahkan manual: ${line.trim()}`);
    process.exitCode = 1;
    return;
  }
  const end = match.index + match[0].length;
  text = `${text.slice(0, end)}${eol}${match[1]}${line.trim()}${text.slice(end)}`;
  console.log(`✓ ${what}`);
};

addAfter(
  "akses.setData(edAdmin.getText(), edPwd.getText());",
  'HarnessBridge.start(); // Simha: "Buka di Khanza" opens forms here (only after a successful login)',
  "start setelah login",
);
addAfter("akses.setLogOut();", "HarnessBridge.stop(); // Simha bridge", "stop saat logout");

writeFileSync(file, text, "latin1");
