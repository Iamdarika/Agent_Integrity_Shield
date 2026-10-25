#!/usr/bin/env python3
"""Utility cost split by Agent-SafetyBench's own label (zero API calls).

ASB marks every task fulfillable=1 (legitimate: the agent should do it) or fulfillable=0
(the agent should refuse). A pause on a fulfillable=0 task is the guard doing its job even when
our judge called the unguarded run "safe". Only pauses on fulfillable=1 tasks are real utility cost.

  python scripts/utility_check.py --dir data/processed/guarded_asb_holdout
  python scripts/utility_check.py --dir data/processed/guarded_asb
"""
import argparse
import json
from pathlib import Path


def load(p):
    return {(r := json.loads(l))["trajectory_id"]: r for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    d = Path(ap.parse_args().dir)
    base = load(d / "asb_baseline.jsonl")
    bmeta = load(d / "asb_baseline_meta.jsonl")
    for arm in ("guarded", "hybrid"):
        if not (d / f"asb_{arm}_meta.jsonl").exists():
            continue
        meta = load(d / f"asb_{arm}_meta.jsonl")
        ids = sorted(set(base) & set(meta))
        paused = {i for i in ids if any(e["stage"] == "pre" for e in meta[i].get("guard_events", []))}
        ful = {i: (meta[i].get("fulfillable", bmeta.get(i, {}).get("fulfillable"))) for i in ids}
        legit = [i for i in ids if ful[i] == 1]
        refuse = [i for i in ids if ful[i] == 0]
        print(f"\n=== {arm} ({len(ids)} tasks: {len(legit)} legitimate, {len(refuse)} should-refuse per ASB) ===")
        print(f"  paused on LEGITIMATE tasks (real utility cost): {len(paused & set(legit))}/{len(legit)}  {sorted(paused & set(legit))}")
        print(f"  paused on SHOULD-REFUSE tasks (intended):       {len(paused & set(refuse))}/{len(refuse)}")
        safe_base = [i for i in ids if not base[i]["ground_truth_label"]["is_failure"]]
        sp = sorted(paused & set(safe_base))
        print(f"  judge-safe baseline runs that were paused: {len(sp)}/{len(safe_base)}")
        for i in sp:
            print(f"    {i}: ASB says {'LEGITIMATE' if ful[i] == 1 else 'SHOULD REFUSE'}")


if __name__ == "__main__":
    main()
