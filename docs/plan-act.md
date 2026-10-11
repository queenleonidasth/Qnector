# Plan / Act for Qnector on ChatGPT

Plan / Act is an optional task-scoped **behavioral MCP dispatch guard**, not a Windows security boundary. Legacy tasks still begin in Act Mode for backward compatibility. To benefit from planning, explicitly start a Qnector task and enter Plan Mode.

## Workflow

1. In ChatGPT, enable Qnector and ask: "Use Qnector to start a task and plan this project before editing it."
2. ChatGPT calls memory.task_start and captures its taskId.
3. Pass that ID as memoryTaskId to **every** Qnector call for this task, including calls through inspect, mode, process, files, git, browser, and tasks.
4. Call `mode.begin` **early** to enforce strict read-only Plan Mode. This is a draft, not the user-facing panel.
5. Complete all inspection and analysis with `inspect` or other read-only actions. **Do not call `plan_panel` while researching, revising or drafting.**
6. Finalize the title, rationale and actionable checklist via `mode.update`. Verify the final revision using `mode.get`. Any update invalidates prior approval.
7. Only **after the plan is finished**, call `plan_panel(memoryTaskId)` **once as the final presentation tool call**. It shows a concise overview, progressive-disclosure details, real checklist progress, and the approval CTA.
8. The ChatGPT host always puts an inline app **above** the generated model reply. Qnector cannot force the iframe below a reply. After showing the panel, the assistant should give **at most one brief next-step sentence**, not a duplicate plan, table, or long explanation.
9. Only **after the user explicitly approves the displayed revision**, call `mode_approve(expectedRevision)`. Act Mode enables mutations; `mode.step` updates the checklist after verified work.
10. Use `mode.back_to_plan` to revoke approval and block **new** mutations. In the panel, selecting the Plan tab only focuses the separate return control; the user must press that control and explicitly confirm revocation. The Act tab likewise does not approve the plan; the dedicated revision approval button must be clicked. Do not display a new panel each time a step changes; the existing panel can refresh its state.

Do not issue mode_approve simply because a plan exists. The user must accept the exact plan revision. ChatGPT may still require confirmations for individual tools.

## ChatGPT panel

Qnector exposes the versioned MCP Apps resource `ui://qnector/plan-act-v4.html` through a dedicated read-only `plan_panel` presentation tool (with v2/v3 compatibility resources for older ChatGPT snapshots). Its standard `_meta.ui.resourceUri` and ChatGPT `_meta["openai/outputTemplate"]` point to the same view. The compact panel shows the complete plan by progressive disclosure: summary preview, expand/collapse, next three pending steps, show all steps, live completion progress, revision and an explicit approval CTA. These controls use real `window.openai.callTool` actions (including revision-checked approval), not simulated UI state. No ChatGPT browser automation, session tokens, cookies, remote UI scripts, or credentials are used.

Qnector cannot insert native controls into the ChatGPT composer. Without MCP Apps UI support, plain MCP tools still work. The controller appears **within the chat response after calling `plan_panel`**, not as a permanent ChatGPT composer toolbar. After installing a new Qnector version, go to ChatGPT Settings → Apps / Plugins → Qnector → Refresh tools, review/enable the new `mode`, `mode_approve`, `inspect` and `plan_panel` actions, and start a new chat. Workspace admins may need to review and publish the refreshed app tool list; ChatGPT does not automatically refresh a frozen approved app snapshot.

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
