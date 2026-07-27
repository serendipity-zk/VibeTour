const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

class EventEmitter {
  constructor() {
    this.event = () => {};
  }

  fire() {}
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class MarkdownString {
  constructor(value) {
    this.value = value;
  }
}

const fakeVscode = {
  EventEmitter,
  MarkdownString,
  ThemeIcon,
  TreeItem,
  TreeItemCheckboxState: {
    Checked: 1,
    Unchecked: 0
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') {
    return fakeVscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { LessonTreeProvider } = require('../extension');
Module._load = originalLoad;

function lesson(key, stepKeys) {
  return {
    key,
    title: key,
    description: `${key} description`,
    rootUri: { fsPath: `/workspace/${key}` },
    sourceUri: { fsPath: `/workspace/${key}/lesson.yaml` },
    chapters: [
      {
        key: `${key}-chapter`,
        title: `${key} chapter`,
        steps: stepKeys.map((stepKey) => ({
          key: stepKey,
          title: stepKey,
          explanation: `${stepKey} explanation`
        }))
      }
    ]
  };
}

test('groups completed lessons in a collapsed expandable folder', () => {
  const activeLesson = lesson('active', ['active-1', 'active-2']);
  const finishedLesson = lesson('finished', ['finished-1', 'finished-2']);
  const completed = new Set(['active-1', 'finished-1', 'finished-2']);
  const provider = new LessonTreeProvider(
    () => [activeLesson, finishedLesson],
    (stepKey) => completed.has(stepKey),
    () => false
  );

  const root = provider.getChildren();
  assert.equal(root.length, 2);
  assert.equal(root[0].kind, 'lesson');
  assert.equal(root[0].lesson, activeLesson);
  assert.equal(root[1].kind, 'finishedLessons');

  const folderItem = provider.getTreeItem(root[1]);
  assert.equal(folderItem.label, 'Finished Lessons');
  assert.equal(
    folderItem.collapsibleState,
    fakeVscode.TreeItemCollapsibleState.Collapsed
  );
  assert.equal(folderItem.description, '1');
  assert.equal(folderItem.iconPath.id, 'archive');

  const archivedLessons = provider.getChildren(root[1]);
  assert.equal(archivedLessons.length, 1);
  assert.equal(archivedLessons[0].lesson, finishedLesson);
  assert.equal(
    provider.getTreeItem(archivedLessons[0]).description,
    '2/2 · finished'
  );
});

test('moves a reset lesson back to the active root level', () => {
  const completedLesson = lesson('completed', ['step-1', 'step-2']);
  const completed = new Set(['step-1', 'step-2']);
  const provider = new LessonTreeProvider(
    () => [completedLesson],
    (stepKey) => completed.has(stepKey),
    () => false
  );

  assert.equal(provider.getChildren()[0].kind, 'finishedLessons');

  completed.delete('step-2');
  const root = provider.getChildren();
  assert.equal(root.length, 1);
  assert.equal(root[0].kind, 'lesson');
  assert.equal(root[0].lesson, completedLesson);
});
