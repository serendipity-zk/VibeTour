const vscode = require('vscode');
const { getSearchPaths, loadLessons } = require('./lessonLoader');

class LessonTreeProvider {
  constructor(getLessons, isComplete, isChapterActive) {
    this.getLessons = getLessons;
    this.isComplete = isComplete;
    this.isChapterActive = isChapterActive;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() {
    this.changed.fire();
  }

  getTreeItem(element) {
    if (element.kind === 'lesson') {
      const steps = element.lesson.chapters.flatMap((chapter) => chapter.steps);
      const completed = steps.filter((step) => this.isComplete(step.key)).length;
      const item = new vscode.TreeItem(
        element.lesson.title,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `code-lesson-${element.lesson.key}`;
      item.description = `${completed}/${steps.length}`;
      item.iconPath = new vscode.ThemeIcon('book');
      item.contextValue = 'codeLesson';
      item.tooltip = new vscode.MarkdownString(
        `${element.lesson.description || element.lesson.title}\n\n` +
        `Source: \`${element.lesson.sourceUri.fsPath}\``
      );
      return item;
    }

    if (element.kind === 'chapter') {
      const completed = element.chapter.steps.filter((step) => this.isComplete(step.key)).length;
      const active = this.isChapterActive(element.chapter.key);
      const item = new vscode.TreeItem(
        element.chapter.title,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `code-lesson-chapter-${element.chapter.key}`;
      item.description = `${completed}/${element.chapter.steps.length}${active ? ' · active' : ''}`;
      item.iconPath = new vscode.ThemeIcon(active ? 'debug-alt' : 'library');
      item.contextValue = 'codeLessonChapter';
      item.tooltip = 'Use Play to start or resume this chapter; use Reset to clear its progress.';
      return item;
    }

    const item = new vscode.TreeItem(
      element.step.title,
      vscode.TreeItemCollapsibleState.None
    );
    item.id = `code-lesson-step-${element.step.key}`;
    item.checkboxState = this.isComplete(element.step.key)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    if (this.isChapterActive(element.chapter.key)) {
      item.command = {
        command: 'vibeTour.openStep',
        title: 'Open lesson step',
        arguments: [element.step.key]
      };
      item.tooltip = element.step.explanation;
    } else {
      item.tooltip = 'Start this chapter to open its steps and explanations.';
    }
    item.contextValue = 'codeLessonStep';
    return item;
  }

  getChildren(element) {
    if (!element) {
      return this.getLessons().map((lesson) => ({ kind: 'lesson', lesson }));
    }
    if (element.kind === 'lesson') {
      return element.lesson.chapters.map((chapter) => ({
        kind: 'chapter',
        lesson: element.lesson,
        chapter
      }));
    }
    if (element.kind === 'chapter') {
      return element.chapter.steps.map((step) => ({
        kind: 'step',
        lesson: element.lesson,
        chapter: element.chapter,
        step
      }));
    }
    return [];
  }
}

async function activate(context) {
  const completionStateKey = 'codeLessons.completed.v1';
  const completed = new Set(context.workspaceState.get(completionStateKey, []));
  const diagnostics = vscode.languages.createDiagnosticCollection('code-lessons');
  const navigationStack = [];
  const codeLensChanged = new vscode.EventEmitter();

  let lessons = [];
  let activeChapterKey;
  let currentStepKey;
  let currentThread;
  let activeRelated;
  let watchers = [];
  let reloadTimer;

  const controller = vscode.comments.createCommentController(
    'vibeTour.comments',
    'VibeTour'
  );
  const commentAuthorIcon = vscode.Uri.joinPath(context.extensionUri, 'media', 'book.svg');

  const blueDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(64, 140, 255, 0.10)',
    borderColor: 'rgba(64, 140, 255, 0.45)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 2px'
  });
  const yellowDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 196, 64, 0.18)',
    borderColor: 'rgba(255, 196, 64, 0.85)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
    overviewRulerColor: 'rgba(255, 196, 64, 0.85)',
    overviewRulerLane: vscode.OverviewRulerLane.Center
  });
  const grayDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(128, 128, 128, 0.06)',
    opacity: '0.48'
  });
  const relatedDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(62, 190, 125, 0.16)',
    borderColor: 'rgba(62, 190, 125, 0.85)',
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
    overviewRulerColor: 'rgba(62, 190, 125, 0.85)',
    overviewRulerLane: vscode.OverviewRulerLane.Center
  });

  const getAllChapters = () => lessons.flatMap((lesson) => lesson.chapters);
  const getAllSteps = () => getAllChapters().flatMap((chapter) => chapter.steps);
  const getLesson = (lessonKey) => lessons.find((lesson) => lesson.key === lessonKey);
  const getChapter = (chapterKey) =>
    getAllChapters().find((chapter) => chapter.key === chapterKey);
  const getStep = (stepKey) => getAllSteps().find((step) => step.key === stepKey);
  const getChapterForStep = (stepKey) => {
    const step = getStep(stepKey);
    return step ? getChapter(step.chapterKey) : undefined;
  };
  const getLessonForStep = (stepKey) => {
    const step = getStep(stepKey);
    return step ? getLesson(step.lessonKey) : undefined;
  };
  const getUriForLocation = (step, location = step) => {
    const lesson = getLesson(step.lessonKey);
    return lesson ? vscode.Uri.joinPath(lesson.workspaceFolder.uri, location.file) : undefined;
  };

  const chapterFromArgument = (argument) => {
    if (typeof argument === 'string') {
      return getChapter(argument);
    }
    if (argument?.chapter?.key) {
      return getChapter(argument.chapter.key);
    }
    return getChapter(activeChapterKey) || getChapterForStep(currentStepKey);
  };

  const lessonFromArgument = (argument) => {
    if (typeof argument === 'string') {
      return getLesson(argument);
    }
    if (argument?.lesson?.key) {
      return getLesson(argument.lesson.key);
    }
    return undefined;
  };

  const treeProvider = new LessonTreeProvider(
    () => lessons,
    (stepKey) => completed.has(stepKey),
    (chapterKey) => chapterKey === activeChapterKey
  );
  const treeView = vscode.window.createTreeView('vibe-tour-lessons', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

  const backButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  backButton.command = 'vibeTour.back';
  backButton.text = '$(arrow-left) Back to lesson step';
  backButton.tooltip = 'Return to the lesson step that opened this related reference';

  const toRange = (document, location) => {
    const start = Math.max(0, location.startLine - 1);
    const end = Math.min(document.lineCount - 1, location.endLine - 1);
    return new vscode.Range(start, 0, end, document.lineAt(end).text.length);
  };

  const relatedCodeLensProvider = {
    onDidChangeCodeLenses: codeLensChanged.event,
    provideCodeLenses(document) {
      if (!activeRelated || activeRelated.uri.toString() !== document.uri.toString()) {
        return [];
      }
      const line = Math.max(0, activeRelated.startLine - 1);
      return [new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title: `← Back to ${activeRelated.stepTitle}`,
        command: 'vibeTour.back'
      })];
    }
  };

  const saveCompletion = async () => {
    await context.workspaceState.update(completionStateKey, [...completed]);
  };

  const refreshDecorations = () => {
    const activeChapter = getChapter(activeChapterKey);
    for (const editor of vscode.window.visibleTextEditors) {
      const blue = [];
      const yellow = [];
      const gray = [];
      for (const step of activeChapter?.steps || []) {
        const target = getUriForLocation(step);
        if (!target || target.toString() !== editor.document.uri.toString()) {
          continue;
        }
        const range = toRange(editor.document, step);
        if (completed.has(step.key)) {
          gray.push(range);
        } else if (step.key === currentStepKey) {
          yellow.push(range);
        } else {
          blue.push(range);
        }
      }
      editor.setDecorations(blueDecoration, blue);
      editor.setDecorations(yellowDecoration, yellow);
      editor.setDecorations(grayDecoration, gray);
      const related = activeChapter && activeRelated &&
        activeRelated.uri.toString() === editor.document.uri.toString()
        ? [toRange(editor.document, activeRelated)]
        : [];
      editor.setDecorations(relatedDecoration, related);
    }
  };

  const deactivateChapter = () => {
    activeChapterKey = undefined;
    currentStepKey = undefined;
    activeRelated = undefined;
    navigationStack.length = 0;
    backButton.hide();
    if (currentThread) {
      currentThread.dispose();
      currentThread = undefined;
    }
    codeLensChanged.fire();
    treeProvider.refresh();
    refreshDecorations();
  };

  const commandLink = (label, command, args = []) => {
    const query = encodeURIComponent(JSON.stringify(args));
    return `[${label}](command:${command}?${query})`;
  };

  const renderExplanation = (step, referencedRelated) =>
    step.explanation.replace(
      /\[([^\]]+)\]\(code-ref:([A-Za-z0-9_-]+)\)/g,
      (token, label, relatedId) => {
        if (!step.related.some((related) => related.id === relatedId)) {
          return label;
        }
        referencedRelated.add(relatedId);
        return commandLink(label, 'vibeTour.openRelated', [step.key, relatedId]);
      }
    );

  const commentFor = (step) => {
    const chapter = getChapter(step.chapterKey);
    const index = chapter.steps.findIndex((candidate) => candidate.key === step.key);
    const body = new vscode.MarkdownString('', true);
    body.isTrusted = {
      enabledCommands: ['vibeTour.openRelated']
    };

    const referencedRelated = new Set();
    const description = renderExplanation(step, referencedRelated)
      .replace(/\s+/g, ' ')
      .trim();
    body.appendMarkdown(`**${description}**\n\n`);

    if (step.keyPoints.length > 0) {
      for (const point of step.keyPoints) {
        body.appendMarkdown(`- ${point}\n`);
      }
      body.appendMarkdown('\n');
    }

    const remainingRelated = step.related.filter(
      (related) => !referencedRelated.has(related.id)
    );
    if (remainingRelated.length > 0) {
      body.appendMarkdown('**More related code**\n\n');
      for (const related of remainingRelated) {
        body.appendMarkdown(
          `${commandLink(`$(link-external) Open related: ${related.title}`, 'vibeTour.openRelated', [step.key, related.id])}\n\n`
        );
      }
    }

    return {
      body,
      mode: vscode.CommentMode.Preview,
      author: {
        name: 'VibeTour',
        iconPath: commentAuthorIcon
      },
      label: `${index + 1}/${chapter.steps.length} · ${chapter.title}`
    };
  };

  const showStep = async (stepKey) => {
    const step = getStep(stepKey);
    const chapter = getChapterForStep(stepKey);
    const uri = step && getUriForLocation(step);
    if (!step || !chapter || !uri) {
      vscode.window.showErrorMessage('This lesson step is no longer available.');
      return;
    }
    if (chapter.key !== activeChapterKey) {
      vscode.window.showInformationMessage('Start this chapter before opening its steps.');
      return;
    }

    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      vscode.window.showErrorMessage(`Lesson location is missing: ${step.file}`);
      return;
    }

    currentStepKey = step.key;
    activeRelated = undefined;
    navigationStack.length = 0;
    backButton.hide();
    codeLensChanged.fire();
    const range = toRange(document, step);
    if (currentThread) {
      currentThread.dispose();
    }
    const anchorLine = range.end.line;
    currentThread = controller.createCommentThread(
      uri,
      new vscode.Range(anchorLine, 0, anchorLine, 0),
      [commentFor(step)]
    );
    const stepIndex = chapter.steps.findIndex((candidate) => candidate.key === step.key);
    currentThread.canReply = false;
    currentThread.contextValue = [
      'codeLessonActive',
      stepIndex > 0 ? 'hasPrevious' : '',
      stepIndex < chapter.steps.length - 1 ? 'hasNext' : '',
      completed.has(step.key) ? 'completed' : 'incomplete'
    ].filter(Boolean).join('.');
    currentThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false
    });
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    refreshDecorations();
  };

  const showAdjacent = async (offset) => {
    const chapter = getChapterForStep(currentStepKey);
    if (!chapter) {
      return;
    }
    const index = chapter.steps.findIndex((step) => step.key === currentStepKey);
    const nextIndex = Math.max(0, Math.min(chapter.steps.length - 1, index + offset));
    await showStep(chapter.steps[nextIndex].key);
  };

  const startChapter = async (argument) => {
    const chapter = chapterFromArgument(argument);
    if (!chapter) {
      return;
    }
    const nextStep = chapter.steps.find((step) => !completed.has(step.key));
    if (!nextStep) {
      vscode.window.showInformationMessage(
        `${chapter.title} is complete. Use the chapter Reset button to start it again.`
      );
      return;
    }
    activeChapterKey = chapter.key;
    treeProvider.refresh();
    await showStep(nextStep.key);
  };

  const resetChapter = async (argument) => {
    const chapter = chapterFromArgument(argument);
    if (!chapter) {
      return;
    }
    for (const step of chapter.steps) {
      completed.delete(step.key);
    }
    await saveCompletion();
    if (chapter.key === activeChapterKey) {
      deactivateChapter();
    } else {
      treeProvider.refresh();
      refreshDecorations();
    }
    vscode.window.showInformationMessage(`Reset chapter: ${chapter.title}`);
  };

  const reloadLessons = async (notify = false) => {
    const result = await loadLessons(diagnostics);
    lessons = result.lessons;
    treeProvider.refresh();
    treeView.message = lessons.length === 0
      ? result.errorCount > 0
        ? `No valid lessons. ${result.errorCount} YAML file(s) have errors.`
        : 'No lessons found under the configured search paths.'
      : result.errorCount > 0
        ? `${result.errorCount} invalid lesson file(s); see Problems.`
        : undefined;

    const activeChapter = getChapter(activeChapterKey);
    if (!activeChapter) {
      if (activeChapterKey) {
        deactivateChapter();
      } else {
        refreshDecorations();
      }
    } else if (activeChapter.steps.every((step) => completed.has(step.key))) {
      deactivateChapter();
    } else if (getStep(currentStepKey)) {
      await showStep(currentStepKey);
    } else {
      const nextStep = activeChapter.steps.find((step) => !completed.has(step.key));
      await showStep(nextStep.key);
    }

    if (notify) {
      vscode.window.showInformationMessage(
        `Loaded ${lessons.length} code lesson${lessons.length === 1 ? '' : 's'}.`
      );
    }
  };

  const scheduleReload = (folder) => {
    if (
      folder &&
      !vscode.workspace.getConfiguration('codeLessons', folder.uri).get('autoReload', true)
    ) {
      return;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      void reloadLessons(false);
    }, 150);
  };

  const rebuildWatchers = () => {
    for (const watcher of watchers) {
      watcher.dispose();
    }
    watchers = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      for (const pattern of getSearchPaths(folder)) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern)
        );
        watcher.onDidCreate(() => scheduleReload(folder));
        watcher.onDidChange(() => scheduleReload(folder));
        watcher.onDidDelete(() => scheduleReload(folder));
        watchers.push(watcher);
      }
    }
  };

  context.subscriptions.push(
    diagnostics,
    controller,
    codeLensChanged,
    blueDecoration,
    yellowDecoration,
    grayDecoration,
    relatedDecoration,
    treeView,
    backButton,
    new vscode.Disposable(() => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      for (const watcher of watchers) {
        watcher.dispose();
      }
    }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, relatedCodeLensProvider),
    vscode.commands.registerCommand('vibeTour.startChapter', startChapter),
    vscode.commands.registerCommand('vibeTour.resetChapter', resetChapter),
    vscode.commands.registerCommand('vibeTour.refreshLessons', () => reloadLessons(true)),
    vscode.commands.registerCommand('vibeTour.showLessons', () =>
      vscode.commands.executeCommand('vibe-tour-lessons.focus')
    ),
    vscode.commands.registerCommand('vibeTour.deleteLesson', async (argument) => {
      const lesson = lessonFromArgument(argument);
      if (!lesson) {
        return;
      }

      const relativePath = vscode.workspace.asRelativePath(lesson.sourceUri, false);
      const choice = await vscode.window.showWarningMessage(
        `Delete lesson "${lesson.title}"? This will move ${relativePath} to the trash.`,
        { modal: true },
        'Delete'
      );
      if (choice !== 'Delete') {
        return;
      }

      try {
        await vscode.workspace.fs.delete(lesson.sourceUri, {
          recursive: false,
          useTrash: true
        });
        for (const chapter of lesson.chapters) {
          for (const step of chapter.steps) {
            completed.delete(step.key);
          }
        }
        await saveCompletion();
        await reloadLessons(false);
        vscode.window.showInformationMessage(`Deleted lesson: ${lesson.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Unable to delete lesson: ${message}`);
      }
    }),
    vscode.commands.registerCommand('vibeTour.openStep', async (stepKey) => {
      const chapter = getChapterForStep(stepKey);
      if (!chapter || chapter.key !== activeChapterKey) {
        vscode.window.showInformationMessage('Start this chapter before opening its steps.');
        return;
      }
      await showStep(stepKey);
    }),
    vscode.commands.registerCommand('vibeTour.previous', () => showAdjacent(-1)),
    vscode.commands.registerCommand('vibeTour.next', () => showAdjacent(1)),
    vscode.commands.registerCommand('vibeTour.completeCurrent', async () => {
      const step = getStep(currentStepKey);
      const chapter = getChapterForStep(currentStepKey);
      if (!step || !chapter) {
        return;
      }
      const index = chapter.steps.findIndex((candidate) => candidate.key === step.key);
      completed.add(step.key);
      await saveCompletion();
      treeProvider.refresh();
      const nextStep = chapter.steps
        .slice(index + 1)
        .concat(chapter.steps.slice(0, index))
        .find((candidate) => !completed.has(candidate.key));
      if (!nextStep) {
        const chapterTitle = chapter.title;
        deactivateChapter();
        vscode.window.showInformationMessage(`Chapter complete: ${chapterTitle}`);
        return;
      }
      await showStep(nextStep.key);
    }),
    vscode.commands.registerCommand('vibeTour.openRelated', async (stepKey, relatedId) => {
      const step = getStep(stepKey);
      const chapter = getChapterForStep(stepKey);
      const related = step?.related.find((item) => item.id === relatedId);
      const uri = step && related ? getUriForLocation(step, related) : undefined;
      const editor = vscode.window.activeTextEditor;
      if (!step || !related || !uri || !editor || chapter?.key !== activeChapterKey) {
        return;
      }
      navigationStack.push({ stepKey });
      const document = await vscode.workspace.openTextDocument(uri);
      const relatedEditor = await vscode.window.showTextDocument(document, { preview: false });
      const range = toRange(document, related);
      activeRelated = {
        ...related,
        uri,
        stepTitle: step.title,
        stepKey
      };
      codeLensChanged.fire();
      relatedEditor.selection = new vscode.Selection(range.start, range.end);
      relatedEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      refreshDecorations();
      backButton.text = `$(arrow-left) Back to ${step.title}`;
      backButton.show();
    }),
    vscode.commands.registerCommand('vibeTour.back', async () => {
      const saved = navigationStack.pop();
      if (!saved) {
        backButton.hide();
        return;
      }
      activeRelated = undefined;
      codeLensChanged.fire();
      await showStep(saved.stepKey);
    }),
    treeView.onDidChangeCheckboxState(async (event) => {
      for (const [element, state] of event.items) {
        if (element.kind !== 'step') {
          continue;
        }
        if (state === vscode.TreeItemCheckboxState.Checked) {
          completed.add(element.step.key);
        } else {
          completed.delete(element.step.key);
        }
      }
      await saveCompletion();
      treeProvider.refresh();
      const activeChapter = getChapter(activeChapterKey);
      if (activeChapter && activeChapter.steps.every((step) => completed.has(step.key))) {
        const chapterTitle = activeChapter.title;
        deactivateChapter();
        vscode.window.showInformationMessage(`Chapter complete: ${chapterTitle}`);
      } else if (currentStepKey) {
        await showStep(currentStepKey);
      } else {
        refreshDecorations();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(refreshDecorations),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      rebuildWatchers();
      await reloadLessons(false);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (
        event.affectsConfiguration('codeLessons.searchPaths') ||
        event.affectsConfiguration('codeLessons.autoReload')
      ) {
        rebuildWatchers();
        await reloadLessons(false);
      }
    })
  );

  rebuildWatchers();
  await reloadLessons(false);
  refreshDecorations();

  const rightPanelWasInitialized = context.workspaceState.get(
    'codeLessons.rightPanelInitialized.v1',
    false
  );
  const rightPanelWasRestored = context.workspaceState.get(
    'codeLessons.rightPanelRestored.v1',
    false
  );
  if (rightPanelWasInitialized && !rightPanelWasRestored) {
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await context.workspaceState.update('codeLessons.rightPanelRestored.v1', true);
  }

  if (!context.workspaceState.get('codeLessons.sidebarRevealed.v1', false)) {
    await vscode.commands.executeCommand('vibe-tour-lessons.focus');
    await context.workspaceState.update('codeLessons.sidebarRevealed.v1', true);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
