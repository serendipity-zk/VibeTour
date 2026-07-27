const vscode = require('vscode');
const YAML = require('yaml');
const { getSearchPaths, loadLessons } = require('./lessonLoader');
const path = require('node:path');
const {
  HARNESS_CONFIG,
  findMatchingSkillInstallation,
  getSkillTarget,
  installSkillDirectory,
  pathExists,
  skillMatchesBundled
} = require('./skillInstaller');
const {
  getCachedDiff,
  prepareRangeStaging,
  removeIntentToAdd,
  stageIntentToAddRange
} = require('./gitRangeStager');

class LessonTreeProvider {
  constructor(getLessons, getInvalidLessons, isComplete, isChapterActive) {
    this.getLessons = getLessons;
    this.getInvalidLessons = getInvalidLessons;
    this.isComplete = isComplete;
    this.isChapterActive = isChapterActive;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  refresh() {
    this.changed.fire();
  }

  isLessonFinished(lesson) {
    const steps = lesson.chapters.flatMap((chapter) => chapter.steps);
    return steps.length > 0 && steps.every((step) => this.isComplete(step.key));
  }

  getTreeItem(element) {
    if (element.kind === 'invalidLessons') {
      const item = new vscode.TreeItem(
        'Invalid Lessons',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.id = 'code-lessons-invalid';
      item.description = `${this.getInvalidLessons().length}`;
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = 'codeLessonInvalidFolder';
      item.tooltip = 'Expand to inspect lesson YAML files that could not be loaded.';
      return item;
    }

    if (element.kind === 'invalidLesson') {
      const invalidLesson = element.invalidLesson;
      const item = new vscode.TreeItem(
        path.basename(invalidLesson.sourceUri.fsPath),
        vscode.TreeItemCollapsibleState.None
      );
      item.id = `code-lesson-invalid-${invalidLesson.key}`;
      item.description = invalidLesson.errorCount === 1
        ? '1 error'
        : `${invalidLesson.errorCount} errors`;
      item.iconPath = new vscode.ThemeIcon('error');
      item.contextValue = 'codeLessonInvalid';
      item.tooltip = new vscode.MarkdownString(
        `**${invalidLesson.message}**\n\n` +
        `Source: \`${invalidLesson.relativePath}\``
      );
      item.command = {
        command: 'vibeTour.openInvalidLesson',
        title: 'Open invalid lesson',
        arguments: [invalidLesson]
      };
      return item;
    }

    if (element.kind === 'finishedLessons') {
      const finishedCount = this.getLessons()
        .filter((lesson) => this.isLessonFinished(lesson))
        .length;
      const item = new vscode.TreeItem(
        'Finished Lessons',
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.id = 'code-lessons-finished';
      item.description = `${finishedCount}`;
      item.iconPath = new vscode.ThemeIcon('archive');
      item.contextValue = 'codeLessonFinishedFolder';
      item.tooltip = 'Expand to review completed lessons or reset their chapters.';
      return item;
    }

    if (element.kind === 'lesson') {
      const steps = element.lesson.chapters.flatMap((chapter) => chapter.steps);
      const completed = steps.filter((step) => this.isComplete(step.key)).length;
      const finished = steps.length > 0 && completed === steps.length;
      const item = new vscode.TreeItem(
        element.lesson.title,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.id = `code-lesson-${element.lesson.key}`;
      item.description = `${completed}/${steps.length}${finished ? ' · finished' : ''}`;
      item.iconPath = new vscode.ThemeIcon('book');
      item.contextValue = 'codeLesson';
      item.tooltip = new vscode.MarkdownString(
        `${element.lesson.description || element.lesson.title}\n\n` +
        `Root: \`${element.lesson.rootUri.fsPath}\`\n\n` +
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
      item.contextValue = active ? 'codeLessonChapterActive' : 'codeLessonChapter';
      item.tooltip = active
        ? 'Use Stop to close the guide while keeping progress; use Reset to clear it.'
        : 'Use Play to start or resume this chapter; use Reset to clear its progress.';
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
      const activeLessons = [];
      const finishedLessons = [];
      for (const lesson of this.getLessons()) {
        if (this.isLessonFinished(lesson)) {
          finishedLessons.push(lesson);
        } else {
          activeLessons.push(lesson);
        }
      }
      const children = activeLessons.map((lesson) => ({ kind: 'lesson', lesson }));
      if (this.getInvalidLessons().length > 0) {
        children.push({ kind: 'invalidLessons' });
      }
      if (finishedLessons.length > 0) {
        children.push({ kind: 'finishedLessons' });
      }
      return children;
    }
    if (element.kind === 'invalidLessons') {
      return this.getInvalidLessons().map((invalidLesson) => ({
        kind: 'invalidLesson',
        invalidLesson
      }));
    }
    if (element.kind === 'finishedLessons') {
      return this.getLessons()
        .filter((lesson) => this.isLessonFinished(lesson))
        .map((lesson) => ({ kind: 'lesson', lesson }));
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
  let invalidLessons = [];
  let activeChapterKey;
  let currentStepKey;
  let currentThread;
  let activeRelated;
  let watchers = [];
  let reloadTimer;

  const bundledSkillDirectory = path.join(
    context.extensionPath,
    '.agents',
    'skills',
    'generate-code-lesson'
  );

  const getSkillCandidateDirectories = () => {
    const directories = [];
    for (const harness of Object.keys(HARNESS_CONFIG)) {
      for (const folder of vscode.workspace.workspaceFolders || []) {
        directories.push(getSkillTarget(harness, 'workspace', {
          workspaceRoot: folder.uri.fsPath
        }));
      }
      directories.push(getSkillTarget(harness, 'user'));
    }
    return directories;
  };

  const refreshSkillInstallStatus = async () => {
    let matchingInstallation;
    try {
      matchingInstallation = await findMatchingSkillInstallation(
        bundledSkillDirectory,
        getSkillCandidateDirectories()
      );
    } catch (error) {
      console.warn('Unable to inspect VibeTour skill installations:', error);
    }
    await vscode.commands.executeCommand(
      'setContext',
      'vibeTour.needsSkillInstall',
      !matchingInstallation
    );
  };

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
    backgroundColor: 'rgba(128, 128, 128, 0.10)'
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
    return lesson ? vscode.Uri.joinPath(lesson.rootUri, location.file) : undefined;
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
    () => invalidLessons,
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

  const installAuthoringSkill = async () => {
    const selectedHarnesses = await vscode.window.showQuickPick(
      [
        {
          label: 'Codex / .agents-compatible agents',
          description: 'Shared project convention: .agents/skills',
          harness: 'codex',
          picked: true
        },
        {
          label: 'Claude Code',
          description: '.claude/skills',
          harness: 'claude-code',
          picked: true
        }
      ],
      {
        canPickMany: true,
        ignoreFocusOut: true,
        title: 'Install VibeTour lesson-authoring skill · 1/2',
        placeHolder: 'Select one or more coding agents'
      }
    );
    if (!selectedHarnesses || selectedHarnesses.length === 0) {
      return;
    }

    const remoteDescription = vscode.env.remoteName
      ? `All projects for this remote host (${vscode.env.remoteName})`
      : 'All projects for the current OS user';
    const selectedScope = await vscode.window.showQuickPick(
      [
        {
          label: 'Current workspace (local)',
          description: 'Install in this project and optionally commit it for the team',
          scope: 'workspace'
        },
        {
          label: 'User (global)',
          description: remoteDescription,
          scope: 'user'
        }
      ],
      {
        ignoreFocusOut: true,
        title: 'Install VibeTour lesson-authoring skill · 2/2',
        placeHolder: 'Choose where the skill should be available'
      }
    );
    if (!selectedScope) {
      return;
    }

    let workspaceFolder;
    if (selectedScope.scope === 'workspace') {
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length === 0) {
        vscode.window.showErrorMessage('Open a workspace folder before installing a workspace skill.');
        return;
      }
      workspaceFolder = folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
          placeHolder: 'Choose the workspace folder that should receive the skill'
        });
      if (!workspaceFolder) {
        return;
      }
    }

    const installations = selectedHarnesses.map((item) => ({
      harness: item.harness,
      label: HARNESS_CONFIG[item.harness].label,
      targetDirectory: getSkillTarget(item.harness, selectedScope.scope, {
        workspaceRoot: workspaceFolder?.uri.fsPath
      })
    }));

    let currentInstallations;
    let existingInstallations;
    try {
      currentInstallations = [];
      existingInstallations = [];
      for (const installation of installations) {
        if (await skillMatchesBundled(
          bundledSkillDirectory,
          installation.targetDirectory
        )) {
          currentInstallations.push(installation);
        } else if (await pathExists(installation.targetDirectory)) {
          existingInstallations.push(installation);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Unable to inspect skill installations: ${message}`);
      return;
    }

    const pendingInstallations = installations.filter(
      (installation) => !currentInstallations.includes(installation)
    );
    if (pendingInstallations.length === 0) {
      const labels = currentInstallations.map((item) => item.label).join(' and ');
      vscode.window.showInformationMessage(
        `The bundled generate-code-lesson skill is already installed for ${labels}.`
      );
      await refreshSkillInstallStatus();
      return;
    }

    if (existingInstallations.length > 0) {
      const labels = existingInstallations.map((item) => item.label).join(', ');
      const choice = await vscode.window.showWarningMessage(
        `The ${labels} installation already exists. Replace it with the version bundled with VibeTour?`,
        { modal: true },
        'Replace'
      );
      if (choice !== 'Replace') {
        return;
      }
    }

    const installed = [];
    const failed = [];
    for (const installation of pendingInstallations) {
      try {
        await installSkillDirectory(bundledSkillDirectory, installation.targetDirectory, {
          replace: existingInstallations.includes(installation)
        });
        installed.push(installation);
      } catch (error) {
        failed.push({
          ...installation,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (installed.length > 0) {
      const labels = installed.map((item) => item.label).join(' and ');
      const location = selectedScope.scope === 'workspace'
        ? `workspace ${workspaceFolder.name}`
        : vscode.env.remoteName
          ? `user account on ${vscode.env.remoteName}`
          : 'current user account';
      vscode.window.showInformationMessage(
        `Installed generate-code-lesson for ${labels} in the ${location}.`
      );
    }
    if (failed.length > 0) {
      vscode.window.showErrorMessage(
        `Unable to install for ${failed.map((item) => item.label).join(', ')}: ` +
        failed.map((item) => item.message).join('; ')
      );
    }
    await refreshSkillInstallStatus();
  };

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

  const yamlLocation = (location) => ({
    file: location.file,
    range: {
      start_line: location.startLine,
      end_line: location.endLine
    }
  });

  const stepAsYaml = (step) => {
    const value = {
      id: step.id,
      title: step.title,
      primary: yamlLocation(step),
      explanation: step.explanation
    };
    if (step.keyPoints.length > 0) {
      value.key_points = step.keyPoints;
    }
    if (step.related.length > 0) {
      value.related = step.related.map((related) => ({
        id: related.id,
        title: related.title,
        location: yamlLocation(related)
      }));
    }
    return YAML.stringify(value, {
      blockQuote: 'literal',
      lineWidth: 0
    }).trimEnd();
  };

  const copyStepContext = async () => {
    const step = getStep(currentStepKey);
    const chapter = getChapterForStep(currentStepKey);
    const lesson = getLessonForStep(currentStepKey);
    if (!step || !chapter || !lesson) {
      vscode.window.showInformationMessage('Start a chapter before copying step context.');
      return;
    }

    const lines = [
      `- Workspace: ${lesson.rootLabel}`,
      `- Lesson: ${lesson.title}`,
      `- Chapter: ${chapter.title}`,
      '',
      '```yaml',
      stepAsYaml(step),
      '```',
      '',
      'Given context, answer:'
    ];
    await vscode.env.clipboard.writeText(lines.join('\n'));
    vscode.window.showInformationMessage(`Copied step YAML: ${step.title}`);
  };

  const stageReviewedRange = async () => {
    const step = getStep(currentStepKey);
    const chapter = getChapterForStep(currentStepKey);
    const uri = step && getUriForLocation(step);
    if (!step || !chapter || !uri || chapter.key !== activeChapterKey) {
      vscode.window.showInformationMessage(
        'Start a chapter before staging a reviewed range.'
      );
      return;
    }

    let document;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      vscode.window.showErrorMessage(`Lesson location is missing: ${step.file}`);
      return;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      vscode.window.showErrorMessage(
        "Unable to stage the reviewed range because VS Code's built-in Git extension is unavailable."
      );
      return;
    }

    let gitApi;
    try {
      const gitExports = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
      if (!gitExports.enabled) {
        vscode.window.showErrorMessage(
          "Enable VS Code's built-in Git extension before staging a reviewed range."
        );
        return;
      }
      gitApi = gitExports.getAPI(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Unable to access VS Code Git: ${message}`);
      return;
    }

    const repository = gitApi.getRepository(uri);
    if (!repository || uri.scheme !== 'file' || repository.rootUri.scheme !== 'file') {
      vscode.window.showErrorMessage(
        'The reviewed file is not inside an open local Git repository.'
      );
      return;
    }

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false
    });
    const previousSelections = editor.selections;
    const range = toRange(document, step);
    editor.selections = [new vscode.Selection(range.start, range.end)];
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

    let stagingState;
    try {
      stagingState = await prepareRangeStaging(
        gitApi.git.path,
        repository.rootUri.fsPath,
        uri.fsPath
      );
      await repository.status();

      const beforeDiff = await getCachedDiff(
        gitApi.git.path,
        repository.rootUri.fsPath,
        stagingState.relativePath
      );
      let afterDiff = beforeDiff;
      if (stagingState.addedIntentToAdd) {
        await stageIntentToAddRange(
          gitApi.git.path,
          repository.rootUri.fsPath,
          stagingState.relativePath,
          document.getText(),
          step.startLine,
          step.endLine
        );
        await repository.status();
        afterDiff = await getCachedDiff(
          gitApi.git.path,
          repository.rootUri.fsPath,
          stagingState.relativePath
        );
      } else {
        editor.selections = [new vscode.Selection(range.start, range.end)];
        await vscode.commands.executeCommand('git.stageSelectedRanges');
        await repository.status();
        afterDiff = await getCachedDiff(
          gitApi.git.path,
          repository.rootUri.fsPath,
          stagingState.relativePath
        );
      }

      if (afterDiff === beforeDiff) {
        if (stagingState.addedIntentToAdd) {
          await removeIntentToAdd(
            gitApi.git.path,
            repository.rootUri.fsPath,
            stagingState.relativePath
          );
          await repository.status();
        }
        vscode.window.showWarningMessage(
          `No unstaged Git changes were found inside ${step.file}:${step.startLine}-${step.endLine}.`
        );
        return;
      }

      vscode.window.showInformationMessage(
        `Staged reviewed range: ${step.file}:${step.startLine}-${step.endLine}`
      );
    } catch (error) {
      if (stagingState?.addedIntentToAdd) {
        try {
          await removeIntentToAdd(
            gitApi.git.path,
            repository.rootUri.fsPath,
            stagingState.relativePath
          );
          await repository.status();
        } catch {
          // Preserve the original staging error.
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Unable to stage the reviewed range: ${message}`
      );
    } finally {
      if (vscode.window.activeTextEditor === editor) {
        editor.selections = previousSelections;
      }
      refreshDecorations();
    }
  };

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
    body.appendMarkdown(`### ${step.title}\n\n`);
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
        name: `VibeTour · ${chapter.title} · ${index + 1}/${chapter.steps.length}`,
        iconPath: commentAuthorIcon
      }
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

  const stopChapter = (argument) => {
    const chapter = chapterFromArgument(argument);
    if (!chapter || chapter.key !== activeChapterKey) {
      return;
    }
    const title = chapter.title;
    deactivateChapter();
    vscode.window.showInformationMessage(
      `Stopped chapter: ${title}. Completed steps were kept.`
    );
  };

  const reloadLessons = async (notify = false) => {
    const result = await loadLessons(diagnostics);
    lessons = result.lessons;
    invalidLessons = result.invalidLessons;
    await vscode.commands.executeCommand(
      'setContext',
      'vibeTour.hasLessonErrors',
      result.errorCount > 0
    );
    treeProvider.refresh();
    treeView.message = undefined;

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
    vscode.commands.registerCommand('vibeTour.stopChapter', stopChapter),
    vscode.commands.registerCommand('vibeTour.resetChapter', resetChapter),
    vscode.commands.registerCommand('vibeTour.refreshLessons', async () => {
      await Promise.all([
        reloadLessons(true),
        refreshSkillInstallStatus()
      ]);
    }),
    vscode.commands.registerCommand('vibeTour.installAuthoringSkill', installAuthoringSkill),
    vscode.commands.registerCommand('vibeTour.showLessons', () =>
      vscode.commands.executeCommand('vibe-tour-lessons.focus')
    ),
    vscode.commands.registerCommand('vibeTour.openInvalidLesson', async (invalidLesson) => {
      if (!invalidLesson?.sourceUri) {
        return;
      }
      const document = await vscode.workspace.openTextDocument(invalidLesson.sourceUri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        selection: invalidLesson.firstRange
      });
    }),
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
    vscode.commands.registerCommand('vibeTour.stageReviewedRange', stageReviewedRange),
    vscode.commands.registerCommand('vibeTour.copyStepContext', copyStepContext),
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
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void refreshSkillInstallStatus();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      rebuildWatchers();
      await Promise.all([
        reloadLessons(false),
        refreshSkillInstallStatus()
      ]);
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
  await Promise.all([
    reloadLessons(false),
    refreshSkillInstallStatus()
  ]);
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

module.exports = { LessonTreeProvider, activate, deactivate };
