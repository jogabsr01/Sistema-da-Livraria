import { writeFileSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const EMPTY_METADATA =
  "// Replaced during Netlify builds with public deployment identity only, never secrets.\nexport const deploymentMetadata = null;\n";
export function buildDeploymentMetadata(env = process.env) {
  if (env.NETLIFY !== "true") return null;
  if (
    !["production", "branch-deploy", "deploy-preview", "dev"].includes(
      env.CONTEXT,
    ) ||
    typeof env.BRANCH !== "string" ||
    !env.BRANCH ||
    env.BRANCH.length > 200 ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(env.SITE_ID || "")
  )
    throw Error("INVALID_DEPLOYMENT_METADATA");
  let url;
  try {
    url = new URL(env.DEPLOY_PRIME_URL);
  } catch {
    throw Error("INVALID_DEPLOYMENT_METADATA");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("INVALID_DEPLOYMENT_METADATA");
  return {
    version: 1,
    context: env.CONTEXT,
    branch: env.BRANCH,
    deploymentUrl: url.href,
    siteId: env.SITE_ID,
  };
}
export function writeDeploymentMetadata(root, env = process.env) {
  const metadata = buildDeploymentMetadata(env),
    file = resolve(root, "backend/deployment-metadata.mjs");
  if (lstatSync(resolve(root, "backend")).isSymbolicLink())
    throw Error("INVALID_METADATA_OUTPUT");
  try {
    if (lstatSync(file).isSymbolicLink())
      throw Error("INVALID_METADATA_OUTPUT");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  writeFileSync(
    file,
    metadata
      ? "// Generated deployment identity only. Never copy secrets here.\nexport const deploymentMetadata = Object.freeze(" +
          JSON.stringify(metadata) +
          ");\n"
      : EMPTY_METADATA,
  );
  return metadata;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    writeDeploymentMetadata(fileURLToPath(new URL("../", import.meta.url)));
    console.log("DEPLOYMENT_METADATA_READY");
  } catch {
    console.error("DEPLOYMENT_METADATA_FAILED");
    process.exitCode = 1;
  }
}
