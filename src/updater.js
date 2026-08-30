'use strict';
/**
 * Pull updates from the repository the widget was installed from.
 *
 * The rule that matters: an update that breaks the tests is undone. Fetching
 * and restarting is easy; leaving someone with a dead widget and no way back
 * is the failure mode worth engineering against, so the previous commit is
 * recorded, the suite is run before the restart, and a failure rolls back.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BRANCH = 'main';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
        resolve(String(stdout).trim());
      });
  });
}

// --- Pure helpers, so the interesting decisions are testable ------------------

/** What GitHub answered, reduced to what we display. */
function parseRemote(json) {
  if (!json || !json.sha) return null;
  const commit = json.commit || {};
  return {
    sha: json.sha,
    short: json.sha.slice(0, 7),
    date: (commit.author && commit.author.date) || null,
    message: String(commit.message || '').split('\n')[0]
  };
}

/**
 * @returns {'up-to-date'|'available'|'unknown'} plus what to show.
 * An unknown local revision is not an update: it is a checkout we cannot read,
 * and offering to overwrite it would be worse than saying nothing.
 */
function compare(localSha, remote) {
  if (!remote || !remote.sha) return { state: 'unknown', remote: null };
  if (!localSha) return { state: 'unknown', remote };
  if (localSha === remote.sha) return { state: 'up-to-date', remote };
  return { state: 'available', remote };
}

/** Accept the common HTTPS and SSH GitHub remote forms, nothing else. */
function parseGitHubRepo(remoteUrl) {
  const value = String(remoteUrl || '').trim().replace(/\/$/, '').replace(/\.git$/, '');
  const match = value.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+)$/i
  );
  if (!match || !/^[A-Za-z0-9_.-]+$/.test(match[1]) ||
      !/^[A-Za-z0-9_.-]+$/.test(match[2])) return null;
  return `${match[1]}/${match[2]}`;
}

// --- Git side ----------------------------------------------------------------

const isGitCheckout = (dir) => fs.existsSync(path.join(dir, '.git'));

async function localSha(dir) {
  try { return await run('git', ['-C', dir, 'rev-parse', 'HEAD']); } catch (_) { return null; }
}

/** Uncommitted work means someone is editing this copy: never overwrite it. */
async function isDirty(dir) {
  try { return (await run('git', ['-C', dir, 'status', '--porcelain'])).length > 0; }
  catch (_) { return true; }
}

async function originRepo(dir) {
  try {
    return parseGitHubRepo(await run('git', ['-C', dir, 'remote', 'get-url', 'origin']));
  } catch (_) {
    return null;
  }
}

function fetchRemote(repo) {
  if (!repo) return Promise.resolve(null);
  const [owner, name] = repo.split('/').map(encodeURIComponent);
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.request({
      host: 'api.github.com',
      path: `/repos/${owner}/${name}/commits/${BRANCH}`,
      headers: { 'User-Agent': 'marge-ai-widget', Accept: 'application/vnd.github+json' },
      timeout: 12000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(parseRemote(JSON.parse(body))); } catch (_) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function check(dir) {
  if (!isGitCheckout(dir)) return { state: 'not-a-checkout', remote: null };
  const repo = await originRepo(dir);
  if (!repo) return { state: 'unknown', remote: null, local: await localSha(dir) };
  const [local, remote] = await Promise.all([localSha(dir), fetchRemote(repo)]);
  const result = compare(local, remote);
  return { ...result, repo, local, localShort: local ? local.slice(0, 7) : null };
}

// --- Applying ----------------------------------------------------------------

/**
 * Build the PATH a launchd service needs to run npm.
 *
 * Finding npm is not enough: npm is a script whose first line is
 * `#!/usr/bin/env node`, so running it without node on the PATH fails with
 * "env: node: No such file or directory". Both live in the same place on a
 * Homebrew or nvm install, but not always, so both are looked up.
 */
function pathWith(npmPath, nodePath, currentPath) {
  const dirs = [npmPath, nodePath]
    .filter(Boolean)
    .map((p) => path.dirname(p))
    .filter((d, i, all) => all.indexOf(d) === i && !(currentPath || '').split(':').includes(d));
  return dirs.concat(currentPath || '').filter(Boolean).join(':');
}

/** npm and node live outside a launchd PATH, so ask a login shell where they are. */
async function findNpm() {
  const ask = async (what) => {
    try { return (await run('/bin/sh', ['-lc', `command -v ${what}`], { timeout: 20000 })) || null; }
    catch (_) { return null; }
  };
  const npm = await ask('npm');
  if (!npm) return null;
  const node = await ask('node');
  return { npm, env: { ...process.env, PATH: pathWith(npm, node, process.env.PATH) } };
}

function runtimeExecutable(runtimeDir, platform = process.platform) {
  const suffix = platform === 'darwin'
    ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
    : 'electron';
  return path.join(runtimeDir, 'node_modules', 'electron', 'dist', suffix);
}

async function prepareRuntime(dir, npm, execPath) {
  const live = path.join(dir, 'install', 'runtime');
  const staging = fs.mkdtempSync(path.join(path.dirname(live), '.runtime-update-'));
  try {
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(live, file), path.join(staging, file));
    }
    await run(npm.npm, [
      'ci', '--prefix', staging, '--foreground-scripts',
      '--no-audit', '--no-fund', '--silent'
    ], { cwd: dir, env: npm.env });

    const binary = runtimeExecutable(staging);
    const verify = () => run(binary, ['-e', 'process.exit(0)'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000
    });
    try {
      await verify();
    } catch (_) {
      await run(execPath, [path.join(staging, 'node_modules', 'electron', 'install.js')], {
        cwd: path.join(staging, 'node_modules', 'electron'),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      });
      await verify();
    }
    return { live, staging, binary };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function replaceRuntime(live, staging) {
  const current = path.join(live, 'node_modules');
  const incoming = path.join(staging, 'node_modules');
  const backup = `${current}.rollback-${process.pid}`;
  if (!fs.existsSync(incoming) || fs.existsSync(backup)) {
    throw new Error('Runtime swap is not safe');
  }
  if (fs.existsSync(current)) fs.renameSync(current, backup);
  try {
    fs.renameSync(incoming, current);
  } catch (error) {
    if (fs.existsSync(backup)) fs.renameSync(backup, current);
    throw error;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  fs.rmSync(staging, { recursive: true, force: true });
}

/**
 * Run the test suite with whatever runtime we have. Electron doubles as Node
 * when told to, which keeps this working on a machine where node itself is not
 * on the service's PATH.
 */
async function runTests(dir, execPath) {
  const files = fs.readdirSync(path.join(dir, 'test')).filter((f) => f.endsWith('.test.js'));
  for (const file of files) {
    await run(execPath, [path.join('test', file)], {
      cwd: dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MARGE_STATE_FILE: '' }
    });
  }
  return files.length;
}

/**
 * Fetch, install, test, and report. Rolls back to the previous commit if the
 * suite fails, so a bad push can never leave a broken widget behind.
 * @param {(step: string) => void} onStep
 */
async function apply(dir, execPath, onStep = () => {}) {
  if (!isGitCheckout(dir)) return { ok: false, reason: 'not-a-checkout' };
  if (!await originRepo(dir)) return { ok: false, reason: 'unsupported-remote' };
  if (await isDirty(dir)) return { ok: false, reason: 'dirty' };

  const previous = await localSha(dir);
  let prepared = null;
  try {
    onStep('fetching');
    await run('git', ['-C', dir, 'fetch', '--quiet', 'origin', BRANCH]);
    await run('git', ['-C', dir, 'reset', '--quiet', '--hard', `origin/${BRANCH}`]);

    const updated = await localSha(dir);
    if (updated === previous) return { ok: true, changed: false, sha: updated };

    onStep('installing');
    const npm = await findNpm();
    if (!npm) throw new Error('npm was not found');
    prepared = await prepareRuntime(dir, npm, execPath);

    onStep('testing');
    await runTests(dir, prepared.binary);
    replaceRuntime(prepared.live, prepared.staging);
    prepared = null;

    return { ok: true, changed: true, sha: updated, short: updated.slice(0, 7) };
  } catch (err) {
    onStep('rolling-back');
    if (prepared && fs.existsSync(prepared.staging)) {
      fs.rmSync(prepared.staging, { recursive: true, force: true });
    }
    try {
      if (previous) await run('git', ['-C', dir, 'reset', '--quiet', '--hard', previous]);
    } catch (_) {
      // Nothing left to try; the caller reports the failure rather than pretend.
    }
    return { ok: false, reason: 'failed', detail: String(err.stderr || err.message).slice(0, 400) };
  }
}

module.exports = {
  BRANCH,
  parseRemote, compare, isGitCheckout, localSha, isDirty,
  parseGitHubRepo, originRepo, fetchRemote, check, apply, runTests, findNpm, pathWith,
  runtimeExecutable, replaceRuntime
};
