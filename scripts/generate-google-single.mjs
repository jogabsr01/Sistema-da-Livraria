// Generate a paste-once alternative. Never loads runtime settings or Google APIs.
import { readFileSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const SINGLE_FILE = "instalacao-google-dev/CodigoUnico.gs.txt";
export function generateGoogleSingle(
  root = fileURLToPath(new URL("../", import.meta.url)),
) {
  const directory = resolve(root, "google-apps-script");
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw Error("INVALID_GAS_DIRECTORY");
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".gs"))
    .sort();
  if (!names.length) throw Error("EMPTY_GAS_INVENTORY");
  let output =
    "// GENERATED: npm run google:single. Do not edit this generated copy.\n// DEV: use this single script OR the separate modules, never both.\n// Preserve appsscript.json, Script Properties, resource IDs and deployment URL.\n";
  for (const name of names) {
    const path = resolve(directory, name),
      stat = lstatSync(path);
    if (
      !/^[A-Za-z][A-Za-z0-9]*\.gs$/.test(name) ||
      !stat.isFile() ||
      stat.isSymbolicLink()
    )
      throw Error("INVALID_GAS_SOURCE");
    const bytes = readFileSync(path),
      hash = createHash("sha256").update(bytes).digest("hex");
    output += `\n// BEGIN ${name} sha256=${hash}\n${bytes.toString("utf8")}\n;\n// END ${name}\n`;
  }
  return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url)),
      file = resolve(root, SINGLE_FILE),
      args = process.argv.slice(2);
    if (args.length && !(args.length === 1 && args[0] === "--check"))
      throw Error("INVALID_ARGUMENT");
    const expected = generateGoogleSingle(root);
    if (args[0] === "--check") {
      if (readFileSync(file, "utf8") !== expected)
        throw Error("STALE_GOOGLE_SINGLE_FILE");
    } else {
      if (lstatSync(resolve(root, "instalacao-google-dev")).isSymbolicLink())
        throw Error("INVALID_OUTPUT");
      try {
        if (lstatSync(file).isSymbolicLink()) throw Error("INVALID_OUTPUT");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      writeFileSync(file, expected);
    }
    console.log("GOOGLE_SINGLE_FILE_OK");
  } catch {
    console.error("GOOGLE_SINGLE_FILE_FAILED");
    process.exitCode = 1;
  }
}
