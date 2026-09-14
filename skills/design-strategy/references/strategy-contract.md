# Design Strategy Contract

Produce this artifact before substantial implementation. Keep it concise enough to guide code review, but explicit enough that the implementation agent does not need to invent product-level decisions.

```md
# Design Strategy: <flow/view/product area>

## Context
- Product:
- Target user:
- User job:
- Primary outcome:
- Platform(s):
- Constraints:

## Evidence
### Facts
- ...

### Measurements / observations
- ...

### Assumptions / unknowns
- ...

## Mechanisms that matter
- <cause -> effect -> design implication>

## Information hierarchy
1. Primary:
2. Secondary:
3. Contextual:
4. Rare / advanced:

## Navigation strategy
- Model:
- Why:
- Context preserved:

## Interaction strategy
- Primary interaction:
- Secondary/contextual actions:
- Input adaptations:
- Feedback/recovery:

## Layout and density strategy
- Focal area:
- Grouping:
- Density:
- Progressive disclosure:

## Platform adaptation
### iOS
- ...
### iPadOS
- ...
### macOS
- ...
### Web
- ...

Include only target platforms.

## States
- Initial:
- Loading/pending:
- Success:
- Empty:
- Error/recovery:
- Offline/degraded:
- Permission:
- Destructive/undo:

Remove irrelevant states only deliberately.

## Alternatives considered
### Alternative A
- Benefits:
- Costs/risks:

### Alternative B
- Benefits:
- Costs/risks:

## Decision
- Chosen direction:
- Why it wins in this context:
- What we intentionally do not optimize yet:

## Design-system implications
- Existing tokens/components to reuse:
- New reusable primitive/component needed:
- Avoid hard-coding strategy into one screen when it should be reusable.

## Success criteria
- Behavioral:
- Efficiency:
- Comprehension:
- Accessibility:
- Visual/consistency:

## Validation plan
- Runtime views/device classes to inspect:
- Measurements/observations to collect:
- What evidence would cause strategy revision:
```

## Screen-level compact contract

For smaller work, use:

```md
Screen: <name>
User job: <job>
Primary outcome: <outcome>
Primary action: <action>
Secondary actions: <actions>
Hierarchy: <ordered content/actions>
Navigation: <model>
Interaction: <model>
Density: <low|medium|high + reason>
Disclosure: <what remains visible vs contextual/hidden>
Platform adaptation: <rules>
States: <important states>
Constraints: <constraints>
Success evidence: <observable result>
Assumptions: <unknowns>
```

## Handoff rule

The implementation agent may decide component extraction, source-file organization, state-management mechanics, and code-level details within the contract. It must surface rather than silently override changes to hierarchy, navigation, user-visible interaction, platform behavior, scope, or success criteria.
