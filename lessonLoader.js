const path = require('path');
const vscode = require('vscode');
const YAML = require('yaml');

const DEFAULT_SEARCH_PATHS = [
  '**/.code-lessons/**/*.yaml',
  '**/.code-lessons/**/*.yml'
];
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

class LessonValidationError extends Error {}

function getSearchPaths(folder) {
  const configured = vscode.workspace
    .getConfiguration('codeLessons', folder.uri)
    .get('searchPaths', DEFAULT_SEARCH_PATHS);
  if (!Array.isArray(configured)) {
    return DEFAULT_SEARCH_PATHS;
  }
  return configured.filter((pattern) =>
    typeof pattern === 'string' &&
    pattern.length > 0 &&
    !path.posix.isAbsolute(pattern.replaceAll('\\', '/')) &&
    !pattern.replaceAll('\\', '/').split('/').includes('..')
  );
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LessonValidationError(`${label} must be an object.`);
  }
  return value;
}

function requireArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new LessonValidationError(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LessonValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireId(value, label) {
  const id = requireString(value, label);
  if (!ID_PATTERN.test(id)) {
    throw new LessonValidationError(
      `${label} must contain only letters, numbers, underscores, or hyphens.`
    );
  }
  return id;
}

function normalizeRelativePath(value, label) {
  const raw = requireString(value, label).replaceAll('\\', '/');
  const normalized = path.posix.normalize(raw);
  if (
    path.posix.isAbsolute(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new LessonValidationError(`${label} must stay inside its lesson root.`);
  }
  return normalized;
}

function normalizeRange(value, label) {
  const range = requireObject(value, label);
  const startLine = range.start_line;
  const endLine = range.end_line;
  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new LessonValidationError(`${label}.start_line must be a positive integer.`);
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    throw new LessonValidationError(
      `${label}.end_line must be an integer greater than or equal to start_line.`
    );
  }
  return { startLine, endLine };
}

function normalizeLocation(value, label) {
  const location = requireObject(value, label);
  return {
    file: normalizeRelativePath(location.file, `${label}.file`),
    ...normalizeRange(location.range, `${label}.range`)
  };
}

function getLessonRoot(folder, sourceUri) {
  const relative = path.relative(folder.uri.fsPath, sourceUri.fsPath);
  const normalized = relative.replaceAll('\\', '/');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(relative)
  ) {
    return {
      uri: folder.uri,
      relativePath: '',
      label: folder.name
    };
  }

  const segments = normalized.split('/');
  const markerIndex = segments.lastIndexOf('.code-lessons');
  if (markerIndex < 0) {
    return {
      uri: folder.uri,
      relativePath: '',
      label: folder.name
    };
  }

  const rootSegments = segments.slice(0, markerIndex);
  const relativePath = rootSegments.join('/');
  return {
    uri: rootSegments.length > 0
      ? vscode.Uri.joinPath(folder.uri, ...rootSegments)
      : folder.uri,
    relativePath,
    label: relativePath ? `${folder.name}/${relativePath}` : folder.name
  };
}

function normalizeLesson(data, folder, sourceUri) {
  const root = requireObject(data, 'YAML document');
  if (root.schema_version !== 1) {
    throw new LessonValidationError('schema_version must be 1.');
  }

  const rawLesson = requireObject(root.lesson, 'lesson');
  const lessonId = requireId(rawLesson.id, 'lesson.id');
  const lessonRoot = getLessonRoot(folder, sourceUri);
  const lessonKey = `${lessonRoot.uri.toString()}::${lessonId}`;
  const rawChapters = requireArray(rawLesson.chapters, 'lesson.chapters');
  const chapterIds = new Set();
  const stepIds = new Set();

  const lesson = {
    id: lessonId,
    key: lessonKey,
    title: requireString(rawLesson.title, 'lesson.title'),
    description: typeof rawLesson.description === 'string' ? rawLesson.description.trim() : '',
    metadata: rawLesson.metadata && typeof rawLesson.metadata === 'object'
      ? rawLesson.metadata
      : {},
    sourceUri,
    workspaceFolder: folder,
    rootUri: lessonRoot.uri,
    rootRelativePath: lessonRoot.relativePath,
    rootLabel: lessonRoot.label,
    chapters: []
  };

  lesson.chapters = rawChapters.map((rawChapter, chapterIndex) => {
    const chapterLabel = `lesson.chapters[${chapterIndex}]`;
    const chapter = requireObject(rawChapter, chapterLabel);
    const chapterId = requireId(chapter.id, `${chapterLabel}.id`);
    if (chapterIds.has(chapterId)) {
      throw new LessonValidationError(`Duplicate chapter id: ${chapterId}.`);
    }
    chapterIds.add(chapterId);

    const normalizedChapter = {
      id: chapterId,
      key: `${lessonKey}::chapter::${chapterId}`,
      lessonKey,
      title: requireString(chapter.title, `${chapterLabel}.title`),
      steps: []
    };

    normalizedChapter.steps = requireArray(chapter.steps, `${chapterLabel}.steps`)
      .map((rawStep, stepIndex) => {
        const stepLabel = `${chapterLabel}.steps[${stepIndex}]`;
        const step = requireObject(rawStep, stepLabel);
        const stepId = requireId(step.id, `${stepLabel}.id`);
        if (stepIds.has(stepId)) {
          throw new LessonValidationError(`Duplicate step id: ${stepId}.`);
        }
        stepIds.add(stepId);

        const primary = normalizeLocation(
          requireObject(step.primary, `${stepLabel}.primary`),
          `${stepLabel}.primary`
        );
        const relatedIds = new Set();
        const related = requireArray(step.related || [], `${stepLabel}.related`, true)
          .map((rawRelated, relatedIndex) => {
            const relatedLabel = `${stepLabel}.related[${relatedIndex}]`;
            const item = requireObject(rawRelated, relatedLabel);
            const relatedId = requireId(item.id, `${relatedLabel}.id`);
            if (relatedIds.has(relatedId)) {
              throw new LessonValidationError(
                `Duplicate related id "${relatedId}" in step "${stepId}".`
              );
            }
            relatedIds.add(relatedId);
            return {
              id: relatedId,
              title: requireString(item.title, `${relatedLabel}.title`),
              ...normalizeLocation(item.location, `${relatedLabel}.location`)
            };
          });

        const explanation = requireString(step.explanation, `${stepLabel}.explanation`);
        for (const match of explanation.matchAll(/\(code-ref:([A-Za-z0-9_-]+)\)/g)) {
          if (!relatedIds.has(match[1])) {
            throw new LessonValidationError(
              `Step "${stepId}" references unknown related id "${match[1]}".`
            );
          }
        }

        const keyPoints = step.key_points === undefined
          ? []
          : requireArray(step.key_points, `${stepLabel}.key_points`, true)
            .map((point, pointIndex) =>
              requireString(point, `${stepLabel}.key_points[${pointIndex}]`)
            );

        return {
          id: stepId,
          key: `${lessonKey}::step::${stepId}`,
          lessonKey,
          chapterKey: normalizedChapter.key,
          title: requireString(step.title, `${stepLabel}.title`),
          explanation,
          keyPoints,
          related,
          ...primary
        };
      });

    return normalizedChapter;
  });

  return lesson;
}

async function validateLocations(lesson) {
  const lineCounts = new Map();
  const locations = lesson.chapters.flatMap((chapter) =>
    chapter.steps.flatMap((step) => [step, ...step.related])
  );

  for (const location of locations) {
    let lineCount = lineCounts.get(location.file);
    if (lineCount === undefined) {
      const uri = vscode.Uri.joinPath(lesson.rootUri, location.file);
      let bytes;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch {
        throw new LessonValidationError(`Referenced file does not exist: ${location.file}.`);
      }
      const text = Buffer.from(bytes).toString('utf8');
      lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
      lineCounts.set(location.file, lineCount);
    }
    if (location.endLine > lineCount) {
      throw new LessonValidationError(
        `Range ${location.startLine}-${location.endLine} exceeds ${location.file} (${lineCount} lines).`
      );
    }
  }
}

function diagnosticRangeFromYamlError(error) {
  const start = error.linePos?.[0];
  const end = error.linePos?.[1] || start;
  if (!start) {
    return new vscode.Range(0, 0, 0, 1);
  }
  return new vscode.Range(
    Math.max(0, start.line - 1),
    Math.max(0, start.col - 1),
    Math.max(0, (end?.line || start.line) - 1),
    Math.max(0, (end?.col || start.col) - 1)
  );
}

async function parseLesson(uri, folder, diagnostics) {
  const document = await vscode.workspace.openTextDocument(uri);
  const yamlDocument = YAML.parseDocument(document.getText(), {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true
  });

  if (yamlDocument.errors.length > 0) {
    diagnostics.set(uri, yamlDocument.errors.map((error) =>
      new vscode.Diagnostic(
        diagnosticRangeFromYamlError(error),
        error.message,
        vscode.DiagnosticSeverity.Error
      )
    ));
    return undefined;
  }

  try {
    const lesson = normalizeLesson(yamlDocument.toJS({ maxAliasCount: 100 }), folder, uri);
    await validateLocations(lesson);
    diagnostics.delete(uri);
    return lesson;
  } catch (error) {
    diagnostics.set(uri, [new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      error instanceof Error ? error.message : String(error),
      vscode.DiagnosticSeverity.Error
    )]);
    return undefined;
  }
}

async function loadLessons(diagnostics) {
  diagnostics.clear();
  const lessons = [];
  const seenKeys = new Set();
  let errorCount = 0;

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const uriMap = new Map();
    for (const pattern of getSearchPaths(folder)) {
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern));
      for (const uri of uris) {
        uriMap.set(uri.toString(), uri);
      }
    }

    const uris = [...uriMap.values()].sort((left, right) =>
      left.toString().localeCompare(right.toString())
    );
    for (const uri of uris) {
      const parsed = await parseLesson(uri, folder, diagnostics);
      if (!parsed) {
        errorCount += 1;
        continue;
      }
      if (seenKeys.has(parsed.key)) {
        diagnostics.set(uri, [new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          `Duplicate lesson id "${parsed.id}" under lesson root "${parsed.rootLabel}".`,
          vscode.DiagnosticSeverity.Error
        )]);
        errorCount += 1;
        continue;
      }
      seenKeys.add(parsed.key);
      lessons.push(parsed);
    }
  }

  return { lessons, errorCount };
}

module.exports = {
  DEFAULT_SEARCH_PATHS,
  getLessonRoot,
  getSearchPaths,
  loadLessons,
  normalizeLesson
};
