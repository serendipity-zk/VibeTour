const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function relativeGitPath(repositoryRoot, filePath) {
  const relativePath = path.relative(repositoryRoot, filePath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('The lesson file is outside the detected Git repository.');
  }
  return relativePath.split(path.sep).join('/');
}

async function runGit(gitPath, repositoryRoot, args) {
  const { stdout } = await execFileAsync(
    gitPath,
    ['-C', repositoryRoot, ...args],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    }
  );
  return stdout;
}

async function runGitWithInput(gitPath, repositoryRoot, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(gitPath, ['-C', repositoryRoot, ...args], {
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      if (code === 0) {
        resolve(output);
        return;
      }
      const message = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(message || `Git exited with code ${code}.`));
    });
    child.stdin.end(input);
  });
}

async function hasIndexEntry(gitPath, repositoryRoot, relativePath) {
  const output = await runGit(gitPath, repositoryRoot, [
    'ls-files',
    '--stage',
    '-z',
    '--',
    relativePath
  ]);
  return output.length > 0;
}

async function prepareRangeStaging(gitPath, repositoryRoot, filePath) {
  const relativePath = relativeGitPath(repositoryRoot, filePath);
  const tracked = await hasIndexEntry(gitPath, repositoryRoot, relativePath);
  if (!tracked) {
    await runGit(gitPath, repositoryRoot, [
      'add',
      '--intent-to-add',
      '--',
      relativePath
    ]);
  }
  return {
    relativePath,
    addedIntentToAdd: !tracked
  };
}

async function getCachedDiff(gitPath, repositoryRoot, relativePath) {
  return runGit(gitPath, repositoryRoot, [
    'diff',
    '--cached',
    '--binary',
    '--no-ext-diff',
    '--no-color',
    '--',
    relativePath
  ]);
}

function extractLineRange(text, startLine, endLine) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineStarts.push(index + 1);
    }
  }

  const startOffset = lineStarts[startLine - 1];
  if (startOffset === undefined) {
    return '';
  }
  const endOffset = lineStarts[endLine] ?? text.length;
  return text.slice(startOffset, endOffset);
}

async function stageIntentToAddRange(
  gitPath,
  repositoryRoot,
  relativePath,
  text,
  startLine,
  endLine
) {
  const selectedText = extractLineRange(text, startLine, endLine);
  if (selectedText.length === 0) {
    return false;
  }

  const indexEntry = await runGit(gitPath, repositoryRoot, [
    'ls-files',
    '--stage',
    '--',
    relativePath
  ]);
  const mode = indexEntry.match(/^([0-7]{6})\s/)?.[1] || '100644';
  const objectId = (
    await runGitWithInput(
      gitPath,
      repositoryRoot,
      ['hash-object', '-w', '--stdin'],
      selectedText
    )
  ).trim();

  await runGit(gitPath, repositoryRoot, [
    'update-index',
    '--add',
    '--cacheinfo',
    `${mode},${objectId},${relativePath}`
  ]);
  return true;
}

async function removeIntentToAdd(gitPath, repositoryRoot, relativePath) {
  await runGit(gitPath, repositoryRoot, [
    'update-index',
    '--force-remove',
    '--',
    relativePath
  ]);
}

module.exports = {
  extractLineRange,
  getCachedDiff,
  prepareRangeStaging,
  relativeGitPath,
  removeIntentToAdd,
  runGit,
  stageIntentToAddRange
};
