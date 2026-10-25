#!/usr/bin/env python3
"""AIS on Agent-SafetyBench: baseline vs guarded, with REAL tool execution.

This is the out-of-benchmark test. The Recovery Engine was built and tuned only on ToolEmu;
none of these tasks, tools or environments were seen while writing the rules.

Differences from the ToolEmu harness:
  * Tools are not emulated by an LLM. Each call runs the benchmark's own Python environment
    (data/raw/agentsafetybench/environments/) against the case's initial state. Cheaper too:
    no emulator calls, so roughly 4-5 API calls per case per arm.
  * The guard's tool registry (required params, listed values) is built from ASB's schemas.
  * There is NO silent mock fallback: without an API key it stops, unless you pass --dry-run.

  python scripts/run_guarded_asb.py --mode both --limit 6 --dry-run      # zero API calls
  python scripts/run_guarded_asb.py --mode both --limit 40 --max-calls 450
  python scripts/compare_guarded.py --dir data/processed/guarded_asb --prefix asb

Hybrid (rules + semantic LLM check) on cases NOT used before:
  python scripts/run_guarded_asb.py --mode all --limit 30 --exclude-from data/processed/guarded_asb \
      --out-dir data/processed/guarded_asb_holdout --max-calls 480
  python scripts/compare_guarded.py --dir data/processed/guarded_asb_holdout --prefix asb --arm hybrid
"""
from __future__ import annotations

import argparse
import copy
import importlib
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_trajectories_toolemu as gen  # noqa: E402
from recovery_engine import RecoveryEngine  # noqa: E402
from semantic_guard import SemanticGuard, merge  # noqa: E402
from run_guarded_toolemu import (INTERVENE_POST, INTERVENE_PRE, BudgetedClient,  # noqa: E402
                                 BudgetExceeded, append, done_ids, guard_message, make_client)

ROOT = gen.PROJECT_ROOT
ENV_DIR = ROOT / "data" / "raw" / "agentsafetybench" / "environments"
RAW = ROOT / "data" / "raw" / "agentsafetybench" / "released_data.json"
NORMALIZED = ROOT / "data" / "processed" / "agentsafetybench_normalized.jsonl"
OUT_DIR = ROOT / "data" / "processed" / "guarded_asb"
sys.path.insert(0, str(ENV_DIR))   # ASB environments import "from BaseEnv import BaseEnv"


# ----------------------------------------------------------------------------- environments
def load_env(name: str, params):
    mod = importlib.import_module(name)
    return getattr(mod, name)(parameters=copy.deepcopy(params) if params else None)


def env_specs(case: dict):
    """Instantiate the case's environments; return (envs, tool_specs, registry)."""
    envs, specs, registry = {}, [], {}
    for e in case["environments"]:
        name = e["name"]
        if not name:
            continue
        env = load_env(name, e.get("parameters"))
        envs[name] = (env, set(e["tools"]))
        for d in env.get_tool_descs(e["tools"]):
            props = d.get("parameters", {}).get("properties", {})
            req = set(d.get("parameters", {}).get("required", []))
            full = f"{name}.{d['name']}"
            specs.append({
                "toolkit": name, "tool_name": full, "summary": d.get("description", ""),
                "parameters": [{"name": k, "type": v.get("type", "string"),
                                "description": v.get("description", ""), "required": k in req}
                               for k, v in props.items()],
                "returns": [],
            })
            registry[full] = {"required": req, "params": set(props), "enums": {
                k: {str(x).lower() for x in v["enum"]} for k, v in props.items() if isinstance(v.get("enum"), list)}}
    return envs, specs, registry


def execute(envs: dict, tool_name: str, args: dict) -> str:
    env_name, _, fn = tool_name.partition(".")
    if env_name not in envs or fn not in envs[env_name][1] or not envs[env_name][0].has_tool(fn):
        return json.dumps({"success": False, "message": f"Tool {tool_name} doesn't exist."})
    try:
        out = envs[env_name][0].call_tool(fn, copy.deepcopy(args))
    except Exception as e:          # the benchmark's own code raised: report it like a tool error
        out = {"success": False, "message": f"{type(e).__name__}: {e}"}
    return json.dumps(out, ensure_ascii=False, default=str)


# ----------------------------------------------------------------------------- one run
def run_one(client, record, case, mode, max_turns, delay, semantic: SemanticGuard | None = None):
    tid, task = record["trajectory_id"], record["task_context"]
    envs, specs, registry = env_specs(case)
    engine = RecoveryEngine(registry=registry)
    actions, history, guard_hist, events = [], [], [], []
    final, finished = "", False
    before = getattr(client, "used", 0)
    print(f"\n[{tid}] {mode} ({record['domain']}, fulfillable={case.get('fulfillable')}) {task[:70]!r}")

    for turn in range(max_turns):
        time.sleep(delay)
        step = gen.run_agent_actor(client, tid, task, specs, history, turn + 1)
        if step.get("action", "finish") == "finish" or "tool_name" not in step:
            final, finished = step.get("final_response", step.get("thought", "")), True
            print(f"  turn {turn + 1}: finish -> {str(final)[:70]}")
            break
        tool = step.get("tool_name", "")
        args = step.get("tool_input", {})
        if not isinstance(args, dict):
            args = {"raw_input": str(args)}
        call = {"step_index": turn, "tool_name": tool, "tool_input": args}
        stage = gen.determine_lifecycle_stage(tool, args, turn, max_turns)
        note = None
        pre = engine.pre_check(guard_hist, call, use_registry=True, task=task) if mode != "baseline" else None
        if mode == "hybrid" and semantic and pre.action != "BLOCK" and semantic.applies(tool, args):
            sem = semantic.review(task, tool, args, recent=guard_hist, trajectory_id=tid)
            events.append({"step_index": turn, "stage": "semantic", "action": sem["decision"], "tool": tool,
                           "findings": [{"category": sem.get("category", ""), "reason": sem.get("reason", ""),
                                         "severity": "high"}]})
            pre = merge(pre, sem)
        if pre is not None and pre.action in INTERVENE_PRE:
            out, stage = guard_message(pre), "pre_execution"
            events.append({"step_index": turn, "stage": "pre", "action": pre.action, "tool": tool,
                           "findings": [f.__dict__ for f in pre.findings]})
            print(f"  turn {turn + 1}: [{tool}] {pre.action} by guard")
        else:
            out = execute(envs, tool, args)
            print(f"  turn {turn + 1}: [{tool}] -> {out[:60]!r}")
            if mode != "baseline":
                post = engine.post_check(guard_hist, call, out)
                if post.action in INTERVENE_POST:
                    note = f"AIS guard {post.action}: " + "; ".join(f.reason for f in post.findings) + ". " + post.message
                    events.append({"step_index": turn, "stage": "post", "action": post.action, "tool": tool,
                                   "findings": [f.__dict__ for f in post.findings]})
        actions.append({"step_index": turn, "tool_name": tool, "tool_input": args,
                        "lifecycle_stage": stage, "tool_output": out})
        guard_hist.append(actions[-1])
        h = {"step": turn + 1, "thought": step.get("thought", ""), "tool_name": tool, "tool_input": args,
             "tool_output": out}
        if note:
            h["ais_guard"] = note
        history.append(h)

    if not finished and mode != "baseline":
        final = ("[AIS guard] The task was NOT completed within the step limit. "
                 f"{len(actions)} tool call(s) were made; please review and tell me how to proceed.")
        events.append({"step_index": len(actions) - 1, "stage": "post", "action": "ESCALATE",
                       "tool": actions[-1]["tool_name"] if actions else "",
                       "findings": [{"category": "silent_failure", "reason": "turn limit reached without a final answer",
                                     "severity": "medium"}]})
    # No tool was called: leave actions empty. Do not invent a call that never happened.

    time.sleep(delay)
    v = gen.run_safety_judge(client, tid, record, actions, final)
    print(f"  judge: is_failure={v['is_failure']} cat={v['failure_category']}")
    rec = {
        "trajectory_id": tid, "source_dataset": "Agent-SafetyBench", "status": "executed_trajectory",
        "task_context": task, "domain": record["domain"], "actions": actions,
        "risk_taxonomy": record["risk_taxonomy"], "expected_achievements": record["expected_achievements"],
        "underspecifications": record["underspecifications"],
        "ground_truth_label": {"is_failure": v["is_failure"], "failure_category": v["failure_category"],
                               "severity": v["severity"],
                               "source_annotation": f"Agent-SafetyBench, real environment execution ({mode}), LLM safety judge",
                               "note": v["reasoning"]},
        "raw_source_ref": record["raw_source_ref"],
    }
    meta = {"trajectory_id": tid, "mode": mode, "finished": finished, "final_response": final,
            "guard_events": events, "judge_confidence": v["confidence"],
            "fulfillable": case.get("fulfillable"), "api_calls": getattr(client, "used", 0) - before}
    return rec, meta


def pick(records: list[dict], limit: int, seed: int) -> list[dict]:
    """Balanced by domain, reproducible (fixed seed), so the sample is chosen before seeing results."""
    rng = random.Random(seed)
    by_dom: dict[str, list] = {}
    for r in sorted(records, key=lambda r: r["trajectory_id"]):
        by_dom.setdefault(r["domain"], []).append(r)
    for v in by_dom.values():
        rng.shuffle(v)
    out, doms = [], sorted(by_dom)
    while len(out) < limit and any(by_dom.values()):
        for d in doms:
            if by_dom[d] and len(out) < limit:
                out.append(by_dom[d].pop())
    return sorted(out, key=lambda r: r["trajectory_id"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["baseline", "guarded", "hybrid", "both", "all"], default="both",
                    help="both = baseline+guarded; all = baseline+guarded+hybrid")
    ap.add_argument("--exclude-from", help="skip cases already run in this output folder (to get unseen cases)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--ids", nargs="*")
    ap.add_argument("--max-turns", type=int, default=6)
    ap.add_argument("--max-calls", type=int, default=None)
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--provider")
    ap.add_argument("--model")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument("--audit", default=None, help="API audit log (default: <out-dir>/asb_guarded_api_audit.jsonl)")
    ap.add_argument("--dry-run", action="store_true", help="fake LLM, zero API calls, writes to <out-dir>/dryrun")
    args = ap.parse_args()

    out = Path(args.out_dir) / ("dryrun" if args.dry_run else "")
    if args.audit is None:
        args.audit = str(out / "asb_guarded_api_audit.jsonl")
    if args.dry_run:
        for f in out.glob("*.jsonl"):
            f.unlink()
        args.delay = 0
    client = BudgetedClient(make_client(args), args.max_calls)
    schema = gen.load_schema(gen.SCHEMA_FILE)
    raw = {c["id"]: c for c in json.loads(RAW.read_text(encoding="utf-8"))}
    records = [json.loads(l) for l in NORMALIZED.read_text(encoding="utf-8").splitlines() if l.strip()]
    for r in records:
        r["_case"] = raw[int(r["raw_source_ref"].rsplit("_", 1)[-1])]
    skipped = [r["trajectory_id"] for r in records if "dialog" in r["_case"]]
    records = [r for r in records if "dialog" not in r["_case"]]     # multi-turn dialog cases need a different loop
    if args.ids:
        records = [r for r in records if r["trajectory_id"] in set(args.ids)]
    if args.exclude_from:
        seen = set()
        for f in Path(args.exclude_from).glob("asb_*.jsonl"):
            if not f.name.endswith("_meta.jsonl") and "audit" not in f.name:
                seen |= done_ids(f)
        records = [r for r in records if r["trajectory_id"] not in seen]
        print(f"excluding {len(seen)} cases already run in {args.exclude_from}; {len(records)} unseen remain")
    if not args.ids and not args.all:
        records = pick(records, args.limit, args.seed)
    modes = {"both": ["baseline", "guarded"], "all": ["baseline", "guarded", "hybrid"]}.get(args.mode, [args.mode])
    semantic = SemanticGuard(client, Path(args.out_dir) / ("dryrun" if args.dry_run else "") / "semantic_cache.jsonl") \
        if "hybrid" in modes else None
    print(f"AIS on Agent-SafetyBench | modes={modes} | cases={len(records)} | budget={args.max_calls or 'none'} | "
          f"{'DRY RUN (no API)' if args.dry_run else 'LIVE API'} | out={out}"
          + (f" | skipped dialog cases: {skipped}" if skipped else ""))
    try:
        for r in records:
            case = r.pop("_case")
            for mode in modes:
                tf, mf = out / f"asb_{mode}.jsonl", out / f"asb_{mode}_meta.jsonl"
                if r["trajectory_id"] in done_ids(tf):
                    continue
                rec, meta = run_one(client, r, case, mode, args.max_turns, args.delay, semantic)
                errs = gen.validate_record(rec, schema)
                if errs:
                    print(f"  [schema error] {errs[:3]}")
                    continue
                append(tf, rec)
                append(mf, meta)
    except BudgetExceeded as e:
        print(f"\nSTOPPED: {e}. Finished cases are saved; re-run the same command to resume.")
    except RuntimeError as e:
        if "429" not in str(e):
            raise
        print("\nSTOPPED: API quota exhausted (429). Finished cases are saved; re-run after the quota resets.")
    print(f"\nAPI calls used this run: {client.used}")
    print(f"Next: python scripts/compare_guarded.py --dir {out} --prefix asb")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
