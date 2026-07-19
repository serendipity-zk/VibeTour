const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SKILL_NAME = 'generate-code-lesson';

const HARNESS_CONFIG = Object.freeze({
  codex: Object.freeze({
    label: 'Codex / .agents',
    workspaceDirectory: path.join('.agents', 'skills'),
    userDirectory: path.join('.agents', 'skills')
  }),
  'claude-code': Object.freeze({
    label: 'Claude Code',
    workspaceDirectory: path.join('.claude', 'skills'),
    userDirectory: path.join('.claude', 'skills')
  })
});

function getSkillTarget(harness, scope, options = {}) {
  const config = HARNESS_CONFIG[harness];
  if (!config) {
    throw new Error(`Unsupported coding agent: ${harness}`);
  }
  if (scope !== 'workspace' && scope !== 'user') {
    throw new Error(`Unsupported installation scope: ${scope}`);
  }

  const root = scope === 'workspace'
    ? options.workspaceRoot
    : options.homeDirectory || os.homedir();
  if (!root) {
    throw new Error(
      scope === 'workspace'
        ? 'A workspace folder is required for a workspace installation.'
        : 'Unable to determine the current user home directory.'
    );
  }

  const skillsDirectory = scope === 'workspace'
    ? config.workspaceDirectory
    : config.userDirectory;
  return path.join(root, skillsDirectory, SKILL_NAME);
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function installSkillDirectory(sourceDirectory, targetDirectory, options = {}) {
  const source = await fs.stat(sourceDirectory);
  if (!source.isDirectory()) {
    throw new Error(`Bundled skill is not a directory: ${sourceDirectory}`);
  }

  const existed = await pathExists(targetDirectory);
  if (existed && !options.replace) {
    return { installed: false, replaced: false, targetDirectory };
  }

  const parentDirectory = path.dirname(targetDirectory);
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingDirectory = path.join(parentDirectory, `.${SKILL_NAME}.vibetour-${nonce}`);
  const backupDirectory = path.join(parentDirectory, `.${SKILL_NAME}.backup-${nonce}`);

  await fs.mkdir(parentDirectory, { recursive: true });
  await fs.cp(sourceDirectory, stagingDirectory, { recursive: true, force: true });

  try {
    if (existed) {
      await fs.rename(targetDirectory, backupDirectory);
    }
    await fs.rename(stagingDirectory, targetDirectory);
    if (existed) {
      await fs.rm(backupDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    if (existed && await pathExists(backupDirectory)) {
      if (await pathExists(targetDirectory)) {
        await fs.rm(targetDirectory, { recursive: true, force: true });
      }
      await fs.rename(backupDirectory, targetDirectory);
    }
    throw error;
  }

  return { installed: true, replaced: existed, targetDirectory };
}

module.exports = {
  HARNESS_CONFIG,
  SKILL_NAME,
  getSkillTarget,
  installSkillDirectory,
  pathExists
};
