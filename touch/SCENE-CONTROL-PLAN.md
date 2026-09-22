# Scene Control Fix Plan

Status: Implemented and locally verified; awaiting clean Foundry-install
validation and explicit release authorization.

## Objective

Restore the Touch scene-control entry in Foundry VTT 12 through 14.

## Evidence

- The current `getSceneControlButtons` hook creates a standalone custom
  `touch` control group. The active Dev Bible identifies the existing Token
  controls as the supported v13/v14 extension point for module action tools.
- The standalone group also omits a required numeric `order` field and targets
  `touchRings` instead of the canonical Token controls layer.
- The action tools omit `toggle: false` and do not guard their `onChange`
  handlers against a deactivation event.

## Planned Change

1. Register Touch action tools during `init` on the existing Token controls:
   `token` for legacy arrays and `tokens` for v13+/v14 records.
2. Use the current `onChange` action path, mark one-shot tools non-toggle, and
   ignore deactivation events.
3. Add the GM hub only for GM users; retain player-safe tools for all users.
4. Preserve the legacy array and current record control layouts without
   mutating the rendered toolbar outside the hook.

## Verification

1. Completed: extended scene-control E2E coverage for v12 and v13+/v14,
   including activation, deactivation, duplicate-hook, and GM-gating paths.
2. Completed: full E2E suite and offline Foundry API validation.
3. Pending: clean Foundry install validation before publishing `0.1.3`.

## References

- RNK Dev Bible: `foundry-bible/03-scene-control-buttons.md`
- RNK Dev Bible: `foundry-bible/21-troubleshooting.md`
- RNK Dev Bible: `foundry-bible/35-testing-ci-workflow.md`
