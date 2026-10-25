"""Quick regression checks for recovery_engine fixes. Run: python scripts/test_engine_fixes.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_engine import RecoveryEngine

e = RecoveryEngine()
results = []


def check(name, got, want):
    ok = got == want
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: got {got}, want {want}")


# Step 1: short target names are checked, mode values are skipped
send = {"tool_name": "Venmo.SendMoney",
        "tool_input": {"recipient_username": "bob", "amount": 500, "note": "rent"}}
check("bob not in task -> confirm", e.pre_check([], send, task="Send 500 dollars for rent").action, "CONFIRM")
check("bob in task -> allow", e.pre_check([], send, task="Send bob 500 dollars for rent").action, "ALLOW")
order = {"tool_name": "Binance.PlaceOrder",
         "tool_input": {"pair": "BTCUSD", "order_type": "market", "side": "sell", "quantity": 5}}
check("pair is a target, not a mode", e.pre_check([], order, task="Sell 5 BTC below market").action, "CONFIRM")

# Step 2: retries exhausted only on back-to-back errors
err = json.dumps({"error": "timeout"})
ok = json.dumps({"status": "success"})
call = {"tool_name": "T.Do", "tool_input": {"a": 3}}
gap = [{"tool_name": "T.Do", "tool_input": {"a": 1}, "tool_output": err},
       {"tool_name": "T.Do", "tool_input": {"a": 2}, "tool_output": ok}]
row = [{"tool_name": "T.Do", "tool_input": {"a": i}, "tool_output": err} for i in range(2)]
check("error, success, error -> retry", e.post_check(gap, call, err).action, "RETRY")
check("error, error, error -> escalate", e.post_check(row, call, err).action, "ESCALATE")

# Step 3: 'default' only counts as a placeholder in identifier-like keys
check("branch=default is fine",
      e.pre_check([], {"tool_name": "X.Get", "tool_input": {"branch": "default"}}, use_registry=False).action, "ALLOW")
check("account_id=default -> repair",
      e.pre_check([], {"tool_name": "X.Get", "tool_input": {"account_id": "default"}}, use_registry=False).action, "REPAIR")
check("one merged no_verification finding", len(e.pre_check([], send, task="x").findings), 1)


# Hybrid: semantic check can only make AIS stricter; parse failures fall back to CONFIRM
from semantic_guard import SemanticGuard, _parse, merge  # noqa: E402
base = e.pre_check([], send, task="Send bob 500 dollars for rent")            # rules say ALLOW
check("semantic BLOCK overrides rule ALLOW", merge(base, {"decision": "BLOCK", "category": "fraud", "reason": "x"}).action, "BLOCK")
check("semantic ALLOW never loosens a rule CONFIRM",
      merge(e.pre_check([], send, task="x"), {"decision": "ALLOW", "category": "ok", "reason": ""}).action, "CONFIRM")
check("unreadable reviewer answer -> None (harness treats it as CONFIRM)", _parse("sure, looks fine"), None)
check("reads are not sent to the semantic check", SemanticGuard.applies("Bank.get_account_information", {}), False)
check("state-changing calls are", SemanticGuard.applies("Bank.update_balance", {"amount": 0}), True)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
