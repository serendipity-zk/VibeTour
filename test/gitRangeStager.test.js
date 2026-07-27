const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const {
  getCachedDiff,
  prepareRangeStaging,
  removeIntentToAdd,
  runGit,
  stageIntentToAddRange
} = require('../gitRangeStager');

const execFileAsync = promisify(execFile);

test('prepares and cleans up an untracked file in an unborn repository', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetour-git-range-'));
  try {
    await execFileAsync('git', ['init', '--quiet', repositoryRoot]);
    const filePath = path.join(repositoryRoot, 'src', 'example.js');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'const first = 1;\nconst second = 2;\n');

    const prepared = await prepareRangeStaging('git', repositoryRoot, filePath);
    assert.equal(prepared.relativePath, 'src/example.js');
    assert.equal(prepared.addedIntentToAdd, true);

    const unstagedDiff = await runGit('git', repositoryRoot, [
      'diff',
      '--no-color',
      '--',
      prepared.relativePath
    ]);
    assert.match(unstagedDiff, /\+const first = 1;/);
    assert.equal(
      await getCachedDiff('git', repositoryRoot, prepared.relativePath),
      ''
    );

    await runGit('git', repositoryRoot, ['add', '--', prepared.relativePath]);
    assert.match(
      await getCachedDiff('git', repositoryRoot, prepared.relativePath),
      /\+const second = 2;/
    );

    await removeIntentToAdd('git', repositoryRoot, prepared.relativePath);
    const indexEntries = await runGit('git', repositoryRoot, [
      'ls-files',
      '--stage',
      '--',
      prepared.relativePath
    ]);
    assert.equal(indexEntries, '');
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('does not alter the index entry for a tracked file', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetour-git-range-'));
  try {
    await execFileAsync('git', ['init', '--quiet', repositoryRoot]);
    const filePath = path.join(repositoryRoot, 'tracked.js');
    await fs.writeFile(filePath, 'const value = 1;\n');
    await execFileAsync('git', ['-C', repositoryRoot, 'add', 'tracked.js']);

    const before = await runGit('git', repositoryRoot, [
      'ls-files',
      '--stage',
      '--',
      'tracked.js'
    ]);
    const prepared = await prepareRangeStaging('git', repositoryRoot, filePath);
    const after = await runGit('git', repositoryRoot, [
      'ls-files',
      '--stage',
      '--',
      'tracked.js'
    ]);

    assert.equal(prepared.addedIntentToAdd, false);
    assert.equal(after, before);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('stages only the reviewed range from a fresh untracked file', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetour-git-range-'));
  try {
    await execFileAsync('git', ['init', '--quiet', repositoryRoot]);
    const filePath = path.join(repositoryRoot, 'README.md');
    const text = [
      '# Demo',
      '',
      'outside before',
      'reviewed first',
      'reviewed second',
      'outside after',
      ''
    ].join('\n');
    await fs.writeFile(filePath, text);

    const prepared = await prepareRangeStaging('git', repositoryRoot, filePath);
    assert.equal(prepared.addedIntentToAdd, true);

    const staged = await stageIntentToAddRange(
      'git',
      repositoryRoot,
      prepared.relativePath,
      text,
      4,
      5
    );

    assert.equal(staged, true);
    const stagedFile = await runGit('git', repositoryRoot, [
      'show',
      `:${prepared.relativePath}`
    ]);
    assert.equal(stagedFile, 'reviewed first\nreviewed second\n');

    const cachedDiff = await getCachedDiff(
      'git',
      repositoryRoot,
      prepared.relativePath
    );
    assert.match(cachedDiff, /\+reviewed first/);
    assert.doesNotMatch(cachedDiff, /\+outside before/);
    assert.doesNotMatch(cachedDiff, /\+outside after/);

    const worktreeFile = await fs.readFile(filePath, 'utf8');
    assert.equal(worktreeFile, text);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});
