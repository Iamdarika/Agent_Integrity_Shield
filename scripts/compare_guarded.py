#!/usr/bin/env python3
"""Compare baseline vs guarded runs from run_guarded_toolemu.py (zero API calls).

Reports the two numbers that decide whether AIS works as a shield:
  * SAFETY : did the judged failure rate go down? (paired, per case)
  * UTILITY: how often did the guard pause a run that was fine without it?

  python scripts/compare_guarded.py                       # data/processed/guarded/
  python scripts/compare_guarded.py --dir data/processed/guarded/dryrun
  python scripts/compare_guarded.py --baseline data/processed/toolemu_executed_full.jsonl
  python scripts/compare_guarded.py --dir data/processed/guarded_asb --prefix asb
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(p: Path) -> dict[str, dict]:
    if not p.exists():
        return {}
    return {(r := json.loads(l))["trajectory_id"]: r for l in p.read_text(encoding="utf-8").splitlines() if l.strip()}


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact test on the discordant pairs (b = fail->safe, c = safe->fail)."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(ROOT / "data" / "processed" / "guarded"))
    ap.add_argument("--baseline", help="baseline trajectories (default: <dir>/toolemu_baseline.jsonl, "
                                       "else data/processed/toolemu_executed_full.jsonl)")
    ap.add_argument("--prefix", default="toolemu", help="file prefix: toolemu (default) or asb")
    ap.add_argument("--arm", default="guarded", help="arm to compare with baseline: guarded (default) or hybrid")
    a = ap.parse_args()
    d, px = Path(a.dir), a.prefix
    base_p = Path(a.baseline) if a.baseline else d / f"{px}_baseline.jsonl"
    if not base_p.exists() and px == "toolemu":
        base_p = ROOT / "data" / "processed" / "toolemu_executed_full.jsonl"
    arm = a.arm
    base, guard = load(base_p), load(d / f"{px}_{arm}.jsonl")
    gmeta = load(d / f"{px}_{arm}_meta.jsonl")
    ids = sorted(set(base) & set(guard))
    print(f"baseline: {base_p}  ({len(base)} runs)\n{arm:8}: {d / (px + '_' + arm + '.jsonl')}  ({len(guard)} runs)")
    print(f"paired cases: {len(ids)}")
    if not ids:
        print("Nothing to compare yet.")
        return
    paired_baseline = base_p.name == f"{px}_baseline.jsonl"
    if not paired_baseline:
        print("NOTE: baseline is from an earlier session, so differences include run-to-run noise. "
              "A '--mode both' run gives a fairer comparison.")

    fail = lambda r: bool(r["ground_truth_label"]["is_failure"])
    trans = Counter((fail(base[i]), fail(guard[i])) for i in ids)
    bf, gf = sum(fail(base[i]) for i in ids), sum(fail(guard[i]) for i in ids)
    fixed = [i for i in ids if fail(base[i]) and not fail(guard[i])]
    broke = [i for i in ids if not fail(base[i]) and fail(guard[i])]
    still = [i for i in ids if fail(base[i]) and fail(guard[i])]

    paused = lambda i: any(e["stage"] == "pre" for e in gmeta.get(i, {}).get("guard_events", []))
    safe_base = [i for i in ids if not fail(base[i])]
    over = [i for i in safe_base if paused(i)]

    n = len(ids)
    print("\n=== SAFETY (LLM judge, same prompt both arms) ===")
    print(f"  failure rate  baseline {bf}/{n} = {bf / n:.0%}   {arm} {gf}/{n} = {gf / n:.0%}")
    print(f"  fixed  (fail -> safe): {len(fixed)}  {fixed}")
    print(f"  broke  (safe -> fail): {len(broke)}  {broke}")
    print(f"  still failing        : {len(still)}  {still}")
    print(f"  exact McNemar p      : {mcnemar_exact(len(fixed), len(broke)):.3f}  (n small: treat as indicative)")

    print("\n=== UTILITY COST ===")
    print(f"  guard paused a baseline-safe run: {len(over)}/{len(safe_base)}"
          + (f" = {len(over) / len(safe_base):.0%}" if safe_base else "") + f"  {over}")
    fin = [i for i in ids if gmeta.get(i, {}).get("finished")]
    print(f"  {arm} runs where agent finished on its own: {len(fin)}/{n}")

    print("\n=== GUARD ACTIVITY ===")
    ev = Counter((e["stage"], e["action"]) for i in ids for e in gmeta.get(i, {}).get("guard_events", []))
    for (s, act), c in sorted(ev.items()):
        print(f"  {s:4} {act:8} {c}")
    cats = Counter(f["category"] for i in ids for e in gmeta.get(i, {}).get("guard_events", []) for f in e["findings"])
    print("  finding categories:", dict(cats))
    calls = sum(gmeta.get(i, {}).get("api_calls", 0) for i in ids)
    print(f"  API calls ({arm} arm): {calls}  (~{calls / n:.1f} per case)")

    by_dom = Counter()
    for i in ids:
        by_dom[(base[i]["domain"], "b")] += fail(base[i])
        by_dom[(base[i]["domain"], "g")] += fail(guard[i])
        by_dom[(base[i]["domain"], "n")] += 1
    print(f"\n=== PER DOMAIN (failures baseline -> {arm}) ===")
    for dom in sorted({k[0] for k in by_dom}):
        print(f"  {dom:24} {by_dom[(dom, 'b')]} -> {by_dom[(dom, 'g')]}  of {by_dom[(dom, 'n')]}")


if __name__ == "__main__":
    main()
