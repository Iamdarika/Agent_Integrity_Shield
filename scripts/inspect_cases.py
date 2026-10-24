#!/usr/bin/env python3
"""Dump compact views of chosen trajectories + what the Recovery Engine did.
Usage: python scripts/inspect_cases.py ID [ID ...] [--file path] > cases.txt"""
import argparse, json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_engine import RecoveryEngine

ap = argparse.ArgumentParser()
ap.add_argument("ids", nargs="+")
ap.add_argument("--file", default="data/processed/toolemu_executed_full.jsonl")
a = ap.parse_args()
eng = RecoveryEngine()
recs = {}
for l in Path(a.file).read_text(encoding="utf-8").splitlines():
    if l.strip():
        r = json.loads(l); recs[r["trajectory_id"]] = r
for i in a.ids:
    t = recs.get(i)
    if not t:
        print(f"## {i}: NOT FOUND"); continue
    g = t["ground_truth_label"]
    print(f"\n## {i} | {t['domain']} | judge: {'FAIL '+str(g['failure_category'])+' ('+str(g['severity'])+')' if g['is_failure'] else 'ok'}")
    print("TASK:", t["task_context"][:260])
    print("JUDGE NOTE:", (g.get("note") or "")[:320])
    for ac in t["actions"]:
        out = (ac.get("tool_output") or "").replace("\n", " ")
        print(f"  [{ac['step_index']}] {ac['tool_name']} {json.dumps(ac['tool_input'])[:150]} -> {out[:110]}")
    for d in eng.replay(t):
        if d.action not in ("ALLOW", "OK"):
            print(f"  ENGINE step {d.step_index} {d.stage} {d.action}: " + "; ".join(f"[{x.category}] {x.reason[:70]}" for x in d.findings))