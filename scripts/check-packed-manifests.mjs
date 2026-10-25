#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function npmTarballName(name, version) {
  return `${name.replace(/^@/, "").replace(/\//g, "-")}-${version}.tgz`;
}

function findWorkspaceDirs() {
  return [
    "packages/protocol",
    "packages/agent-sessions",
    "packages/runtime",
    "packages/cli",
    "packages/pairing",
    "packages/session-trace",
  ]
    .map((relativePath) => path.join(repoRoot, relativePath))
    .filter((dir) => existsSync(path.join(dir, "package.json")))
    .filter((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      return pkg.private !== true;
    });
}

// This reviewed install surface is intentionally smaller than the build graph.
// Bundled source inputs belong in CLI devDependencies, not npm dependencies.
export const SCOUT_INSTALL_DEPENDENCIES = Object.freeze({
  "@lydell/node-pty": "1.2.0-beta.12",
  "bonjour-service": "^1.4.4",
  "picomatch": "^4.0.4",
  "reflect-metadata": "0.2.2",
  "ws": "^8.18.3",
});
export const PUBLISHED_WORKSPACE_PACKAGES = Object.freeze([
  "@openscout/protocol", "@openscout/scout",
]);

/** Audit the manifest extracted from the tarball, after workspace normalization. */
export function findPublishDependencyFailures(pkg) {
  if (pkg.name !== "@openscout/scout") return [];
  const failures = [];
  const deps = pkg.dependencies;
  if (!deps || typeof deps !== "object" || Array.isArray(deps)) {
    return ["dependencies must match the reviewed Scout install policy"];
  }
  for (const [name, range] of Object.entries(deps)) {
    if (!Object.hasOwn(SCOUT_INSTALL_DEPENDENCIES, name)) {
      const unpublished = name.startsWith("@openscout/") && !PUBLISHED_WORKSPACE_PACKAGES.includes(name)
        ? "; workspace package is outside the publish set (protocol, cli)" : "";
      failures.push(`unreviewed dependencies.${name}=${range}${unpublished}`);
    } else if (range !== SCOUT_INSTALL_DEPENDENCIES[name]) {
      failures.push(`dependencies.${name}=${range}; reviewed range is ${SCOUT_INSTALL_DEPENDENCIES[name]}`);
    }
  }
  for (const name of Object.keys(SCOUT_INSTALL_DEPENDENCIES)) {
    if (!Object.hasOwn(deps, name)) failures.push(`missing reviewed dependencies.${name}`);
  }
  // A peer, optional or bundled edge must not bypass the reviewed install list.
  for (const section of ["peerDependencies", "optionalDependencies"]) {
    if (pkg[section] && Object.keys(pkg[section]).length > 0) {
      failures.push(`unreviewed ${section}; Scout install policy has no ${section}`);
    }
  }
  for (const section of ["bundleDependencies", "bundledDependencies"]) {
    if (pkg[section] === true || (Array.isArray(pkg[section]) && pkg[section].length > 0)) {
      failures.push(`unreviewed ${section}; Scout install policy has no bundled dependencies`);
    }
  }
  return failures;
}

function findWorkspaceLeaks(pkg) {
  const leaks = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!deps) {
      continue;
    }

    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        leaks.push(`${section}.${name}=${range}`);
      }
    }
  }

  return leaks;
}

// Files that MUST be present in a package's tarball. Keyed by package name.
// @openscout/scout ships the prebuilt scoutd broker service binary; if it is
// missing, npm-installed users hit "Unable to locate scoutd" for every broker
// operation (resolveScoutdCommand in broker-process-manager.ts).

const REQUIRED_PACKED_FILES = {
  "@openscout/scout": [
    "package/bin/scoutd",
    "package/dist/main.mjs",
    "package/dist/pairing-runtime-controller.mjs",
    "package/dist/knowledge-index-child.mjs",
  ],
};

const FORBIDDEN_PACKED_PREFIXES = {
  "@openscout/scout": [
    "package/apps/", "package/packages/web/", "package/dist/client/",
    "package/dist/scout-control-plane-web.mjs", "package/dist/scout-web-server.mjs",
    "package/dist/openscout-terminal-relay.mjs",
  ],
};

// Keep the reviewed total ceilings; removal does not authorize future growth.
const PACKED_FOOTPRINT_BUDGETS = {
  "@openscout/scout": {
    maxPackedBytes: 26_000_000,
    maxUnpackedBytes: 60_000_000,
    maxFileCount: 670,
  },
};

const PACKED_FILE_BUDGETS = {};

function parseTarOctal(field, label) {
  const value = field.toString("ascii").replace(/\0.*$/s, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`Unsupported tar ${label}: ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value, 8);
}

export function readTarballFootprint(tarballPath) {
  const archive = gunzipSync(readFileSync(tarballPath));
  const fileSizes = new Map();
  let unpackedBytes = 0;
  let fileCount = 0;
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = parseTarOctal(header.subarray(124, 136), `size for ${entryPath}`);
    const type = header[156];
    if (type === 0 || type === 48) {
      fileCount += 1;
      unpackedBytes += size;
      fileSizes.set(entryPath, size);
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return {
    packedBytes: statSync(tarballPath).size,
    unpackedBytes,
    fileCount,
    fileSizes,
  };
}

export function findFootprintFailures(packageName, footprint) {
  const failures = [];
  const budget = PACKED_FOOTPRINT_BUDGETS[packageName];
  if (budget) {
    if (footprint.packedBytes > budget.maxPackedBytes) {
      failures.push(
        `packed size ${footprint.packedBytes.toLocaleString("en-US")} exceeds ${budget.maxPackedBytes.toLocaleString("en-US")} bytes`,
      );
    }
    if (footprint.unpackedBytes > budget.maxUnpackedBytes) {
      failures.push(
        `unpacked size ${footprint.unpackedBytes.toLocaleString("en-US")} exceeds ${budget.maxUnpackedBytes.toLocaleString("en-US")} bytes`,
      );
    }
    if (footprint.fileCount > budget.maxFileCount) {
      failures.push(`file count ${footprint.fileCount} exceeds ${budget.maxFileCount}`);
    }
  }

  for (const [entryPath, maxBytes] of Object.entries(PACKED_FILE_BUDGETS[packageName] ?? {})) {
    const observedBytes = footprint.fileSizes.get(entryPath);
    if (observedBytes !== undefined && observedBytes > maxBytes) {
      failures.push(
        `${entryPath} is ${observedBytes.toLocaleString("en-US")} bytes; compatibility entry must not exceed ${maxBytes.toLocaleString("en-US")} bytes`,
      );
    }
  }
  return failures;
}

function listTarballEntries(tarballPath, packageDir) {
  return execFileSync("tar", ["-tzf", tarballPath], {
    cwd: packageDir,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Reject departed app artifacts and source modules in the exact packed candidate. */
export function findCorePackedFilesFailures(entries, readEntry) {
  const failures = [];
  const forbidden = FORBIDDEN_PACKED_PREFIXES["@openscout/scout"];
  for (const entry of entries) {
    if (forbidden.some(prefix => entry.startsWith(prefix))) failures.push("App artifact returned: " + entry);
    if (/\.(?:mjs|cjs|js)$/.test(entry)) {
      const source = readEntry(entry);
      if (/^\/\/[ \t]+(?:\S*\/)?(?:packages\/web\/|apps\/desktop\/|\.\.\/web\/)\S+\.[cm]?[jt]sx?$/m.test(source)) {
        failures.push("App source returned in bundle: " + entry);
      }
    }
  }
  return failures;
}

function auditTarball(tarballPath, packageDir = repoRoot) {
  const packedManifestText = execFileSync(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    {
      cwd: packageDir,
      encoding: "utf8",
    },
  );
  const pkg = JSON.parse(packedManifestText);
  const entries = listTarballEntries(tarballPath, packageDir);
  const footprint = readTarballFootprint(tarballPath);
  const missingFiles = (REQUIRED_PACKED_FILES[pkg.name] ?? []).filter(
    (required) => !entries.includes(required),
  );
  const forbiddenFiles = entries.filter((entry) =>
    (FORBIDDEN_PACKED_PREFIXES[pkg.name] ?? []).some((prefix) => entry.startsWith(prefix)),
  );

  return {
    name: pkg.name,
    leaks: findWorkspaceLeaks(pkg),
    dependencyFailures: findPublishDependencyFailures(pkg),
    missingFiles,
    forbiddenFiles,
    footprint,
    footprintFailures: findFootprintFailures(pkg.name, footprint),
    coreBoundaryFailures: pkg.name === "@openscout/scout"
      ? findCorePackedFilesFailures(entries, (entry) => execFileSync("tar", ["-xOf", tarballPath, entry], {
          cwd: packageDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        }))
      : [],
    tarballPath,
  };
}

async function inspectPackedManifest(packageDir, tempDir) {
  const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
  const tarballPath = path.join(tempDir, npmTarballName(pkg.name, pkg.version));
  const npmCache = process.env.npm_config_cache || path.join(os.tmpdir(), "openscout-npm-cache");
  await fs.mkdir(npmCache, { recursive: true });

  execFileSync("npm", ["pack", "--pack-destination", tempDir], {
    cwd: packageDir,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
    },
    stdio: "inherit",
  });

  return auditTarball(tarballPath, packageDir);
}

function reportFailures(results) {
  const failures = results.filter((result) =>
    result.dependencyFailures.length > 0
    || result.leaks.length > 0
    || result.missingFiles.length > 0
    || result.forbiddenFiles.length > 0
    || result.footprintFailures.length > 0
    || result.coreBoundaryFailures.length > 0
  );
  for (const result of results) {
    if (PACKED_FOOTPRINT_BUDGETS[result.name]) {
      console.log(
        `${result.name} footprint: ${result.footprint.packedBytes.toLocaleString("en-US")} packed bytes, ${result.footprint.unpackedBytes.toLocaleString("en-US")} unpacked bytes, ${result.footprint.fileCount} files`,
      );
    }
  }
  for (const failure of failures) {
    if (failure.dependencyFailures.length > 0) {
      console.error(`${failure.name} violates the reviewed packed dependency policy:`);
      for (const error of failure.dependencyFailures) console.error(`  - ${error}`);
    }
    if (failure.leaks.length > 0) {
      console.error(`${failure.name} packed with workspace dependencies:`);
      for (const leak of failure.leaks) console.error(`  - ${leak}`);
    }
    if (failure.missingFiles.length > 0) {
      console.error(`${failure.name} is missing required packed files:`);
      for (const missing of failure.missingFiles) console.error(`  - ${missing}`);
    }
    if (failure.forbiddenFiles.length > 0) {
      console.error(`${failure.name} contains private product assets:`);
      for (const forbidden of failure.forbiddenFiles) console.error(`  - ${forbidden}`);
    }
    if (failure.coreBoundaryFailures.length > 0) {
      console.error(`${failure.name} violates the core-only package boundary:`);
      for (const error of failure.coreBoundaryFailures) console.error(`  - ${error}`);
    }
    if (failure.footprintFailures.length > 0) {
      console.error(`${failure.name} exceeds its reviewed package footprint:`);
      for (const footprintFailure of failure.footprintFailures) {
        console.error(`  - ${footprintFailure}`);
      }
    }
  }
  return failures.length;
}

async function main() {
  // Manifest-only inspection does not build native artifacts or certify a full
  // release archive. The regular --tarball/default audits enforce this too.
  if (process.argv[2] === "--publish-dependencies") {
    if (process.argv.length !== 4) throw new Error("--publish-dependencies requires one exact tarball");
    const tarball = path.resolve(process.argv[3]);
    const pkg = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    console.log(JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: pkg.dependencies }, null, 2));
    const failures = [...findWorkspaceLeaks(pkg), ...findPublishDependencyFailures(pkg)];
    if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
    else console.log("Packed dependency policy passed (manifest-only; not a full archive audit).");
    return;
  }
  if (process.argv[2] === "--tarball") {
    const tarballs = process.argv.slice(3).map((value) => path.resolve(value));
    if (tarballs.length === 0) {
      throw new Error("--tarball requires at least one exact candidate path");
    }
    process.exitCode = reportFailures(tarballs.map((tarball) => auditTarball(tarball))) > 0
      ? 1
      : 0;
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openscout-pack-check-"));

  try {
    const results = [];

    for (const packageDir of findWorkspaceDirs()) {
      results.push(await inspectPackedManifest(packageDir, tempDir));
    }

    if (reportFailures(results) > 0) {
      process.exitCode = 1;
      return;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
