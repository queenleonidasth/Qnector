# Plan / Act for Qnector on ChatGPT

Plan / Act is an optional task-scoped **behavioral MCP dispatch guard**, not a Windows security boundary. Legacy tasks still begin in Act Mode for backward compatibility. To benefit from planning, explicitly start a Qnector task and enter Plan Mode.

## Workflow

1. In ChatGPT, enable Qnector and ask: "Use Qnector to start a task and plan this project before editing it."
2. ChatGPT calls memory.task_start and captures its taskId.
3. Pass that ID as memoryTaskId to **every** Qnector call for this task, including calls through inspect, mode, process, files, git, browser, and tasks.
4. Use mode.begin with title, summary and one or more numbered step descriptions. This saves revision 1 and **enters Plan Mode**.
5. Use inspect (read-only tool) or read-only actions on original tools to inspect code. In Plan Mode, execution and mutation requests are denied by ToolRegistry.
6. Use mode.get to review the revision. mode.update changes the plan, increases its revision and invalidates prior approval.
7. Only **after the user explicitly approves the displayed plan**, call mode_approve with the exact expectedRevision and the same memoryTaskId.
8. Execute the approved steps in Act Mode. Use mode.step with zero-based index and done to maintain the checklist.
9. Use mode.back_to_plan to reject **new** mutations for this task and revoke approval.

Do not issue mode_approve simply because a plan exists. The user must accept the exact plan revision. ChatGPT may still require confirmations for individual tools.

## ChatGPT panel

Qnector exposes an MCP Apps resource at ui://qnector/plan-act.html. Compatible hosts display the mode, revision, checklist and controls to approve, return to planning or continue execution in chat. The panel calls MCP via the host-provided window.openai tool bridge. It does not automate ChatGPT's browser, read cookies or acquire ChatGPT credentials.

Qnector cannot insert native controls into the ChatGPT composer. Without MCP Apps UI support, plain MCP tools still work.

The inspect tool is advertised with readOnlyHint=true and strictly allows read-only requests, including mode.get. Example tool input:

~~~json
{
  "target": "mode",
  "request": {"action": "get"},
  "memoryTaskId": "task_..."
}
~~~

## Persistence and recovery

Plan revisions and checklists are written atomically to plan-act-state.json beside Qnector's configuration, keyed by a memoryTaskId or hashed host session identifier. For cross-chat continuity, use memoryTaskId. MCP transport sessions are not guaranteed to be durable ChatGPT conversation identities.

Plan state survives Qnector restarts; it is task context, not identity/authentication or a secure secrets database. On reconnect, call mode.get or inspect target mode and verify actual running processes before retrying interrupted actions. Qnector Memory v2 remains available for task checkpoints and handoffs.

## Operational boundaries

- Plan Mode blocks new mutations through Qnector tools, including files, terminals, Git changes, browser/desktop actions, workflows and durable task starts.
- Operations **already in flight before switching to Plan Mode** continue unless explicitly canceled. Switching modes does not terminate existing jobs.
- This is a workflow policy, not an OS sandbox. It does not revoke Windows permissions, constrain other tools or stop external programs.
- Unknown actions are denied in Plan Mode; inspect denies all non-read actions in both modes.
- Approval changes Qnector task state but does not bypass ChatGPT confirmations or Windows permissions.
- Legacy conversations default to Act Mode until explicitly entering Plan Mode.

## Tests

Run pnpm typecheck, pnpm test, pnpm build and pnpm smoke:mcp.

PlanActStore unit tests cover persistence and revisions. Plan guard tests cover mutations and bypass attempts. HTTP MCP integration tests cover tool discovery, app resource, plan approval, writes and mode transitions.
