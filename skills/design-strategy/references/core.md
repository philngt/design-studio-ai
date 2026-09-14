# Core mechanisms and principles

Use this reference to reason from cause and evidence before choosing UI structure.

## Reasoning ladder

Do not collapse every statement into a generic "best practice". Classify it:

`primitive -> knowledge -> mechanism -> principle -> mental model -> strategy -> implementation -> measurement`

- A **mechanism** explains cause and effect: why an interaction can produce an outcome.
- A **principle** is durable guidance inferred from mechanisms and repeated evidence.
- A **strategy** chooses what to prioritize under the current goals and constraints.
- An **implementation** is one concrete realization; it is replaceable without necessarily changing strategy.

Example:

- Mechanism: showing many equally prominent choices increases competition for attention and decision cost.
- Principle: reduce unnecessary simultaneous choices.
- Strategy: keep the primary action persistent, contextualize secondary actions, progressively disclose rare actions.
- Implementation: on iPhone use a focused toolbar/menu; on macOS use toolbar + menu + inspector.

## Human mechanisms to inspect

### Attention

Visual prominence competes for limited attention. When everything is emphasized, hierarchy collapses. Use position, scale, contrast, motion, grouping, and whitespace deliberately to answer: what should be noticed first, next, and later?

### Working memory and cognitive load

Every temporary rule, choice, mode, hidden dependency, and piece of information the user must remember adds load. Prefer recognition over recall, externalize important state, group related decisions, and defer choices that are not needed yet.

### Perception and grouping

Proximity, alignment, similarity, containment, continuity, and common movement affect perceived relationships. Layout is therefore semantic, not merely geometric.

### Motor cost

Touch, pointer, keyboard, and stylus have different acquisition costs and precision. Frequent actions deserve efficient reachable targets; dangerous actions need separation and confirmation proportional to consequence.

### Feedback and causality

Users build a model by observing action -> response. Show state changes, progress, success, failure, and reversibility close to the triggering action. Ambiguous or delayed feedback weakens the user's causal model.

### Navigation and spatial memory

Navigation has a cognitive cost. Preserve stable landmarks and context. Prefer moving through a structure the user can predict over forcing repeated reconstruction of where they are.

### Interruption and flow

Modal decisions, permission prompts, onboarding, upsells, and alerts consume attention and can destroy task momentum. Interrupt only when the decision is necessary at that moment or the consequence justifies it.

### Error prevention and recovery

Design for slips, incomplete knowledge, latency, offline states, and failed operations. Prevention is useful, but recovery, undo, drafts, and clear state are often more robust than blocking every possible mistake.

## Durable principles

Use these as decision prompts, not absolute laws:

1. Start from the user's job and desired outcome, not from a component catalog.
2. Give each view a clear hierarchy and dominant purpose.
3. Make system state and action consequences observable.
4. Minimize unnecessary simultaneous decisions.
5. Preserve context across navigation and transformations.
6. Put frequent/high-value actions on efficient paths.
7. Use progressive disclosure when complexity is real but not always relevant.
8. Prefer direct manipulation when it improves comprehension and control; prefer commands/forms when precision and repetition matter more.
9. Adapt interaction to the platform rather than scaling geometry.
10. Design loading, empty, error, offline, permission, destructive, and success states as first-class states.
11. Treat accessibility as an interaction constraint, not a post-processing checklist.
12. Measure the intended outcome after implementation and revise the strategy when evidence disagrees.

## Decision discipline

For a non-trivial decision, record:

- observed fact or measurement;
- relevant mechanism;
- principle being applied;
- alternatives considered;
- constraint/trade-off;
- chosen strategy;
- expected observable result.

If evidence is absent, explicitly write `hypothesis` and define the cheapest useful validation.
