# Composable workspace widgets

Pages persist layout only. Agents, apps, integrations, skills and telemetry remain
owned by their existing APIs. There is no new workflow, execution or goal model.

## Built-in widgets

- `native:system-map`: configured agent capabilities, with search and selection.
  Branches mean “can use”; they do not declare execution order or mandatory steps.
  Unknown attachments stay visible as capabilities instead of becoming invented apps.
- `native:context-inspector`: current resource details and links to existing management UI.
- `native:activity`: shared agent-detail activity reducer, history and SSE updates.
- `native:result-preview`: selected thought, tool input/result, or app-provided output.
- `native:helper`: hosts the existing Conversations contribution for Apteva Helper.
  Requires the installed contribution and eligible Helper; no parallel chat implementation.
- `native:workspace-summary`, `native:quick-actions`, `native:readiness`: resource counts,
  navigation and reported errors. Missing optional apps do not imply a broken workspace.
- Existing resource list and usage widget IDs and layouts continue to work.

## Optional app widget props

Existing props remain supported. Apps can opt into `widgetContext` and
`widgetActions` from `src/components/apps/widgetContext.ts`:

```tsx
widgetActions?.select({
  type: "agent", id: agent.id, label: agent.name, projectId,
});

widgetActions?.dispatch({
  type: "preview",
  preview: { title: "Report", text: reportText },
});
```

Context contains the page/project scope, selected resource, selected activity ID,
and optional transient preview. Selection and outputs are never saved to user layout
preferences. Context resets when navigating between page scopes.

For rich output, pass `preview.component` with `app`, `name`, `installId`, and `props`.
The renderer must already be declared by that installed app for
`chat.message_attachment` and available in this scope. Unknown/unavailable renderers
show a fallback message; no arbitrary HTML, iframe URL, or bundle URL is evaluated.
Plain text and structured data are also supported. Recorded telemetry payloads retain
the same display limits as agent detail activity.

Supported host actions: `select`, `clear_selection`, `select_activity`, `preview`,
`open`, `configure`, `ask_helper`. Open/configure resolve known resources to existing
pages. Unsupported actions (including generic run/retry) show feedback instead of
silently succeeding. Execution controls stay with the resource owner.

Ask Helper opens the inline Helper if present, otherwise the floating assistant.
The dashboard uses Conversations 0.24.19’s supported `composerRef.insertText`
contract to append a suggestion to the current draft, with a stable request ID
and explicit project/agent scope. Nothing is sent automatically. Both inline
Helper and the floating assistant use the same `AssistantConversation` bridge.
Unavailable, archived, voice-active, and mismatched conversations retain a
copyable suggestion with a reason and an explicit retry when supported. Older
Conversations versions keep the copy fallback. Welcome text and starter prompts
are host settings; the app owns their display and insertion.
Helper receives page identifiers only when the user's share-page-context preference
allows it. Enabling a Helper widget does not install or activate apps or agents.

## Data and live updates

The canvas owns resource loading, errors and refresh. Agent attachment reads are
bounded to four concurrent workers, refreshed when configuration changes or the user
refreshes. Widget instances reuse these results. Resource changes and telemetry
completion events invalidate the resource snapshot, with 30-second reconciliation.

Activity uses the existing shared telemetry bus, never opens a per-widget SSE stream,
and backfills on reconnect/visibility changes. The page host selects its validated
project or global bus scope; individual widgets do not change it. The optional
`view=runtime` project-activity API query includes completed thoughts and thread events.
Historical payloads are scoped to authorized agents by the existing server handler.

Custom global pages enforce the same app `dashboard_scopes` opt-in as the dashboard.
Each widget handles its own empty state; host errors remain visible with a refresh action.
When Inspector or Preview is absent, selections open a temporary detail panel.

## Focused workspace layout

Page metadata supports `layout: "grid" | "workspace"` (grid is the default).
Workspace uses the same saved widgets, data, and action bridge. Each widget can set
`placement: "assistant" | "main" | "activity" | "details"`; unset means main.
Configure the layout and placement in Settings → Pages. No dedicated Build route
or template is required.

On desktop the assistant stays beside the main view and activity. Selections open
Inspector or Preview over the right pane. On mobile, Helper/System/Activity controls
switch panes and details open in a sheet. Hidden panes stay mounted, preserving chat
state and drafts. Widgets receive `widgetContext.presentation: "workspace"` so they
can fill the available height. Existing grid and app widgets are unchanged.

## Connected native widgets

The page derives one `WorkspaceSystem` from its existing resource snapshot and
runtime activity. System map, Activity, Inspector, Result / preview, and Quick
actions use that same model. Their implementations live in separate modules;
`SystemWidgets.tsx` remains the public export surface.

- The map draws configured agent-to-capability connections, identifies shared
  capabilities, and highlights the capability associated with a selected tool.
  Shared capabilities can be explored as a group. Within each agent lane,
  selected, recently used, and unique capabilities appear before the others.
  Tool attribution requires one matching attached app/connection; ambiguous
  accounts remain unlinked. Connections never imply execution order.
- Live work requires recent telemetry or a fresh working status and an open
  telemetry connection. Running server processes remain “Online” otherwise.
  Old incomplete calls are “Unconfirmed,” not asserted to be running or finished.
- Configuration changes are compared against a baseline after initial loading.
  Highlights last 15 seconds; the page retains up to 20 observed changes. This is
  a transient UI journal, not persisted audit history. Attachment refreshes are
  batched and rate limited after tool completion and reconciled every 30 seconds.
- Activity defaults to all agents; filtering by agent, type, outcome, text, and
  following selection is explicit. Selection opens output and links back to the
  agent/capability. Text summaries keep raw tool input/result in the preview.
  The Work view folds successful thoughts with no recorded text and short,
  explicit main-thread waiting responses. This is a conservative English text
  heuristic, not a backend classification; other languages and uncertain text
  remain visible. Show routine, a thought filter, or a text search reveals those
  records. Tools, errors, and in-progress work are never folded. Results shows
  recorded responses and tool outputs, not a claim that the whole task is done.
- Inspector puts management navigation first and agent instructions in a
  disclosure. Management uses existing screens and switches to the owning
  project when appropriate. No generic execution/retry API is added.
- Result / preview separates output, input, and metadata. Explicit app preview
  descriptors still require the exact installed app, declared attachment renderer,
  permitted scope, and a running app. Global renderers require global opt-in.
  “Ask Helper to adjust this” prepares a prompt with identifiers and an
  output excerpt capped at 4,000 characters and appends it to Helper’s draft
  through the supported composer bridge, falling back to copying. It never sends.
  Workspace pages with a preview widget expose a persistent Results button.
  The preview lists recent outputs before selection and provides a recent-results
  disclosure while inspecting one, so outputs can be found without scanning events.
- Quick actions adapt to the selection, an empty project, confirmed missing
  attachments, and reported resource errors. They open existing setup screens or
  prepare Helper suggestions. They do not install apps or run agents themselves.

Conversations owns all chat behavior. These native widget improvements require no
Conversations source changes. The host consumes its existing composer interface.
The inline Helper uses a slim host starter bar instead of repeating the app's
chat heading. Start an idea only prepares a draft; it neither creates a new chat
nor sends a message. Conversations' own New conversation control remains intact.
