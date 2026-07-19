---
name: generate-code-lesson
description: Generate or minimally update validated `.code-lessons` YAML for an interactive code lesson. Use when the user asks for a code lesson, walkthrough, lesson YAML, an explanation of recently changed code, or an update to an existing lesson. When only a few changes were made earlier in the conversation, default to a narrow temporary walkthrough of those changes rather than a repository-wide architecture lesson.
---

# Generate Code Lesson

Create code-lesson YAML grounded in the current checkout. Treat the lesson as a guided reading path through real code, not as a generic summary or a dump of every changed line.

## Authoring contract

Generate YAML in this supported shape:

```yaml
schema_version: 1

lesson:
  id: retry-backoff
  title: Retry Backoff
  description: Follow the new retry delay from policy calculation to request scheduling.

  metadata:
    type: walkthrough
    lifecycle: temporary

  chapters:
    - id: retry-policy
      title: Retry policy

      steps:
        - id: calculate-delay
          title: Calculate the next delay

          primary:
            file: src/retry_policy.py
            range:
              start_line: 28
              end_line: 34

          explanation: |
            The policy calculates a capped exponential delay that
            [the scheduler](code-ref:schedule-retry) consumes after recording
            the failed attempt.

          key_points:
            - The cap prevents later retries from growing without limit.

          related:
            - id: schedule-retry
              title: Scheduler consuming the delay
              location:
                file: src/scheduler.py
                range:
                  start_line: 81
                  end_line: 84
```

Treat the example paths and ranges as illustrative only. Verify every value against the target workspace.

Required fields and values:

- Set `schema_version` to integer `1`.
- Give `lesson.id` a stable value matching `[A-Za-z0-9_-]+`.
- Give the lesson a non-empty `title`, a non-empty learning-objective `description`, and a non-empty `chapters` list.
- Set `lesson.metadata.type` to `walkthrough` or `architecture` and `lesson.metadata.lifecycle` to `temporary` or `permanent`.
- Give every chapter a stable ID unique within the lesson, a non-empty title, and a non-empty steps list.
- Give every step a stable ID unique across the lesson, a non-empty title, exactly one `primary` location, and a non-empty Markdown `explanation`.
- Treat `key_points` and `related` as optional lists. Omit either when empty; an empty `related: []` remains valid.
- Give every related item an ID unique within its step, a non-empty title, and a `location`.

Every primary and related location uses this shape:

```yaml
file: src/example.py
range:
  start_line: 12
  end_line: 18
```

For every location:

- Use a `/`-separated path relative to the workspace folder containing the lesson.
- Keep the path inside the workspace; never start it with `/` or include `..`.
- Use positive, 1-based, inclusive line numbers with `end_line >= start_line`.
- Verify the file exists, the range fits the current checkout, and the selected code supports the explanation.
- Prefer the smallest coherent range; it may begin and end inside a function.

Explanations support Markdown. Keep each explanation to a compact lead line and use a YAML literal block (`|`) so source wrapping renders as one paragraph. Link related code with the exact syntax `[label](code-ref:<related-id>)`; the ID must exist in that step's `related` list. Put links wherever the concept appears rather than collecting them at the end.

The current extension navigates only by verified file paths and line ranges. Do not emit planned fields such as `symbol`, `anchor`, or `completion`; unknown optional fields may be tolerated, but generated lessons must stay within the supported shape above.

## Choose the operation and scope

Determine the operation from the user's current request and the conversation:

1. **Recent-change walkthrough**: Use when the user asks to explain, teach, or create a lesson for work just completed in this conversation. Default to `type: walkthrough` and `lifecycle: temporary`.
2. **New focused lesson**: Use when the user names a learning objective or execution path. Scope the lesson to that objective. Unless the user explicitly requests stable architecture documentation, default to `type: walkthrough` and `lifecycle: temporary`.
3. **Existing lesson update**: Use when the user refers to an existing lesson or when the same lesson already covers the requested objective. Patch it minimally.
4. **Architecture lesson**: Use `type: architecture` and `lifecycle: permanent` only when the user explicitly asks for stable, broad architectural knowledge.

Do not turn a small recent change into a whole-repository tour. If the reliable scope cannot be recovered from the request, conversation, changed files, or version-control state, ask one narrow clarifying question.

## Inspect before writing

1. Find the workspace root and inspect existing `.code-lessons/**/*.yaml` and `.code-lessons/**/*.yml`. Also respect custom `codeLessons.searchPaths` in workspace settings when present.
2. Check whether a lesson for the same objective already exists. Never overwrite an unrelated lesson that happens to have a similar filename or ID.
3. Establish code evidence:
   - Start with the user's latest objective and files changed in the current conversation.
   - Use the version-control diff when available to confirm recent changes.
   - If no diff is available, use the known edit history from the conversation and inspect the current files.
   - Read enough surrounding and calling code to verify behavior, but keep the lesson within the requested scope.
4. Exclude generated files, lockfiles, formatting-only edits, and incidental refactors unless they are essential to the behavior being taught.

## Build the lesson

For a few recent edits, usually create one temporary lesson with one or two chapters and a small number of conceptual steps. A step represents one idea or transition, not one diff hunk.

For a component-oriented walkthrough, choose a stable reading order before selecting ranges:

- Start with the top-level container or façade and cover each of its entry points in execution order, so the learner first sees the complete public control surface.
- Then give each substantial component or interface its own chapter, ordered by dependency or call flow. Within a component, read state and construction before lifecycle methods, then queries and cleanup paths.
- Avoid alternating between component files merely to follow individual calls. Keep the primary path within the current component and use related-code links for cross-component handoffs.
- Put generic interface extraction, integration notes, and design deltas after the concrete components they summarize.

Treat related-code links as the lesson's navigation layer, not as rare footnotes:

- When an explanation depends on a concrete caller, callee, trait or data definition, state owner, or paired cleanup/error path outside the primary range, add a related location unless it would add no new context.
- Prefer a small set of high-value destinations that lets the reader follow the call graph or dependency boundary. Do not dump every textual reference to a symbol.
- Mention every related destination inline at the concept it explains. A related item that is not linked from the explanation provides no guided navigation and should be removed.

For every step:

- Select exactly one primary file and one focused, 1-based inclusive range.
- Target the relevant statements inside a function when the whole function is not needed.
- Use separate primary steps for meaningful boundaries in different files.
- Write `explanation` as a compact description, usually one sentence and one paragraph. It is the bold lead line in the inline comment.
- Put genuinely additional detail in `key_points` only when the description alone is insufficient. Omit `key_points` when they would merely restate the description.
- Add useful related locations proactively when they clarify callers, callees, dependencies, ownership, or paired paths. A related location may be in any file and does not become a completion step.
- Insert related-code links where the concept appears in the prose, using `[label](code-ref:related-id)`. Links do not need to be collected at the end.
- Prefer no key points for a simple step. When needed, use a short list to expand the description with constraints, consequences, or non-obvious behavior.

Do not invent files, calls, state transitions, symbols, rationale, or before/after behavior. Mention the previous behavior only when it is verifiable from the diff or conversation.

## Preserve identity during updates

Completion state depends on stable lesson, chapter, and step IDs.

- Preserve the existing file path and IDs when the concept still exists.
- Update ranges, explanations, titles, and related locations in place.
- Preserve related IDs when the same link target still serves the same purpose.
- Add, remove, or reorder steps only when the code's conceptual reading order changed.
- Remove an ID only when its concept was removed or replaced.
- Do not regenerate unrelated chapters for a small code change.

## Write and validate

Write the lesson under the configured search path. With the default configuration, use:

- `.code-lessons/walkthroughs/<lesson-id>.yaml` for temporary walkthroughs.
- `.code-lessons/architecture/<lesson-id>.yaml` for permanent architecture lessons.

For a new file, follow an existing directory convention only when the workspace clearly and consistently uses one. Otherwise use the categorized paths above. A single older lesson stored directly under `.code-lessons/` does not require new lessons to use the flat layout, and this skill must not move existing files merely to normalize the layout.

Then run:

```bash
python3 <skill-directory>/scripts/validate_lesson.py \
  --workspace-root <workspace-root> <lesson-yaml>
```

Fix every reported error. After structural validation, manually inspect every primary and related range and confirm that it contains the code described by its title and explanation. Validation of line bounds alone is not enough.

Finish by reporting:

- the lesson file created or updated;
- whether it is a temporary walkthrough or permanent architecture lesson;
- the scope chosen, especially for recent-change mode;
- the validation result.

Do not start a chapter, change lesson progress, or modify source code unless the user separately asks for it.
