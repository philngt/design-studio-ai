# Platform strategy adapters

Choose interaction architecture from the environment's capabilities, not from viewport width alone. Preserve the user's task model while adapting navigation, density, controls, and concurrency.

## iOS / iPhone

Environment: direct touch, constrained viewport, one dominant context, variable one-handed use, short/interrupted sessions.

Prefer:
- a clear primary task and strong hierarchy;
- shallow, predictable navigation with preserved back context;
- progressive disclosure for secondary and rare actions;
- touch-sized targets and reachable frequent actions;
- sheets for focused transient tasks when they preserve the underlying context;
- system conventions for navigation, editing, selection, permissions, share, search, and destructive confirmation;
- concise copy and content that earns scarce vertical space.

Question before using persistent sidebars, dense toolbars, hover-dependent actions, multi-column assumptions, or desktop-style inspector panels.

## iPadOS

Environment: large touch surface, resizing/multitasking, orientation changes, keyboard and pointer often available, drag and drop, more simultaneous context.

Prefer when the task benefits:
- adaptive sidebar/content/detail structures;
- persistent context rather than simply stretching an iPhone column;
- multi-selection and drag/drop for collection workflows;
- keyboard shortcuts and pointer affordances without making touch secondary;
- inspectors or supplementary panes for properties that users repeatedly compare or edit;
- layouts that survive compact split-view widths and expand intentionally at wider sizes.

Do not assume iPad always means maximum density. A consumption or focus task can still deserve a narrow readable measure and low complexity.

## macOS

Environment: precise pointer, keyboard, multiple windows, resizable surfaces, menus, toolbars, context menus, high information density, long sessions.

Prefer when appropriate:
- menu commands for complete command discoverability;
- keyboard shortcuts for frequent/repetitive work;
- toolbar for common contextual actions, not every command;
- sidebars for navigation/source lists and inspectors for properties;
- multi-window or tabs when users genuinely work across independent contexts;
- selection-first interactions and context menus;
- denser tables, lists, and property controls when scan/comparison efficiency benefits.

Avoid porting a phone navigation stack into a large window without considering persistent navigation, command structure, and simultaneous context.

## Web

Environment: many viewport sizes, pointer/keyboard/touch combinations, browser history, URLs, refresh/deep links, variable network, semantic accessibility requirements.

Prefer:
- semantic document and control structure;
- intentional URL/state mapping for navigable application states;
- responsive reflow based on task needs, not device labels alone;
- keyboard navigation and visible focus;
- hover as enhancement, never the only route to an essential action;
- resilient loading/error/retry states and useful behavior under latency;
- progressive enhancement where platform/browser capability varies;
- layouts that preserve reading order when columns collapse.

For web applications, distinguish application navigation, document navigation, browser navigation, overlays, and transient local state. Do not trap state in an unshareable visual shell when deep linking is valuable.

## Cross-platform adaptation matrix

For every major flow, compare these dimensions:

| Dimension | iOS | iPadOS | macOS | Web |
| --- | --- | --- | --- | --- |
| Primary input | Touch | Touch + pointer/keyboard | Pointer + keyboard | Pointer/keyboard/touch |
| Context | Focused | Multiple panes possible | Multiple panes/windows | Responsive, URL-addressable |
| Density | Low-medium | Medium/adaptive | Medium-high | Adaptive |
| Navigation bias | Stack/tabs | Sidebar/split + stack | Sidebar/menu/window | Routes/sidebar/top nav |
| Secondary actions | Menu/sheet/context | Context/inspector/toolbar | Menu/context/toolbar/inspector | Menu/context/sidebar/dialog |
| Repetition efficiency | Gestures/short paths | Keyboard + multi-select | Shortcuts/commands | Shortcuts/bulk actions |

The matrix is a starting hypothesis, not a mandate. The user job and evidence overrule defaults.

## Adaptation test

Before accepting a cross-platform design, ask:

1. Which task and information hierarchy remain invariant?
2. Which interaction changes because the input mechanism changed?
3. Which context can remain visible because more space is useful rather than merely available?
4. Which actions become more efficient through keyboard, pointer, multi-select, or drag/drop?
5. What happens at the narrowest realistic window or split-view width?
6. Are platform-native expectations being violated for a measurable product reason or merely for visual consistency?
