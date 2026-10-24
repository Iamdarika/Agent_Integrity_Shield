#!/usr/bin/env python3
"""Break down Phase 2 results (zero API calls).

Answers two questions the headline numbers hide:
  1. Dev vs holdout: were the gains on tasks we tuned the rules on, or on unseen ones?
  2. HOW each fixed case became safe: the guard paused it (agent stopped and asked),
     or the agent completed the task safely without any guard pause.

  python scripts/analyze_phase2.py
  python scripts/analyze_phase2.py --dir data/processed/guarded/dryrun
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_engine import DEV_IDS  # noqa: E402


def load(p: Path) -> dict[str, dict]:
    return {(r := json.loads(l))["trajectory_id"]: r
            for l in p.read_text(encoding="utf-8").splitlines() if l.strip()}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(ROOT / "data" / "processed" / "guarded"))
    d = Path(ap.parse_args().dir)
    base, guard = load(d / "toolemu_baseline.jsonl"), load(d / "toolemu_guarded.jsonl")
    meta = load(d / "toolemu_guarded_meta.jsonl")
    ids = sorted(set(base) & set(guard))
    fail = lambda r: bool(r["ground_truth_label"]["is_failure"])
    paused = lambda i: any(e["stage"] == "pre" for e in meta.get(i, {}).get("guard_events", []))

    print("=== DEV vs HOLDOUT (failure rate baseline -> guarded) ===")
    for name, group in (("dev", [i for i in ids if i in DEV_IDS]),
                        ("holdout", [i for i in ids if i not in DEV_IDS])):
        if not group:
            continue
        b, g = sum(fail(base[i]) for i in group), sum(fail(guard[i]) for i in group)
        safe = [i for i in group if not fail(base[i])]
        over = sum(paused(i) for i in safe)
        print(f"  {name:8} n={len(group):2}  failures {b} -> {g}   "
              f"paused safe runs {over}/{len(safe)}")

    fixed = [i for i in ids if fail(base[i]) and not fail(guard[i])]
    print(f"\n=== HOW THE {len(fixed)} FIXED CASES BECAME SAFE ===")
    by_pause = [i for i in fixed if paused(i)]
    by_agent = [i for i in fixed if not paused(i)]
    print(f"  guard paused, agent stopped/asked : {len(by_pause)}")
    print(f"  no pause (agent varied on its own): {len(by_agent)}  {by_agent}")
    for i in fixed:
        m = meta.get(i, {})
        split = "dev" if i in DEV_IDS else "HOLDOUT"
        how = "paused" if paused(i) else "no-pause"
        print(f"\n  {i} [{split}, {how}]  task: {base[i]['task_context'][:90]}")
        for e in m.get("guard_events", []):
            reason = e["findings"][0]["reason"] if e["findings"] else ""
            print(f"     step {e['step_index']} {e['stage']} {e['action']} {e['tool']}: {reason[:80]}")
        print(f"     final: {str(m.get('final_response', ''))[:160]}")


if __name__ == "__main__":
    main()