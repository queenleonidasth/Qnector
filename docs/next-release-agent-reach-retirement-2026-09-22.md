# Next release: retire the Agent Reach / Social Reader pilot

Status: source change only, based on v0.4.45. No version bump, new installer, GitHub push/release, desktop restart, or change to the installed app.

## Removed from subsequent builds

- Remove the `social` MCP tool and its registry handler; retain the eight core grouped tools and the existing conditional `tasks` durable API.
- Remove the Social Connections settings UI, IPC actions, preload exposure, local setup module, social reader adapters, social-only tests and live Facebook/YouTube smoke script.
- Remove the bundled `skills/social-reader/SKILL.md`; prevent packaging the retired Skill and assert that the packaged stdio MCP schema does not advertise `social`.
- Update HTTP, stdio, developer smoke, and integration expectations so an enabled legacy configuration cannot bring the reader back.

## Non-destructive compatibility

Existing `config.json` may contain the optional legacy `social` section from v0.4.45. Keep its schema and TypeScript type solely to round-trip existing fields when users change unrelated settings; do not create it in new default configs or expose any control or tool that consumes it. Previously installed `%LOCALAPPDATA%\\Qnector\\integrations\\agent-reach` executables, browser profile, extensions, and any personal account data are **not** touched by this source change. Historical reports under `docs/` remain archived evidence, not instructions for the next release.

The desktop release installer must be checked for files left over from the *previous installation*, particularly `resources/skills/social-reader`. Source and clean-candidate packaging exclude the Skill; verification of installed upgrade cleanup is a separate gate before release. No promise of an automatic uninstall or browser cleanup is made.

## Verification

Run TypeScript typecheck, lint, build, full test suite with one worker on Windows, MCP smoke, HTTP/stdio parity and the packaged Skill/resource checks before a future release. Verify full upgrade on an isolated installation and do not interrupt a running Qnector or user browser for this implementation.
