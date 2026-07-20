const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
  }

  toString() {
    return `file://${this.fsPath}`;
  }

  static joinPath(base, ...parts) {
    return new Uri(path.join(base.fsPath, ...parts));
  }
}

class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

const workspaceRoot = path.resolve(__dirname, '../demo-workspace');
const lessonUri = new Uri(
  path.join(workspaceRoot, '.code-lessons/walkthroughs/request-lifecycle.yaml')
);
const folder = { name: 'demo-workspace', uri: new Uri(workspaceRoot) };
const discovery = {
  folders: [folder],
  uris: [lessonUri]
};
const fakeVscode = {
  Uri,
  Range,
  Diagnostic,
  DiagnosticSeverity: { Error: 0 },
  RelativePattern: class RelativePattern {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  workspace: {
    get workspaceFolders() {
      return discovery.folders;
    },
    getConfiguration() {
      return { get: (name, fallback) => fallback };
    },
    async findFiles(pattern) {
      const extension = pattern.pattern.endsWith('.yaml') ? '.yaml' : '.yml';
      return discovery.uris.filter((uri) => uri.fsPath.endsWith(extension));
    },
    async openTextDocument(uri) {
      return { getText: () => fs.readFileSync(uri.fsPath, 'utf8') };
    },
    fs: {
      async readFile(uri) {
        return fs.promises.readFile(uri.fsPath);
      }
    }
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') {
    return fakeVscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  DEFAULT_SEARCH_PATHS,
  getLessonRoot,
  loadLessons,
  normalizeLesson
} = require('../lessonLoader');
Module._load = originalLoad;

function createDiagnostics() {
  const values = new Map();
  return {
    values,
    clear: () => values.clear(),
    delete: (uri) => values.delete(uri.toString()),
    set: (uri, diagnostics) => values.set(uri.toString(), diagnostics)
  };
}

test('discovers, parses, and validates the demo lesson', async () => {
  const diagnostics = createDiagnostics();
  const result = await loadLessons(diagnostics);

  assert.equal(result.errorCount, 0);
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].title, 'Request Lifecycle');
  assert.equal(result.lessons[0].rootUri.fsPath, workspaceRoot);
  assert.equal(result.lessons[0].rootLabel, 'demo-workspace');
  assert.equal(result.lessons[0].chapters.length, 2);
  assert.equal(
    result.lessons[0].chapters.flatMap((chapter) => chapter.steps).length,
    4
  );
  assert.equal(diagnostics.values.size, 0);
});

test('uses recursive default search paths for nested lesson directories', () => {
  assert.deepEqual(DEFAULT_SEARCH_PATHS, [
    '**/.code-lessons/**/*.yaml',
    '**/.code-lessons/**/*.yml'
  ]);
});

test('derives the lesson root from the nearest .code-lessons parent', () => {
  const nestedSource = new Uri(path.join(
    workspaceRoot,
    'services/api/.code-lessons/walkthroughs/auth.yaml'
  ));

  const root = getLessonRoot(folder, nestedSource);

  assert.equal(root.uri.fsPath, path.join(workspaceRoot, 'services/api'));
  assert.equal(root.relativePath, 'services/api');
  assert.equal(root.label, 'demo-workspace/services/api');
});

test('discovers independent nested lesson roots and resolves their files locally', async (t) => {
  const temporaryWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetour-lessons-'));
  const temporaryFolder = {
    name: 'multi-repo',
    uri: new Uri(temporaryWorkspace)
  };
  const repositories = ['services/api', 'services/web'];
  const nestedLessonUris = [];

  for (const repository of repositories) {
    const repositoryRoot = path.join(temporaryWorkspace, repository);
    const sourcePath = path.join(repositoryRoot, 'src/value.js');
    const yamlPath = path.join(
      repositoryRoot,
      '.code-lessons/walkthroughs/overview.yaml'
    );
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
    fs.writeFileSync(sourcePath, `module.exports = '${repository}';\n`);
    fs.writeFileSync(yamlPath, [
      'schema_version: 1',
      'lesson:',
      '  id: shared-overview',
      `  title: ${repository} overview`,
      '  chapters:',
      '    - id: introduction',
      '      title: Introduction',
      '      steps:',
      '        - id: inspect-value',
      '          title: Inspect the local value',
      '          explanation: "**This value belongs to this repository.**"',
      '          primary:',
      '            file: src/value.js',
      '            range:',
      '              start_line: 1',
      '              end_line: 1',
      ''
    ].join('\n'));
    nestedLessonUris.push(new Uri(yamlPath));
  }

  const previousFolders = discovery.folders;
  const previousUris = discovery.uris;
  discovery.folders = [temporaryFolder];
  discovery.uris = nestedLessonUris;
  t.after(() => {
    discovery.folders = previousFolders;
    discovery.uris = previousUris;
    fs.rmSync(temporaryWorkspace, { recursive: true, force: true });
  });

  const diagnostics = createDiagnostics();
  const result = await loadLessons(diagnostics);
  const lessonsByRoot = new Map(
    result.lessons.map((lesson) => [lesson.rootRelativePath, lesson])
  );

  assert.equal(result.errorCount, 0);
  assert.equal(result.lessons.length, 2);
  assert.equal(diagnostics.values.size, 0);
  assert.equal(new Set(result.lessons.map((lesson) => lesson.key)).size, 2);
  for (const repository of repositories) {
    const lesson = lessonsByRoot.get(repository);
    assert.ok(lesson);
    assert.equal(lesson.id, 'shared-overview');
    assert.equal(lesson.rootUri.fsPath, path.join(temporaryWorkspace, repository));
    assert.equal(lesson.rootLabel, `multi-repo/${repository}`);
    assert.equal(lesson.chapters[0].steps[0].file, 'src/value.js');
  }
});

test('rejects code paths that escape the lesson root', () => {
  const YAML = require('yaml');
  const data = YAML.parse(fs.readFileSync(lessonUri.fsPath, 'utf8'));
  data.lesson.chapters[0].steps[0].primary.file = '../outside.py';

  assert.throws(
    () => normalizeLesson(data, folder, lessonUri),
    /must stay inside its lesson root/
  );
});
