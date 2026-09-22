# Scene Control Fix Plan

Status: Reopened after `0.1.3` did not render a dedicated scene-control icon.

## Objective

Restore the Touch scene-control entry in Foundry VTT 12 through 14.

## Evidence

- The `0.1.3` Token-controls integration did not supply the dedicated
  scene-control icon expected by Touch.
- The Dev Bible's dedicated-group pattern requires `order: 100`,
  `layer: "tokens"`, ready-time registration, and a forced controls refresh.

## Planned Change

1. Restore the stable dedicated `touch` control group for array and record
   schemas, with the required group order and Token layer.
2. Register the control hook at ready and trigger one controls refresh.
3. Keep one-shot action semantics and GM-only hub gating.

## Verification

1. Extend scene-control E2E coverage for the dedicated group in v12 and
   v13+/v14, including activation, deactivation, duplicate-hook, and GM paths.
2. Run the full E2E suite and Dev Bible API/manifest/package gates.
3. Validate a clean Foundry install before publishing `0.1.4`.

## References

- RNK Dev Bible: `foundry-bible/03-scene-control-buttons.md`
- RNK Dev Bible: `foundry-bible/21-troubleshooting.md`
- RNK Dev Bible: `foundry-bible/35-testing-ci-workflow.md`
