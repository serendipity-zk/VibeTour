const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const lessonUri = new Uri(path.join(workspaceRoot, '.code-lessons/request-lifecycle.yaml'));
const folder = { name: 'demo-workspace', uri: new Uri(workspaceRoot) };
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
    workspaceFolders: [folder],
    getConfiguration() {
      return { get: (name, fallback) => fallback };
    },
    async findFiles(pattern) {
      return pattern.pattern.endsWith('.yaml') ? [lessonUri] : [];
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
const { loadLessons, normalizeLesson } = require('../lessonLoader');
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
  assert.equal(result.lessons[0].chapters.length, 2);
  assert.equal(
    result.lessons[0].chapters.flatMap((chapter) => chapter.steps).length,
    4
  );
  assert.equal(diagnostics.values.size, 0);
});

test('rejects code paths that escape the workspace', () => {
  const YAML = require('yaml');
  const data = YAML.parse(fs.readFileSync(lessonUri.fsPath, 'utf8'));
  data.lesson.chapters[0].steps[0].primary.file = '../outside.py';

  assert.throws(
    () => normalizeLesson(data, folder, lessonUri),
    /must stay inside its workspace folder/
  );
});
