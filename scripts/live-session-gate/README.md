# Live-session gate instrument

Read [the maintained procedure](../../docs/live-session-cost-gate.md).

- `manifest.air.policy.json`: fixed public-safe policy, not a runnable declaration.
- `seal.py`: bind a clean committed instrument and baseline without running it.
- `controller.py`, `host.py`: integrity checks, envelope, raw evidence, state machine.
- `traffic.ts`: out-of-process preparation, generator and child lifecycle.
- `worker.ts`: real endpoint / third mutator processes.
- `instrument.ts`, `rusage.c`: synchronous owner/gate and native counter probes.
- `native-check.ts`: cross-process native-clock calibration, wrong-origin control,
  true gate-hold boundary and native mutex self-test (not the gate).
- `test_controller.py`: policy, refusal, evidence and state-machine checks.

Only scripts, this procedure and the manifest belong in the instrument change.
Never add a production bypass to make a gate pass. No library binary, machine
identity, result, host path or generated cache is committed here.
