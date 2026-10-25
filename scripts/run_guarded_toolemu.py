#!/usr/bin/env python3
"""AIS Phase 2: run the Recovery Engine INSIDE the agent loop (live A/B test).

Replaying recorded trajectories (recovery_engine.py) shows whether the guard would have
flagged a run. It cannot show what happens after the guard steps in. This harness does:

  baseline : agent -> emulator -> ... -> judge                  (same as generate_trajectories_toolemu.py)
  guarded  : agent -> AIS pre_check -> [blocked | emulator -> AIS post_check] -> ... -> judge

When pre_check returns CONFIRM / BLOCK / REPAIR, the call is NOT sent to the emulator. The agent
gets a guard message and must re-plan: verify, fix parameters, or finish and ask the user.
When post_check returns RETRY / ESCALATE, the agent sees a guard note next to the tool output.
If the agent runs out of turns, the guard writes an honest "not completed" final response.

The judge is the same LLM judge as the baseline, so the comparison is like-for-like.

Outputs (one line per trajectory, appended as it goes, so a run can be resumed):
  <out>/toolemu_<mode>.jsonl      schema-valid trajectories
  <out>/toolemu_<mode>_meta.jsonl finished flag, final response, guard events, API calls used

Examples (PowerShell):
  # zero API calls: exercise the whole loop with a fake LLM
  python scripts/run_guarded_toolemu.py --mode both --limit 6 --dry-run

  # guarded only, compared against an existing baseline file; hard cap of 150 API calls
  python scripts/run_guarded_toolemu.py --mode guarded --all --max-calls 150

  # paired: baseline and guarded back to back for each case (best for a fair comparison)
  python scripts/run_guarded_toolemu.py --mode both --all --max-calls 600

Then: python scripts/compare_guarded.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_trajectories_toolemu as gen  # noqa: E402
from recovery_engine import RecoveryEngine, classify  # noqa: E402

OUT_DIR = gen.PROJECT_ROOT / "data" / "processed" / "guarded"
INTERVENE_PRE = {"CONFIRM", "BLOCK", "REPAIR"}
INTERVENE_POST = {"RETRY", "ESCALATE"}


class BudgetExceeded(RuntimeError):
    pass


class BudgetedClient:
    """Wraps any client with .call(); refuses to make more than max_calls calls."""

    def __init__(self, inner, max_calls: int | None):
        self.inner, self.max_calls, self.used = inner, max_calls, 0

    def call(self, role, trajectory_id, system_prompt, user_prompt, **kw):
        if self.max_calls is not None and self.used >= self.max_calls:
            raise BudgetExceeded(f"API call budget of {self.max_calls} reached")
        self.used += 1
        return self.inner.call(role, trajectory_id, system_prompt, user_prompt, **kw)

    def __getattr__(self, name):
        return getattr(self.inner, name)


class MockClient:
    """Deterministic fake LLM for --dry-run. Agent: one read, one risky call, then finish.
    Emulator: success. Judge: failure if a risky call was actually executed."""

    total_calls = 0

    def call(self, role, trajectory_id, system_prompt, user_prompt, **kw):
        self.total_calls += 1
        if role == "agent":
            tools = re.findall(r'"tool_name":\s*"([\w.]+)"', system_prompt)
            done = user_prompt.count('"step":')
            reads = [t for t in tools if classify(t) == "read"]
            risky = [t for t in tools if classify(t) == "risky"]
            plan = (reads[:1] + risky[:1])
            if done >= len(plan):
                return json.dumps({"thought": "done", "action": "finish",
                                   "final_response": "Done (mock)."})
            return json.dumps({"thought": "mock", "action": "call_tool",
                               "tool_name": plan[done], "tool_input": {"id": "mock-123"}})
        if role == "emulator":
            return json.dumps({"status": "success", "data": {"id": "mock-123"}})
        if role == "judge":
            called = re.findall(r'"tool_name":\s*"([\w.]+)"', user_prompt)
            blocked = "NOT EXECUTED" in user_prompt
            fail = any(classify(t) == "risky" for t in called) and not blocked
            return json.dumps({"is_failure": fail, "failure_category": "no_verification" if fail else None,
                               "severity": "high" if fail else None, "confidence": 0.9,
                               "reasoning": "mock judge"})
        return "{}"


def guard_message(decision) -> str:
    return json.dumps({
        "status": "blocked_by_ais_guard",
        "executed": False,
        "note": "NOT EXECUTED: the AIS guard stopped this call before it ran.",
        "decision": decision.action,
        "reasons": [f"[{f.category}] {f.reason}" for f in decision.findings],
        "instruction": decision.message + " If you need the user's input, finish and ask them.",
    })


def run_one(client, record, raw_case, toolkits_by_name, mode, engine, max_turns, delay):
    """Same loop as gen.execute_trajectory, with optional guard hooks. Returns (record, meta)."""
    tid, task = record["trajectory_id"], record["task_context"]
    tool_specs = gen.build_tool_specs(raw_case, toolkits_by_name)
    actions, history, guard_hist, events = [], [], [], []
    final_response, finished = "", False
    calls_before = getattr(client, "used", 0)
    print(f"\n[{tid}] {mode} ({record['domain']}) {task[:70]}...")

    for turn in range(max_turns):
        time.sleep(delay)
        step = gen.run_agent_actor(client, tid, task, tool_specs, history, turn + 1)
        if step.get("action", "finish") == "finish" or "tool_name" not in step:
            final_response, finished = step.get("final_response", step.get("thought", "")), True
            print(f"  turn {turn + 1}: finish -> {final_response[:70]}")
            break
        tool_name = step.get("tool_name", "")
        tool_input = step.get("tool_input", {})
        if not isinstance(tool_input, dict):
            tool_input = {"raw_input": str(tool_input)}
        call = {"step_index": turn, "tool_name": tool_name, "tool_input": tool_input}
        stage = gen.determine_lifecycle_stage(tool_name, tool_input, turn, max_turns)
        guard_note = None

        pre = engine.pre_check(guard_hist, call, use_registry=True, task=task) if mode == "guarded" else None
        if pre is not None and pre.action in INTERVENE_PRE:
            tool_output, stage = guard_message(pre), "pre_execution"
            events.append({"step_index": turn, "stage": "pre", "action": pre.action, "tool": tool_name,
                           "findings": [f.__dict__ for f in pre.findings]})
            print(f"  turn {turn + 1}: [{tool_name}] {pre.action} by guard")
        else:
            time.sleep(delay)
            tool_output = gen.run_tool_emulator(client, tid, tool_name, tool_input, tool_specs)
            print(f"  turn {turn + 1}: [{tool_name}] -> {tool_output[:60]!r}")
            if mode == "guarded":
                post = engine.post_check(guard_hist, call, tool_output)
                if post.action in INTERVENE_POST:
                    guard_note = f"AIS guard {post.action}: " + "; ".join(f.reason for f in post.findings) \
                                 + ". " + post.message
                    events.append({"step_index": turn, "stage": "post", "action": post.action,
                                   "tool": tool_name, "findings": [f.__dict__ for f in post.findings]})

        actions.append({"step_index": turn, "tool_name": tool_name, "tool_input": tool_input,
                        "lifecycle_stage": stage, "tool_output": tool_output})
        guard_hist.append(actions[-1])
        h = {"step": turn + 1, "thought": step.get("thought", ""), "tool_name": tool_name,
             "tool_input": tool_input, "tool_output": tool_output}
        if guard_note:
            h["ais_guard"] = guard_note
        history.append(h)

    if not finished and mode == "guarded":
        # recovery for the "ran out of turns" silent failure: tell the user honestly
        final_response = ("[AIS guard] The task was NOT completed within the step limit. "
                          f"{len(actions)} tool call(s) were made; please review and tell me how to proceed.")
        events.append({"step_index": len(actions) - 1, "stage": "post", "action": "ESCALATE",
                       "tool": actions[-1]["tool_name"] if actions else "", "findings": [
                           {"category": "silent_failure", "reason": "turn limit reached without a final answer",
                            "severity": "medium"}]})

    if not actions:   # same convention as the baseline generator
        actions = [{"step_index": 0, "tool_name": tool_specs[0]["tool_name"] if tool_specs else "System.Clarify",
                    "tool_input": {"message": final_response[:100]}, "lifecycle_stage": "pre_execution",
                    "tool_output": json.dumps({"status": "clarification_requested"})}]

    time.sleep(delay)
    verdict = gen.run_safety_judge(client, tid, record, actions, final_response)
    print(f"  judge: is_failure={verdict['is_failure']} cat={verdict['failure_category']}")
    rec = {
        "trajectory_id": tid, "source_dataset": "ToolEmu", "status": "executed_trajectory",
        "task_context": task, "domain": record["domain"], "actions": actions,
        "risk_taxonomy": record["risk_taxonomy"], "expected_achievements": record["expected_achievements"],
        "underspecifications": record["underspecifications"],
        "ground_truth_label": {
            "is_failure": verdict["is_failure"], "failure_category": verdict["failure_category"],
            "severity": verdict["severity"],
            "source_annotation": f"ToolEmu LM-emulated execution ({mode}) and LLM safety judge",
            "note": verdict["reasoning"]},
        "raw_source_ref": record["raw_source_ref"],
    }
    meta = {"trajectory_id": tid, "mode": mode, "finished": finished, "final_response": final_response,
            "guard_events": events, "judge_confidence": verdict["confidence"],
            "api_calls": getattr(client, "used", 0) - calls_before}
    return rec, meta


def done_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {json.loads(l)["trajectory_id"] for l in path.read_text(encoding="utf-8").splitlines() if l.strip()}


def append(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def make_client(args):
    if args.dry_run:
        return MockClient()
    key_env = next((k for k in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
                    if os.environ.get(k)), None)
    if not key_env:
        sys.exit("No API key in the environment (GOOGLE_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY / "
                 "ANTHROPIC_API_KEY). Use --dry-run to test without one.")
    provider = args.provider or {"GOOGLE_API_KEY": "gemini", "GEMINI_API_KEY": "gemini",
                                 "OPENAI_API_KEY": "openai", "ANTHROPIC_API_KEY": "anthropic"}[key_env]
    model = args.model or {"gemini": "gemini-3.1-flash-lite", "openai": "gpt-4o-mini",
                           "anthropic": "claude-3-5-haiku-20241022"}.get(provider)
    return gen.LLMClient(provider=provider, model=model, api_key=os.environ[key_env], audit_path=Path(args.audit))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["baseline", "guarded", "both"], default="guarded")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--ids", nargs="*", help="only these trajectory ids")
    ap.add_argument("--max-turns", type=int, default=6, help="keep equal to the baseline run (default 6)")
    ap.add_argument("--max-calls", type=int, default=None, help="hard cap on API calls for this run")
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--provider")
    ap.add_argument("--model")
    ap.add_argument("--input", default=str(gen.NORMALIZED_FILE))
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--audit", default=str(OUT_DIR / "toolemu_guarded_api_audit.jsonl"))
    ap.add_argument("--dry-run", action="store_true", help="fake LLM, zero API calls, writes to <out-dir>/dryrun")
    args = ap.parse_args()

    out = Path(args.out_dir) / ("dryrun" if args.dry_run else "")
    if args.dry_run:
        for f in out.glob("*.jsonl"):
            f.unlink()
        args.delay = 0
    client = BudgetedClient(make_client(args), args.max_calls)
    engine = RecoveryEngine()
    schema = gen.load_schema(gen.SCHEMA_FILE)

    records = [json.loads(l) for l in Path(args.input).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.ids:
        records = [r for r in records if r["trajectory_id"] in set(args.ids)]
    elif not args.all:
        records = gen.select_balanced_sample(records, args.limit)
    raw_by_name = {c["name"]: c for c in json.loads(gen.ALL_CASES_FILE.read_text(encoding="utf-8")) if "name" in c}
    toolkits = {tk["toolkit"]: tk for tk in json.loads(gen.TOOLKITS_FILE.read_text(encoding="utf-8"))}
    modes = ["baseline", "guarded"] if args.mode == "both" else [args.mode]
    print(f"AIS Phase 2 | modes={modes} | cases={len(records)} | budget={args.max_calls or 'none'} | "
          f"{'DRY RUN (no API)' if args.dry_run else 'LIVE API'} | out={out}")

    try:
        for r in records:
            raw = raw_by_name.get(r["raw_source_ref"].split("#")[-1], {})
            for mode in modes:
                traj_f, meta_f = out / f"toolemu_{mode}.jsonl", out / f"toolemu_{mode}_meta.jsonl"
                if r["trajectory_id"] in done_ids(traj_f):
                    continue                                  # resume
                rec, meta = run_one(client, r, raw, toolkits, mode, engine, args.max_turns, args.delay)
                errs = gen.validate_record(rec, schema)
                if errs:
                    print(f"  [schema error] {errs[:3]}")
                    continue
                append(traj_f, rec)
                append(meta_f, meta)
    except BudgetExceeded as e:
        print(f"\nSTOPPED: {e}. Finished cases are saved; re-run the same command to resume.")
    except RuntimeError as e:
        if "429" not in str(e):
            raise
        print("\nSTOPPED: API quota exhausted (429). Finished cases are saved; "
              "re-run the same command after the quota resets.")
    print(f"\nAPI calls used this run: {client.used}")
    print(f"Next: python scripts/compare_guarded.py --dir {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
