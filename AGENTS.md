# AGENTS.md

Read CLAUDE.md first: it is the contract for every agent working in this repository.

## Reviews before every commit

Run the `code-review` skill and then the `security-review` skill on the changes before every commit, in every branch, however small the change. In Claude Code they are `/code-review` and `/security-review`; in Codex they are the skills of the same names (installed in the agents' Codex, `codex review --base <default-branch>` is the second opinion). Fix what they find before committing; if a finding is dismissed, the commit message says which one and why, and it ends with a line saying both reviews ran. The pre-commit hooks stay on: never `--no-verify`.
