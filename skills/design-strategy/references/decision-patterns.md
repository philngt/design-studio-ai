# UI strategy decision patterns

These are decision frames, not component recipes. Select a pattern only after the user job, hierarchy, platform, constraints, and evidence are explicit.

## Navigation strategy

Choose by task topology:

- **Peer destinations**: use a small set of persistent top-level destinations when users switch among them frequently.
- **Hierarchical exploration**: use drill-down navigation when each step narrows context and backtracking is meaningful.
- **Source + detail**: use list/detail or sidebar/detail when users repeatedly scan a collection and inspect items.
- **Workspace + inspector**: use a stable work surface with contextual properties when the object remains primary while parameters change.
- **Route-addressable workspace**: on web, preserve meaningful locations in URLs when users benefit from refresh, sharing, history, or deep links.

Avoid adding a navigation layer merely to house a feature that can remain contextual.

## Layout strategy

Start from relationships:

1. identify the focal content/action;
2. group information that must be understood together;
3. separate controls that alter different scopes;
4. choose reading/scan order;
5. use extra space only when simultaneous context reduces work.

Prefer one strong hierarchy to many equally weighted cards. A card is a containment pattern, not a default unit of design.

## Disclosure strategy

Classify actions/information by frequency and timing:

- **Primary**: needed for the dominant task; keep obvious and efficient.
- **Secondary**: common but not dominant; keep discoverable without competing for first attention.
- **Contextual**: meaningful only for a selected object/state; reveal near that context.
- **Rare/advanced**: preserve access but defer until requested.

Progressive disclosure is good when it removes irrelevant decisions. It is bad when it hides information the user repeatedly needs to compare.

## Density strategy

Density is a task property, not a platform fashion.

Use lower density when comprehension, focus, touch accuracy, or emotional pacing matter. Use higher density when expert scanning, comparison, bulk manipulation, or long-session productivity matter. Increase density only while hierarchy, targetability, and readability remain intact.

## Interaction strategy

Choose the most suitable interaction mechanism:

- direct manipulation for spatial relationships and visible object transformations;
- forms for explicit structured data entry;
- commands/shortcuts for expert repetition and precision;
- selection + contextual actions for bulk/object workflows;
- search for large or poorly browseable spaces;
- filters when users repeatedly narrow a known collection;
- sort when relative ordering matters more than exclusion.

Do not add filter/sort/search merely because the data is a list. Tie each control to an observed retrieval problem.

## State strategy

For every important screen/flow define:

- initial/first-use;
- loading or pending;
- populated success;
- empty-but-valid;
- validation failure;
- recoverable operation failure;
- offline/degraded state when relevant;
- permission denial;
- destructive confirmation/undo;
- partial or stale data if the system can expose it.

Make the distinction between user state, system state, and transient interaction state visible enough that the user can predict consequences.

## Onboarding strategy

Prefer learning in context over a front-loaded tour. Introduce a concept before first meaningful use only when misunderstanding would block success, cause harm, or make the core value impossible to discover. Otherwise use progressive guidance at the moment of need.

Measure onboarding by successful transition into the core job, not by tutorial completion.

## Monetization strategy

Do not let monetization destroy the moment where the user first understands value. Place paywalls/upgrades where the relationship between value and limitation is legible. Distinguish product education from sales interruption. Never disguise paid actions as neutral navigation.

Evaluate conversion together with task completion, retention, trust, and cancellation/refund signals where available.

## Alternative generation

For substantial flows, generate at least two alternatives that differ structurally. Example:

- A: single focused task with progressive disclosure;
- B: persistent multi-pane workspace;
- C: command/search-first expert workflow.

Compare them against the same criteria. Do not call palette, typography, or corner-radius variants separate strategies.
