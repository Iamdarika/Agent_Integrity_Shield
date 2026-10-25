# Agent-SafetyBench environments (vendored)

Source: https://github.com/thu-coai/Agent-SafetyBench (folder `environments/`)
Commit: 74feea8de601b3a1449a93fcf70017fe61556f73 (2025-08-12)
License: MIT (see LICENSE_Agent-SafetyBench.txt)

Only the 18 environments used by the 116 in-domain cases in
`data/processed/agentsafetybench_normalized.jsonl` are copied, plus `BaseEnv.py`.
Files are unmodified. Each `<Env>.json` holds the tool schemas; each `<Env>.py` is the
deterministic tool implementation that runs against the case's initial state
(`environments[i].parameters` in released_data.json). No LLM is used to emulate tools.
