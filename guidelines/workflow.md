# Product Improvement Building Workflow

This document outlines the steps to build product improvements.

## Workflow Steps

### 1. Create Branch

Create a git branch for the feature. Create a spec folder in `/specs/{branch}/` for long-form documents.

### 2. Prepare Product Requirement Document (PRD)

- **Responsible**: Product Manager (Agent)
- **Task**: Write a Product Requirement Document following the [strict PRD format](docs/prd.md) within the spec folder. Name file `requirements.md`.
- **Gate**: User reviews and approves PRD

### 3. Prepare Screen Mockups (UI Bridge)

- **Responsible**: Product Designer (Agent)
- **Task**: Create screen mockups as Storybook stories for components/screens covered by the approved PRD. Capture scope, state coverage, role behavior, and content rules in concise UI notes inside the spec folder.
- **Gate**: User reviews and approves the UI bridge artifacts (Storybook screen mockups + UI notes)

### 4. Prepare Technical Specification (SPEC)

- **Responsible**: Software Architect (Agent)
- **Task**: Document technical implementation details, system architecture, and engineering design within the spec folder following [strict SPEC format](docs/spec.md). Name file `spec.md`. Use approved PRD and UI bridge artifacts as inputs.
- **Gate**: User reviews and approves SPEC

### 5. Decompose into Tasks

- **Responsible**: Engineering / Project Manager (Agent)
- **Task**: Decompose the PRD and SPEC into actionable tasks with dependencies. Each task gets a discipline prefix (FE:, BE:, TST:, QA:, INFR:) and design context. Create an epic per feature, then child tasks:
  ```bash
  br create "Feature Name" --type epic --priority <priority>
  br create "FE: component name" --priority <priority> --type task
  br create "BE: endpoint" --priority <priority> --type task
  br dep add <child-id> <parent-id>
  ```
- **Gate**: User reviews task breakdown (`br dep tree <epic-id>`)

### 6. Implement Code

- **Responsible**: Software Engineer (Agent)
- **Task**: Claim a task (`br update <id> --status in_progress`), then execute it following the PRD (requirements), SPEC (technical decisions), and individual task design context. Update progress with `br comments add <id> "..."`. Close with `br close <id> --reason "evidence"` when done.
- **Coverage target**: 90% line coverage for all new/changed code.
- **Methodology**:
  - `test-driven-development` -- RED-GREEN-REFACTOR cycle for all code changes
  - `verification-before-completion` -- evidence before closing any task

### 7. Write and Execute Tests

- **Responsible**: Software Engineer in Test (Agent)
- **Task**: Develop test cases, write automated tests, and verify the implementation meets acceptance criteria.
- **Coverage**: Run `bun run test` and verify coverage on new/changed files.

### 8. Close Feature

- **Responsible**: Engineering / Project Manager (Agent)
- **Task**: Verify all tasks closed (`br list --status open` should return empty), open PR, ensure CI is green.
