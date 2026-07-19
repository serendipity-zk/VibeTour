const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  getSkillTarget,
  installSkillDirectory
} = require('../skillInstaller');

test('maps Codex and Claude Code scopes to their documented skill directories', () => {
  const workspaceRoot = path.join(path.sep, 'work', 'demo');
  const homeDirectory = path.join(path.sep, 'home', 'demo');

  assert.equal(
    getSkillTarget('codex', 'workspace', { workspaceRoot, homeDirectory }),
    path.join(workspaceRoot, '.agents', 'skills', 'generate-code-lesson')
  );
  assert.equal(
    getSkillTarget('codex', 'user', { workspaceRoot, homeDirectory }),
    path.join(homeDirectory, '.agents', 'skills', 'generate-code-lesson')
  );
  assert.equal(
    getSkillTarget('claude-code', 'workspace', { workspaceRoot, homeDirectory }),
    path.join(workspaceRoot, '.claude', 'skills', 'generate-code-lesson')
  );
  assert.equal(
    getSkillTarget('claude-code', 'user', { workspaceRoot, homeDirectory }),
    path.join(homeDirectory, '.claude', 'skills', 'generate-code-lesson')
  );
});

test('installs and atomically replaces a bundled skill directory', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibetour-skill-test-'));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  const source = path.join(temporaryRoot, 'source');
  const target = path.join(temporaryRoot, 'target', 'generate-code-lesson');
  await fs.mkdir(path.join(source, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), 'version one\n');
  await fs.writeFile(path.join(source, 'scripts', 'validate.py'), 'pass\n');

  const first = await installSkillDirectory(source, target);
  assert.equal(first.installed, true);
  assert.equal(first.replaced, false);
  assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), 'version one\n');

  await fs.writeFile(path.join(target, 'stale.txt'), 'remove me\n');
  await fs.writeFile(path.join(source, 'SKILL.md'), 'version two\n');

  const skipped = await installSkillDirectory(source, target);
  assert.equal(skipped.installed, false);
  assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), 'version one\n');

  const replaced = await installSkillDirectory(source, target, { replace: true });
  assert.equal(replaced.installed, true);
  assert.equal(replaced.replaced, true);
  assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), 'version two\n');
  await assert.rejects(fs.access(path.join(target, 'stale.txt')));
});
