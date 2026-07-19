#!/usr/bin/env python3
"""Validate code-lesson YAML structure and referenced line ranges."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any

try:
    import yaml
except ModuleNotFoundError:
    print("ERROR: PyYAML is required to validate lesson YAML.", file=sys.stderr)
    raise SystemExit(2)


ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
CODE_REF_PATTERN = re.compile(r"\(code-ref:([^)]+)\)")
ALLOWED_TYPES = {"architecture", "walkthrough"}
ALLOWED_LIFECYCLES = {"permanent", "temporary"}


class UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate mapping keys."""


def _construct_unique_mapping(
    loader: UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False
) -> dict[Any, Any]:
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


class LessonValidator:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root.resolve()
        self.errors: list[str] = []
        self._line_counts: dict[Path, int] = {}

    def error(self, label: str, message: str) -> None:
        self.errors.append(f"{label}: {message}")

    def require_mapping(self, value: Any, label: str) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            self.error(label, "must be an object")
            return None
        return value

    def require_list(
        self, value: Any, label: str, *, allow_empty: bool = False
    ) -> list[Any] | None:
        if not isinstance(value, list) or (not allow_empty and not value):
            qualifier = "an array" if allow_empty else "a non-empty array"
            self.error(label, f"must be {qualifier}")
            return None
        return value

    def require_string(self, value: Any, label: str) -> str | None:
        if not isinstance(value, str) or not value.strip():
            self.error(label, "must be a non-empty string")
            return None
        return value.strip()

    def require_id(self, value: Any, label: str) -> str | None:
        identifier = self.require_string(value, label)
        if identifier is not None and ID_PATTERN.fullmatch(identifier) is None:
            self.error(label, "must contain only letters, numbers, underscores, or hyphens")
            return None
        return identifier

    def validate_location(self, value: Any, label: str) -> None:
        location = self.require_mapping(value, label)
        if location is None:
            return

        raw_file = self.require_string(location.get("file"), f"{label}.file")
        range_value = self.require_mapping(location.get("range"), f"{label}.range")
        if raw_file is None or range_value is None:
            return

        normalized_file = raw_file.replace("\\", "/")
        relative = PurePosixPath(normalized_file)
        if relative.is_absolute() or normalized_file in {".", ".."} or ".." in relative.parts:
            self.error(f"{label}.file", "must stay inside the workspace folder")
            return

        start = range_value.get("start_line")
        end = range_value.get("end_line")
        if not isinstance(start, int) or isinstance(start, bool) or start < 1:
            self.error(f"{label}.range.start_line", "must be a positive integer")
            return
        if not isinstance(end, int) or isinstance(end, bool) or end < start:
            self.error(
                f"{label}.range.end_line",
                "must be an integer greater than or equal to start_line",
            )
            return

        file_path = self.workspace_root.joinpath(*relative.parts).resolve()
        try:
            file_path.relative_to(self.workspace_root)
        except ValueError:
            self.error(f"{label}.file", "resolves outside the workspace folder")
            return

        if not file_path.is_file():
            self.error(f"{label}.file", f"referenced file does not exist: {normalized_file}")
            return

        line_count = self._line_counts.get(file_path)
        if line_count is None:
            try:
                text = file_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                self.error(f"{label}.file", f"cannot read {normalized_file}: {exc}")
                return
            line_count = 0 if not text else len(re.split(r"\r?\n", text))
            self._line_counts[file_path] = line_count

        if end > line_count:
            self.error(
                f"{label}.range",
                f"range {start}-{end} exceeds {normalized_file} ({line_count} lines)",
            )

    def validate_document(self, data: Any, source: Path) -> str | None:
        root = self.require_mapping(data, str(source))
        if root is None:
            return None
        if root.get("schema_version") != 1:
            self.error(f"{source}.schema_version", "must be 1")

        lesson = self.require_mapping(root.get("lesson"), f"{source}.lesson")
        if lesson is None:
            return None

        lesson_id = self.require_id(lesson.get("id"), f"{source}.lesson.id")
        self.require_string(lesson.get("title"), f"{source}.lesson.title")
        self.require_string(lesson.get("description"), f"{source}.lesson.description")

        metadata = self.require_mapping(
            lesson.get("metadata"), f"{source}.lesson.metadata"
        )
        if metadata is not None:
            lesson_type = self.require_string(
                metadata.get("type"), f"{source}.lesson.metadata.type"
            )
            lifecycle = self.require_string(
                metadata.get("lifecycle"), f"{source}.lesson.metadata.lifecycle"
            )
            if lesson_type is not None and lesson_type not in ALLOWED_TYPES:
                self.error(
                    f"{source}.lesson.metadata.type",
                    f"must be one of {sorted(ALLOWED_TYPES)}",
                )
            if lifecycle is not None and lifecycle not in ALLOWED_LIFECYCLES:
                self.error(
                    f"{source}.lesson.metadata.lifecycle",
                    f"must be one of {sorted(ALLOWED_LIFECYCLES)}",
                )
            if lesson_type == "walkthrough" and lifecycle not in {None, "temporary"}:
                self.error(
                    f"{source}.lesson.metadata",
                    "walkthrough lessons must use lifecycle: temporary",
                )
            if lesson_type == "architecture" and lifecycle not in {None, "permanent"}:
                self.error(
                    f"{source}.lesson.metadata",
                    "architecture lessons must use lifecycle: permanent",
                )

        chapters = self.require_list(
            lesson.get("chapters"), f"{source}.lesson.chapters"
        )
        if chapters is None:
            return lesson_id

        chapter_ids: set[str] = set()
        step_ids: set[str] = set()
        for chapter_index, chapter_value in enumerate(chapters):
            chapter_label = f"{source}.lesson.chapters[{chapter_index}]"
            chapter = self.require_mapping(chapter_value, chapter_label)
            if chapter is None:
                continue
            chapter_id = self.require_id(chapter.get("id"), f"{chapter_label}.id")
            if chapter_id is not None:
                if chapter_id in chapter_ids:
                    self.error(f"{chapter_label}.id", f"duplicate chapter id {chapter_id!r}")
                chapter_ids.add(chapter_id)
            self.require_string(chapter.get("title"), f"{chapter_label}.title")

            steps = self.require_list(chapter.get("steps"), f"{chapter_label}.steps")
            if steps is None:
                continue
            for step_index, step_value in enumerate(steps):
                step_label = f"{chapter_label}.steps[{step_index}]"
                step = self.require_mapping(step_value, step_label)
                if step is None:
                    continue
                step_id = self.require_id(step.get("id"), f"{step_label}.id")
                if step_id is not None:
                    if step_id in step_ids:
                        self.error(f"{step_label}.id", f"duplicate step id {step_id!r}")
                    step_ids.add(step_id)
                self.require_string(step.get("title"), f"{step_label}.title")
                self.validate_location(step.get("primary"), f"{step_label}.primary")
                explanation = self.require_string(
                    step.get("explanation"), f"{step_label}.explanation"
                )

                key_points = step.get("key_points")
                if key_points is not None:
                    points = self.require_list(
                        key_points, f"{step_label}.key_points", allow_empty=True
                    )
                    if points is not None:
                        for point_index, point in enumerate(points):
                            self.require_string(
                                point, f"{step_label}.key_points[{point_index}]"
                            )

                related_value = step.get("related", [])
                related = self.require_list(
                    related_value, f"{step_label}.related", allow_empty=True
                )
                related_ids: set[str] = set()
                if related is not None:
                    for related_index, item_value in enumerate(related):
                        related_label = f"{step_label}.related[{related_index}]"
                        item = self.require_mapping(item_value, related_label)
                        if item is None:
                            continue
                        related_id = self.require_id(
                            item.get("id"), f"{related_label}.id"
                        )
                        if related_id is not None:
                            if related_id in related_ids:
                                self.error(
                                    f"{related_label}.id",
                                    f"duplicate related id {related_id!r}",
                                )
                            related_ids.add(related_id)
                        self.require_string(item.get("title"), f"{related_label}.title")
                        self.validate_location(
                            item.get("location"), f"{related_label}.location"
                        )

                if explanation is not None:
                    for target in CODE_REF_PATTERN.findall(explanation):
                        if ID_PATTERN.fullmatch(target) is None:
                            self.error(
                                f"{step_label}.explanation",
                                f"invalid code-ref target {target!r}",
                            )
                        elif target not in related_ids:
                            self.error(
                                f"{step_label}.explanation",
                                f"references unknown related id {target!r}",
                            )

        return lesson_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate code-lesson YAML and all referenced file ranges."
    )
    parser.add_argument(
        "lesson_yaml",
        nargs="+",
        type=Path,
        help="lesson YAML file(s) to validate",
    )
    parser.add_argument(
        "--workspace-root",
        type=Path,
        default=Path.cwd(),
        help="workspace root used to resolve lesson file paths (default: cwd)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    validator = LessonValidator(args.workspace_root)
    seen_lesson_ids: dict[str, Path] = {}

    for source in args.lesson_yaml:
        if not source.is_file():
            validator.error(str(source), "lesson YAML file does not exist")
            continue
        try:
            with source.open("r", encoding="utf-8") as stream:
                data = yaml.load(stream, Loader=UniqueKeyLoader)
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            validator.error(str(source), f"cannot parse YAML: {exc}")
            continue

        lesson_id = validator.validate_document(data, source)
        if lesson_id is not None:
            previous = seen_lesson_ids.get(lesson_id)
            if previous is not None:
                validator.error(
                    str(source),
                    f"duplicate lesson id {lesson_id!r}; already used by {previous}",
                )
            else:
                seen_lesson_ids[lesson_id] = source

    if validator.errors:
        for error in validator.errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"FAILED: {len(validator.errors)} error(s)", file=sys.stderr)
        return 1

    for source in args.lesson_yaml:
        print(f"OK: {source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
