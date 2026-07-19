# VibeTour

VibeTour is a YAML-driven VS Code extension. It automatically discovers `.code-lessons/**/*.yaml` and `.yml` in every workspace folder, validates files and ranges, and reloads lessons when YAML changes. The demo lesson contains two chapters and four steps across `scheduler.py`, `block_manager.py`, `request.py`, and `worker.py`. Primary ranges deliberately target focused statements inside functions rather than requiring the whole function.

## Install the Codex skill

The repository includes the lesson-authoring skill at `.agents/skills/generate-code-lesson`. Codex automatically discovers repository skills when it is started from this directory or one of its child directories, so no installation is needed for repo-local use. Invoke it with a prompt such as:

```text
Use $generate-code-lesson to create a focused lesson for the code we just changed.
```

To use the skill in unrelated repositories, ask Codex to install it at user scope:

```text
Please install the local Codex skill from .agents/skills/generate-code-lesson as a user skill. Preserve any existing installation and verify that the installed skill is discoverable.
```

Codex installs user-wide skills under `$HOME/.agents/skills`. Restart Codex if the newly installed skill does not appear in `/skills` or in the `$` skill picker.

## Install the VS Code extension

Download `vibe-tour-<version>.vsix` from the latest GitHub Release, then install it from the command line:

```bash
code --install-extension vibe-tour-<version>.vsix
```

If the `code` command is unavailable, open the VS Code Command Palette, run **Extensions: Install from VSIX...**, and select the downloaded file. Reload VS Code after installation, open the project you want to learn, and select the **VibeTour** book icon in the Activity Bar.

To build the VSIX locally instead:

```bash
npm install
npm run package
code --install-extension vibe-tour-0.0.1.vsix
```

The extension looks for lessons under `.code-lessons/**/*.yaml` and `.code-lessons/**/*.yml` in the opened workspace. Use the bundled Codex skill to generate those files.

## Automated releases

The GitHub Actions workflow in `.github/workflows/release.yml` runs checks and tests, builds the extension bundle, packages the VSIX, and uploads it as a workflow artifact.

This works when the `VibeTour` directory is the root of the GitHub repository. If it is kept as a subdirectory in a larger repository, move the workflow to the repository-level `.github/workflows/` directory and set its working directory to `VibeTour`.

Push a tag matching `v<package.json version>`—for example, `v0.0.1`—to create a GitHub Release and attach the prebuilt VSIX automatically. Running the workflow manually from the Actions tab builds the same VSIX as a downloadable artifact without creating a Release.

## Run from source

1. Open this `VibeTour` directory in VS Code.
2. Run `npm install` once.
3. Press **F5** and choose **Run VibeTour** if prompted.
4. In the Extension Development Host, click the **VibeTour** book icon in the Activity Bar.
5. Hover over a chapter row and click its play button. It starts at the first unfinished step.

Try these interactions:

- start or resume with the play button on a chapter row;
- clear only that chapter's progress with its reset button;
- switch between steps from the sidebar;
- read the persistent, expanded Markdown explanation beside the highlighted code;
- follow related-code links directly where a concept is mentioned in the explanation text;
- use **Done**, **Previous**, and **Next** from the explanation;
- click **Open related: How capacity is calculated**; the linked range receives a green background and a one-line **Back to...** action above it;
- follow other related links between the scheduler, block manager, request model, and worker;
- check and uncheck a step in the sidebar;
- use **Reset chapter** from the explanation or the chapter row.

Progress is stored in VS Code workspace state. This demo does not modify the source file.

Lesson UI is chapter-scoped. Before a chapter is started, its source ranges have no lesson decorations and its steps do not open comments. Completing every step ends the active chapter and removes its comment, highlights, related-code state, and Back action. Reset clears only that chapter and leaves it stopped until Play is selected again.

This version deliberately uses VS Code's Comments API because it is the stable editor API that can keep a large, multi-line explanation expanded next to source code. The demo workspace prevents the general Comments view from opening automatically, although lesson threads still technically participate in that view.

## Lesson source

The demo is loaded from `.code-lessons/request-lifecycle.yaml`. Code paths in YAML are relative to the workspace folder. Markdown explanations can link to stable related-location IDs with `code-ref:<related-id>` links.

Use the refresh icon in the VibeTour view for a manual reload. Automatic reload is enabled by default and can be configured with `codeLessons.searchPaths` and `codeLessons.autoReload`.

## What this spike is meant to answer

- Is the fixed VS Code comment styling acceptable in exchange for a persistent large explanation?
- Is chapter-level Play/Resume and Reset the right progress model?
- Is the explanation close enough to the relevant code?
- Are blue/current-yellow/completed-gray highlights understandable without being noisy?
- Should completion advance automatically?
- Is the sidebar useful as navigation and progress rather than as a document reader?

Use `npm run check` for a quick JavaScript syntax check and `npm test` for the loader tests.
