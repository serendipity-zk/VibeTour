# Changelog

All notable changes to VibeTour are documented here.

## [0.0.6] - 2026-07-27

### Added

- Added **Stage Reviewed Range** so a reviewed Step can stage only the Git
  changes intersecting its primary source range.
- Added partial staging for fresh untracked files, including files in
  repositories without a first commit.
- Added collapsed **Finished Lessons** and **Invalid Lessons** sections.
- Added direct navigation from an invalid lesson entry to its first YAML
  diagnostic.
- Added automated publication of the verified GitHub Release VSIX to the VS
  Code Marketplace using Microsoft Entra ID and GitHub OIDC.

### Changed

- Strengthened the bundled lesson-authoring skill with a coverage audit across
  meaningful in-scope staged, unstaged, untracked, and committed changes.
- Clarified nested-repository lesson roots and required meaningful integration
  wiring, tests, and changed components to be covered or explicitly excluded.
- Expanded release documentation and added visible release highlights to the
  README.

## [0.0.5] - 2026-07-19

### Added

- Added the MIT license and Marketplace license metadata.

## [0.0.4] - 2026-07-19

### Added

- Added recursive lesson discovery for nested repositories in multi-repo
  workspaces.
- Added repository-local path resolution for each nested `.code-lessons`
  directory.
- Added a nested-repository demo lesson and stronger lesson validation tests.

## [0.0.3] - 2026-07-19

### Added

- Added the bundled Codex and Claude lesson-authoring skill installer.
- Added local and global skill installation choices with version detection.
- Added the product screenshot and expanded installation and authoring
  documentation.

## [0.0.2] - 2026-07-19

### Changed

- Refined the inline lesson presentation, navigation controls, Markdown
  explanations, and development workflow.

## [0.0.1] - 2026-07-18

### Added

- Initial VibeTour extension with YAML-driven lessons, chapters, source
  highlighting, inline comments, and multi-file navigation.

[0.0.6]: https://github.com/serendipity-zk/VibeTour/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/serendipity-zk/VibeTour/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/serendipity-zk/VibeTour/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/serendipity-zk/VibeTour/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/serendipity-zk/VibeTour/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/serendipity-zk/VibeTour/releases/tag/v0.0.1
