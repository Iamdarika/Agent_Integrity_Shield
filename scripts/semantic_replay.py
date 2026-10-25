#!/usr/bin/env python3
"""Dev check for the semantic guard: replay RECORDED baseline runs through it (cheap).

For every state-changing call in each recorded baseline run, ask the semantic reviewer what it
would have said. Then compare with the judge's label for that run:
  * failing runs it would have stopped (BLOCK or CONFIRM before the harm)   -> want high
  * safe runs it would have interrupted                                      -> want low
Costs one API call per state-changing call (answers are cached, so re-runs are free).
Use this on DEV data only (runs you have already looked at). Evaluate on unseen cases with
run_guarded_asb.py --mode all --exclude-from ...

  python scripts/semantic_replay.py --dir data/processed/guarded_asb --prefix asb --max-calls 80
  python scripts/semantic_replay.py --dir data/processed/guarded_asb --prefix asb --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run_guarded_toolemu import BudgetedClient, BudgetExceeded, make_client  # noqa: E402
from semantic_guard import SemanticGuard  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--prefix", default="asb")
    ap.add_argument("--max-calls", type=int, default=None)
    ap.add_argument("--provider")
    ap.add_argument("--model")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    d = Path(a.dir)
    a.audit = str(d / "semantic_replay_api_audit.jsonl")
    client = BudgetedClient(make_client(a), a.max_calls)
    sg = SemanticGuard(client, d / ("semantic_cache_dryrun.jsonl" if a.dry_run else "semantic_cache.jsonl"))
    runs = [json.loads(l) for l in (d / f"{a.prefix}_baseline.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

    rows = []
    try:
        for r in runs:
            verdicts = []
            for i, act in enumerate(r["actions"]):
                if '"clarification_requested"' in (act.get("tool_output") or ""):
                    continue
                if not sg.applies(act["tool_name"], act.get("tool_input")):
                    continue
                v = sg.review(r["task_context"], act["tool_name"], act.get("tool_input") or {},
                              recent=r["actions"][:i], trajectory_id=r["trajectory_id"])
                verdicts.append((act["step_index"], act["tool_name"], v))
            stop = next((x for x in verdicts if x[2]["decision"] in ("BLOCK", "CONFIRM")), None)
            rows.append({"id": r["trajectory_id"], "fail": bool(r["ground_truth_label"]["is_failure"]),
                         "stop": stop, "n": len(verdicts)})
    except BudgetExceeded as e:
        print(f"STOPPED: {e}. Cached answers are kept; re-run to continue.")
    except RuntimeError as e:
        if "429" not in str(e):
            raise
        print("STOPPED: API quota exhausted (429). Cached answers are kept; re-run later.")

    fail = [r for r in rows if r["fail"]]
    safe = [r for r in rows if not r["fail"]]
    print(f"\nruns checked: {len(rows)}/{len(runs)}   new API calls: {client.used}")
    if fail:
        print(f"failing runs the semantic check would stop: {sum(bool(r['stop']) for r in fail)}/{len(fail)}")
    if safe:
        print(f"safe runs it would interrupt:              {sum(bool(r['stop']) for r in safe)}/{len(safe)}")
    for label, group in (("FAILING", fail), ("SAFE", safe)):
        print(f"\n--- {label} runs ---")
        for r in group:
            if r["stop"]:
                step, tool, v = r["stop"]
                print(f"  {r['id']}: {v['decision']:7} step {step} {tool}  [{v.get('category', '')}] {v.get('reason', '')[:110]}")
            else:
                print(f"  {r['id']}: allowed ({r['n']} state-changing call(s) reviewed)")


if __name__ == "__main__":
    main()
