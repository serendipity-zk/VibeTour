# VibeTour

VibeTour turns version-controlled YAML into guided code walkthroughs inside VS Code. A lesson opens the relevant source range, highlights the code, and keeps a rich explanation beside it while the reader moves through a chapter.

Use VibeTour to explain a recent change, document an execution path, onboard someone to a subsystem, or carry durable architectural knowledge alongside the code it describes.

## Features

- Discover lessons automatically from `.code-lessons/**/*.yaml` and `.yml`.
- Organize learning paths into lessons, chapters, and focused steps.
- Start, resume, reset, and track progress per chapter.
- Keep multi-line Markdown explanations expanded beside the relevant code.
- Link concepts in an explanation directly to related locations across files.
- Highlight the current, upcoming, completed, and related code ranges.
- Copy the current Step as YAML, ready to paste into Codex or Claude with a question.
- Validate lesson structure, paths, IDs, and line ranges and report errors in Problems.
- Reload lessons automatically when their YAML changes.
- Work with local, SSH, WSL, Dev Container, and Codespaces workspaces.

## Requirements

- VS Code 1.85 or newer.
- A workspace containing at least one valid code-lesson YAML file.

## Install

Download the latest `vibe-tour-<version>.vsix` from [GitHub Releases](https://github.com/serendipity-zk/VibeTour/releases/latest).

Install it from a terminal:

```bash
code --install-extension vibe-tour-<version>.vsix
```

Or open the VS Code Command Palette and run **Extensions: Install from VSIX...**. On Windows, do not double-click the VSIX: that may open the Visual Studio installer instead of VS Code.

### Remote Development

VibeTour runs as a workspace extension so it can read the project containing the lesson. For Remote SSH, WSL, Dev Containers, or Codespaces, install the VSIX from a VS Code window that is already connected to the remote workspace.

If the file picker shows the remote filesystem, first copy the VSIX to the remote machine and select it there. For example, from a local PowerShell session:

```powershell
scp "$env:USERPROFILE\Downloads\vibe-tour-<version>.vsix" `
  my-server:/tmp/vibe-tour-<version>.vsix
```

Then run **Extensions: Install from VSIX...** in the connected window and select the file under `/tmp`.

## Quick start

1. Open a project containing `.code-lessons/**/*.yaml` or `.yml`.
2. Select the **VibeTour** book icon in the Activity Bar.
3. Expand a Lesson and hover over a Chapter.
4. Select **Play** to start at its first unfinished Step.
5. Use the comment toolbar to move, mark the Step done, copy its YAML, or reset the Chapter.

VibeTour does not modify source files. Progress is stored in VS Code workspace state.

## Create lessons with Codex

This repository includes a lesson-authoring skill at `.agents/skills/generate-code-lesson`. When Codex is started from this repository, it discovers the skill automatically:

```text
Use $generate-code-lesson to create a focused lesson for the code we just changed.
```

To make the skill available in unrelated repositories, ask Codex:

```text
Please install the local Codex skill from .agents/skills/generate-code-lesson as a user skill. Preserve any existing installation and verify that the installed skill is discoverable.
```

User-wide Codex skills are stored under `$HOME/.agents/skills`. Restart Codex if the skill does not appear in `/skills` or the `$` skill picker.

## Lesson format

Code paths are relative to the workspace folder containing the lesson. Line numbers are 1-based and inclusive.

```yaml
schema_version: 1

lesson:
  id: request-lifecycle
  title: Request Lifecycle
  description: Follow a request from admission to execution.

  metadata:
    type: walkthrough
    lifecycle: temporary

  chapters:
    - id: request-admission
      title: Request admission

      steps:
        - id: check-capacity
          title: Check capacity

          primary:
            file: src/scheduler.py
            range:
              start_line: 17
              end_line: 18

          explanation: |
            The scheduler asks [the block manager](code-ref:capacity-check)
            whether the request fits before dispatching it.

          key_points:
            - A rejected request remains waiting.

          related:
            - id: capacity-check
              title: Capacity decision
              location:
                file: src/block_manager.py
                range:
                  start_line: 8
                  end_line: 10
```

The complete authoring contract and validator live in [`generate-code-lesson`](.agents/skills/generate-code-lesson/SKILL.md). A multi-file example is available in [`demo-workspace`](demo-workspace/.code-lessons/request-lifecycle.yaml).

## Navigation and progress

- **Play** starts or resumes a Chapter at its first unfinished Step.
- **Previous** and **Next** move through the active Chapter.
- **Done** completes the current Step and advances automatically.
- **Reset** clears only that Chapter and leaves it stopped until Play is selected again.
- Completing a Chapter removes its comment and active highlights.
- Completed ranges keep normal source text with a subdued background.
- Related-code links open and highlight their target; **Back** returns to the lesson Step.
- **Copy Step YAML** preserves the explanation's `code-ref` links and related locations for an AI question.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `codeLessons.searchPaths` | `[".code-lessons/**/*.yaml", ".code-lessons/**/*.yml"]` | Glob patterns searched in each workspace folder. |
| `codeLessons.autoReload` | `true` | Reload lessons when matching YAML files are created, changed, or deleted. |

Use the refresh icon in the VibeTour view to reload manually. Invalid lessons remain out of the tree and appear as diagnostics in the Problems panel.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

Open the repository in VS Code and press F5 to launch an Extension Development Host with the bundled demo workspace. The explicit `vibetour: build` task creates the extension bundle before launch.

Build an installable VSIX with:

```bash
npm run package
```

## Releases

The GitHub Actions workflow runs checks and tests, builds the bundle, and uploads a VSIX artifact. A tag matching `v<package.json version>` creates a GitHub Release and attaches the prebuilt VSIX; for example, package version `0.0.2` must use tag `v0.0.2`.

Manual workflow runs build the same downloadable artifact without creating a Release.

## Support

Report bugs and feature requests in [GitHub Issues](https://github.com/serendipity-zk/VibeTour/issues).
