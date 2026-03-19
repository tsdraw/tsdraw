import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// If any of the packages have been changes, the script will publish the packages if they have been changed.
// It also makes sure that the versions are correct and that the packages are published with the correct access level.
// It also makes sure that the packages are published with the correct provenance.

const repoRoot = process.cwd();
const isDryRun = process.argv.includes('--dry-run') || process.env.PUBLISH_DRY_RUN === '1';

const publishTargets = [
  { workspace: 'packages/tsdraw-core' },
  { workspace: 'packages/tsdraw-react' },
];

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function parseSemver(version) {
  const [coreVersion, prerelease = ''] = version.split('-', 2);
  const parts = coreVersion.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Unsupported semver value: ${version}`);
  }

  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    prerelease,
  };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);

  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function runNpmCommand(args, options = {}) {
  return execFileSync('npm', args, {
    cwd: repoRoot,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
  });
}

function getPublishedVersion(packageName) {
  try {
    const output = runNpmCommand(['view', packageName, 'version', '--json']);
    return JSON.parse(output);
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    const combinedOutput = `${stdout}\n${stderr}`;

    if (combinedOutput.includes('E404') || combinedOutput.includes('npm ERR! code E404')) {
      return null;
    }

    throw error;
  }
}

function publishWorkspace(workspace, packageName, packageVersion) {
  const publishArgs = ['publish', '--workspace', workspace, '--access', 'public', '--provenance'];

  if (isDryRun) {
    console.log(`[dry-run] npm ${publishArgs.join(' ')}`);
    return;
  }

  const result = spawnSync('npm', publishArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  if (result.status === 0) {
    return;
  }

  if (
    combinedOutput.includes('cannot publish over the previously published versions') ||
    combinedOutput.includes('You cannot publish over the previously published version')
  ) {
    console.log(`${packageName}@${packageVersion} is already published. Skipping.`);
    return;
  }

  throw new Error(`npm publish failed for ${packageName}@${packageVersion}`);
}

for (const target of publishTargets) {
  const packageJson = readJson(path.join(target.workspace, 'package.json'));
  const localName = packageJson.name;
  const localVersion = packageJson.version;
  const publishedVersion = getPublishedVersion(localName);

  if (!publishedVersion) {
    console.log(`${localName}@${localVersion} has not been published yet.`);
    publishWorkspace(target.workspace, localName, localVersion);
    continue;
  }

  const versionComparison = compareSemver(localVersion, publishedVersion);

  if (versionComparison < 0) {
    throw new Error(
      `${localName}@${localVersion} is behind the npm version ${publishedVersion}. Bump the local version before publishing.`
    );
  }

  if (versionComparison === 0) {
    console.log(`${localName}@${localVersion} is already published. Skipping.`);
    continue;
  }

  console.log(`${localName} will publish ${publishedVersion} -> ${localVersion}.`);
  publishWorkspace(target.workspace, localName, localVersion);
}
