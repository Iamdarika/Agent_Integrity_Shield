/* The AIS crew: original characters drawn in SVG. Each one is a part of the pipeline and
   speaks the REAL output of that part; the character only adds voice around it.

   Pip      the agent         eager, a bit reckless          --c-agent
   Warden   rule engine       stern inspector                --c-rules
   Ledger   policy layer      precise clerk with glasses     --c-policy
   Sage     semantic check    calm reader of intent          --c-semantic
   Forge    tool / sandbox    the machine that executes      --c-tool
   Arbiter  safety judge      final verdict                  --c-judge
*/
(function () {
  const C = {
    agent: { name: "Pip", role: "The agent", color: "#5aa9e6", hair: "#16263f", skin: "#ffd9c2", cloth: "#2f7fc1" },
    rules: { name: "Warden", role: "Rule engine", color: "#a58cf5", hair: "#241a42", skin: "#f3c9ad", cloth: "#5f47c4" },
    policy: { name: "Ledger", role: "Policy layer", color: "#3ccf9e", hair: "#3b2a22", skin: "#ffe0cc", cloth: "#1b8f72" },
    semantic: { name: "Sage", role: "Semantic check", color: "#ec6fa5", hair: "#f0a3c6", skin: "#ffe6d8", cloth: "#b8437a" },
    tool: { name: "Forge", role: "Tool sandbox", color: "#e0975a", hair: "#7a4a24", skin: "#d9e3ea", cloth: "#a8683a" },
    judge: { name: "Arbiter", role: "Safety judge", color: "#d9b44a", hair: "#3a3328", skin: "#f1cdb0", cloth: "#b08a24" },
    you: { name: "You", role: "Human in the loop", color: "#d3dae2" },
    ais: { name: "AIS", role: "Interlock", color: "#11b7d4" },
  };

  function eyes(mood, x1, x2, y, col) {
    const iris = col || "#1b2735";
    if (mood === "happy") {
      return `<path d="M${x1 - 13} ${y + 3} q13 -15 26 0" stroke="#1b2735" stroke-width="4" fill="none" stroke-linecap="round"/>
              <path d="M${x2 - 13} ${y + 3} q13 -15 26 0" stroke="#1b2735" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    }
    if (mood === "calm") {
      return `<path d="M${x1 - 12} ${y} q12 9 24 0" stroke="#1b2735" stroke-width="3.5" fill="none" stroke-linecap="round"/>
              <path d="M${x2 - 12} ${y} q12 9 24 0" stroke="#1b2735" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    }
    const big = mood === "alarmed";
    const ry = big ? 17 : 15, rx = big ? 13 : 11.5;
    const pupil = big ? 4.5 : 7.5;
    const look = mood === "think" ? -5 : 0;
    const one = (x) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#fff"/>
      <ellipse cx="${x}" cy="${y + 2 + look}" rx="${pupil + 2}" ry="${pupil + 4}" fill="${iris}"/>
      <ellipse cx="${x}" cy="${y + 3 + look}" rx="${pupil - 2}" ry="${pupil}" fill="#0b1118"/>
      <circle cx="${x - 4}" cy="${y - 5 + look}" r="3.6" fill="#fff"/><circle cx="${x + 4}" cy="${y + 6 + look}" r="1.6" fill="#fff"/>`;
    return one(x1) + one(x2);
  }

  function brows(mood, x1, x2, y, col) {
    const c = col || "#1b2735";
    if (mood === "stern") return `<path d="M${x1 - 14} ${y - 4} L${x1 + 12} ${y + 4}" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M${x2 + 14} ${y - 4} L${x2 - 12} ${y + 4}" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>`;
    if (mood === "alarmed") return `<path d="M${x1 - 12} ${y - 2} q12 -10 24 -2" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M${x2 - 12} ${y - 4} q12 -8 24 2" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    return `<path d="M${x1 - 12} ${y} q12 -6 24 0" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".85"/>
      <path d="M${x2 - 12} ${y} q12 -6 24 0" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".85"/>`;
  }

  function mouth(mood, x, y) {
    switch (mood) {
      case "happy": return `<path d="M${x - 13} ${y - 2} q13 16 26 0 z" fill="#7a2b2b"/><path d="M${x - 8} ${y + 4} q8 5 16 0" fill="#e57a7a"/>`;
      case "alarmed": return `<ellipse cx="${x}" cy="${y + 3}" rx="7" ry="9" fill="#5a1f1f"/>`;
      case "stern": return `<path d="M${x - 11} ${y + 2} h22" stroke="#5a2a2a" stroke-width="4" stroke-linecap="round"/>`;
      case "think": return `<path d="M${x - 8} ${y + 3} q6 -4 14 1" stroke="#5a2a2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
      case "calm": return `<path d="M${x - 9} ${y} q9 7 18 0" stroke="#7a3b3b" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
      default: return `<path d="M${x - 9} ${y} q9 8 18 0" stroke="#5a2a2a" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    }
  }

  function blush(x1, x2, y) {
    return `<ellipse cx="${x1 - 6}" cy="${y}" rx="11" ry="6" fill="#ff8f9a" opacity=".35"/><ellipse cx="${x2 + 6}" cy="${y}" rx="11" ry="6" fill="#ff8f9a" opacity=".35"/>`;
  }

  function sweat(mood) {
    return mood === "alarmed" ? `<path d="M162 70 q8 14 0 20 q-8 -6 0 -20z" fill="#9fd4ff" stroke="#5aa6e0" stroke-width="1.5"/>` : "";
  }

  function body(cloth, extra = "") {
    return `<path d="M30 250 C34 196 62 178 105 178 C148 178 176 196 180 250 Z" fill="${cloth}"/>
      <path d="M88 178 L105 206 L122 178 Z" fill="#fff" opacity=".9"/>${extra}
      <rect x="93" y="160" width="24" height="26" rx="8" fill="var(--skin)"/>`;
  }

  const DRAW = {
    agent(m) {
      const c = C.agent;
      return `<g style="--skin:${c.skin}">${body(c.cloth, `<circle cx="132" cy="214" r="7" fill="#ffd34d"/><path d="M128 214 l3 3 l6 -7" stroke="#1d2b4a" stroke-width="2" fill="none"/>`)}
        <ellipse cx="105" cy="104" rx="64" ry="66" fill="${c.skin}"/>
        <path d="M40 104 C30 40 90 18 120 30 C150 26 182 56 170 104 C160 82 150 70 138 66 C128 84 100 72 92 60 C84 76 62 82 40 104Z" fill="${c.hair}"/>
        <path d="M120 30 L132 6 L134 34 Z M92 34 L82 10 L104 30Z" fill="${c.hair}"/>
        <path d="M44 98 Q105 58 166 98" stroke="#11b7d4" stroke-width="7" fill="none" stroke-linecap="round"/>
        <rect x="34" y="96" width="12" height="26" rx="6" fill="#11b7d4"/><path d="M40 122 q2 18 22 22" stroke="#11b7d4" stroke-width="3" fill="none"/><circle cx="64" cy="144" r="4.5" fill="#63ddf2"/>
        ${brows(m, 82, 128, 92, c.hair)}${eyes(m, 82, 128, 112, "#1f5e94")}${blush(82, 128, 132)}${mouth(m, 105, 142)}${sweat(m)}</g>`;
    },
    rules(m) {
      const c = C.rules;
      return `<g style="--skin:${c.skin}">${body(c.cloth, `<path d="M58 200 h30 M58 210 h22" stroke="#d9cffb" stroke-width="4"/><rect x="124" y="198" width="22" height="16" rx="3" fill="#ffd34d"/>`)}
        <ellipse cx="105" cy="108" rx="60" ry="62" fill="${c.skin}"/>
        <path d="M46 104 C44 70 70 58 105 58 C140 58 166 70 164 104 C150 90 130 86 105 88 C80 86 60 90 46 104Z" fill="${c.hair}"/>
        <path d="M34 66 C40 34 170 34 176 66 C150 74 60 74 34 66Z" fill="#3b2a77"/><rect x="40" y="62" width="130" height="14" rx="7" fill="#22184d"/>
        <path d="M98 40 l7 -9 l7 9 l-7 9z" fill="#11b7d4" stroke="#e8fbff" stroke-width="1.2"/>
        ${brows(m === "idle" ? "stern" : m, 82, 128, 98, c.hair)}${eyes(m, 82, 128, 116, "#4b2fa8")}${mouth(m === "idle" ? "stern" : m, 105, 146)}${sweat(m)}</g>`;
    },
    policy(m) {
      const c = C.policy;
      return `<g style="--skin:${c.skin}">${body(c.cloth, `<rect x="120" y="196" width="34" height="42" rx="3" fill="#f4efe1" transform="rotate(-8 137 217)"/><path d="M126 208 h20 M126 216 h20 M126 224 h14" stroke="#16907f" stroke-width="2.5" transform="rotate(-8 137 217)"/>`)}
        <ellipse cx="105" cy="108" rx="60" ry="63" fill="${c.skin}"/>
        <path d="M42 120 C30 50 80 32 108 34 C150 34 182 60 168 124 C164 100 150 80 128 74 C110 90 72 90 60 80 C52 92 46 104 42 120Z" fill="${c.hair}"/>
        <path d="M42 120 C40 150 48 166 58 172 L60 112Z M168 124 C170 150 162 166 152 172 L150 112Z" fill="${c.hair}"/>
        ${brows(m, 82, 128, 94, c.hair)}${eyes(m, 82, 128, 114, "#0f6e62")}
        <circle cx="82" cy="114" r="20" fill="none" stroke="#24313b" stroke-width="4"/><circle cx="128" cy="114" r="20" fill="none" stroke="#24313b" stroke-width="4"/><path d="M102 112 h6" stroke="#24313b" stroke-width="4"/>
        ${blush(82, 128, 138)}${mouth(m, 105, 146)}${sweat(m)}</g>`;
    },
    semantic(m) {
      const c = C.semantic;
      const mm = m === "idle" ? "calm" : m;
      return `<g style="--skin:${c.skin}">
        <path d="M34 250 C20 160 30 90 60 70 L150 70 C180 90 190 160 176 250Z" fill="${c.hair}"/>
        ${body(c.cloth, `<path d="M70 196 q35 22 70 0" stroke="#ffd1e6" stroke-width="3" fill="none"/>`)}
        <ellipse cx="105" cy="106" rx="58" ry="62" fill="${c.skin}"/>
        <path d="M44 112 C34 44 80 28 106 30 C142 28 180 50 168 112 C158 80 140 64 118 60 C112 76 84 82 62 74 C54 86 48 98 44 112Z" fill="${c.hair}"/>
        <path d="M100 66 l5 -9 l5 9 l-5 7z" fill="#11b7d4" stroke="#e8fbff" stroke-width="1.5"/>
        ${brows(mm === "calm" ? "idle" : mm, 82, 128, 94, "#c06f97")}${eyes(mm, 82, 128, 114, "#a8336e")}${blush(82, 128, 134)}${mouth(mm, 105, 144)}${sweat(m)}</g>`;
    },
    tool(m) {
      const c = C.tool;
      const scr = m === "alarmed" ? "#ff6b6f" : m === "happy" ? "#6be0b0" : "#11b7d4";
      const face = m === "happy" ? `<path d="M76 108 q8 -10 16 0 M118 108 q8 -10 16 0" stroke="${scr}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M90 130 q15 12 30 0" stroke="${scr}" stroke-width="5" fill="none" stroke-linecap="round"/>`
        : m === "alarmed" ? `<path d="M74 100 l18 14 M92 100 l-18 14 M118 100 l18 14 M136 100 l-18 14" stroke="${scr}" stroke-width="5" stroke-linecap="round"/><rect x="92" y="126" width="26" height="8" rx="4" fill="${scr}"/>`
        : `<rect x="76" y="100" width="16" height="16" rx="4" fill="${scr}"/><rect x="118" y="100" width="16" height="16" rx="4" fill="${scr}"/><rect x="88" y="128" width="34" height="6" rx="3" fill="${scr}"/>`;
      return `<g>${body(c.cloth, `<circle cx="80" cy="214" r="8" fill="#6c4422"/><circle cx="130" cy="214" r="8" fill="#6c4422"/>`).replace("var(--skin)", "#9aa9b5")}
        <path d="M105 46 v-20" stroke="#9aa9b5" stroke-width="5"/><circle cx="105" cy="22" r="8" fill="${scr}"/>
        <rect x="42" y="46" width="126" height="122" rx="30" fill="#aebbc6"/><rect x="54" y="62" width="102" height="88" rx="18" fill="#071014"/><rect x="54" y="62" width="102" height="88" rx="18" fill="none" stroke="${scr}" stroke-opacity=".35" stroke-width="2"/>
        <rect x="30" y="92" width="14" height="34" rx="6" fill="#9aa9b5"/><rect x="166" y="92" width="14" height="34" rx="6" fill="#9aa9b5"/>
        ${face}</g>`;
    },
    judge(m) {
      const c = C.judge;
      return `<g style="--skin:${c.skin}">${body("#2b2a30", `<path d="M88 178 L105 230 L122 178" fill="#fff"/><path d="M98 190 l7 -6 l7 6 l-7 30z" fill="${c.cloth}"/>`)}
        <ellipse cx="105" cy="106" rx="58" ry="62" fill="${c.skin}"/>
        <path d="M46 100 C40 46 92 30 120 38 C160 46 172 76 164 100 C150 76 128 60 98 62 C78 64 58 76 46 100Z" fill="${c.hair}"/>
        <path d="M60 64 C80 40 140 36 160 66" stroke="#d9c8a0" stroke-width="5" fill="none" opacity=".6"/>
        ${brows(m === "idle" ? "stern" : m, 82, 128, 94, c.hair)}${eyes(m, 82, 128, 114, "#7a5d10")}
        <circle cx="128" cy="114" r="19" fill="none" stroke="${c.color}" stroke-width="4"/><path d="M146 120 q10 20 2 40" stroke="${c.color}" stroke-width="2" fill="none"/>
        ${mouth(m === "idle" ? "calm" : m, 105, 146)}${sweat(m)}</g>`;
    },
  };

  function portrait(who, mood = "idle") {
    const fn = DRAW[who];
    if (!fn) return "";
    return `<svg viewBox="0 0 210 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${C[who].name}, ${C[who].role}">${fn(mood)}</svg>`;
  }

  function badge(who, mood = "idle") {
    return `<svg viewBox="20 10 170 170" class="face" aria-hidden="true">${DRAW[who] ? DRAW[who](mood) : ""}</svg>`;
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* Lines. `real` is the engine's own text, shown verbatim and emphasised.
     In plain mode only `plain` (neutral narration) + `real` are shown. */
  function lineFor(ev, ctx) {
    const s = ev.summary || "";
    const r = (ev.reasons || []).filter(Boolean);
    const first = r[0] || "";
    switch (ev.type) {
      case "start":
        return { who: "agent", mood: "happy", flavor: pick(["New task! Let's go.", "On it. Reading the request now.", "Alright, a fresh job."]), plain: "Task received.", real: ev.task };
      case "agent":
        return { who: "agent", mood: "think", flavor: pick(["Hmm, what's the next move...", "Let me think about this step.", "Planning..."]), plain: `Agent is planning step ${ev.step + 1}.`, real: "" };
      case "proposed":
        if (ev.unshielded) return { who: "agent", mood: "happy", flavor: "No interlock on this track. Going straight ahead:", plain: "Without AIS, the agent proposes:", real: s };
        return { who: "agent", mood: ev.kind === "risky" ? "happy" : "idle", flavor: ev.kind === "risky" ? pick(["Got it! I'll do this now:", "Easy. Executing:", "Here's my move:"]) : pick(["Let me look something up first:", "Quick check:", "Gathering info:"]), plain: "The agent proposes:", real: s };
      case "check": {
        const L = ev.layer, v = ev.verdict;
        if (L === "rules") {
          if (v === "ALLOW") return { who: "rules", mood: "idle", flavor: pick(["Papers in order. Cleared.", "Nothing wrong here. Proceed."]), plain: "Rules: allowed.", real: "" };
          if (v === "REPAIR") return { who: "rules", mood: "stern", flavor: "That call is malformed.", plain: "Rules: repair needed.", real: first };
          if (v === "BLOCK") return { who: "rules", mood: "alarmed", flavor: "Not on my watch.", plain: "Rules: blocked.", real: first };
          return { who: "rules", mood: "stern", flavor: pick(["Hold it right there.", "Stop. Something's off."]), plain: "Rules: confirmation required.", real: first };
        }
        if (L === "policy") {
          if (v === "ALLOW") return { who: "policy", mood: "idle", flavor: "No regulation applies to this one.", plain: "Policy: no rule applies.", real: "" };
          if (v === "BLOCK") return { who: "policy", mood: "alarmed", flavor: "Regulation forbids this outright.", plain: "Policy: blocked.", real: first };
          return { who: "policy", mood: "stern", flavor: "Regulation says we ask first.", plain: "Policy: confirmation required.", real: first };
        }
        if (L === "semantic") {
          if (v === "SKIP") return { who: "semantic", mood: "calm", flavor: "Just a lookup. Nothing for me to judge.", plain: "Semantic check: skipped (read-only).", real: "" };
          if (v === "ALLOW") return { who: "semantic", mood: "calm", flavor: "The intent is sound.", plain: "Semantic check: allowed.", real: first };
          if (v === "BLOCK") return { who: "semantic", mood: "alarmed", flavor: "This must not happen, whoever asked for it.", plain: "Semantic check: blocked.", real: first };
          return { who: "semantic", mood: "think", flavor: "Something here is unclear.", plain: "Semantic check: confirmation required.", real: first };
        }
        return null;
      }
      case "gate":
        return null;
      case "hold":
        return { who: "ais", mood: "idle", flavor: "The interlock is holding. Your call.", plain: "AIS paused the agent. Your decision is needed.", real: s };
      case "human":
        return ev.decision === "approve"
          ? { who: "agent", mood: "happy", flavor: "Approved! Carrying on.", plain: "You approved the action.", real: "" }
          : { who: "agent", mood: "alarmed", flavor: "Understood, I won't do that. Re-planning.", plain: "You denied the action.", real: "" };
      case "tool":
        if (!ev.executed) return { who: "tool", mood: "idle", flavor: "Nothing ran. The call never reached me.", plain: "Not executed.", real: "" };
        return { who: "tool", mood: ev.unshielded ? "alarmed" : "happy", flavor: ev.unshielded ? "Executed. No one checked it." : pick(["Executed. Here's what came back.", "Done. Output below."]), plain: "Tool executed.", real: "" };
      case "post":
        return { who: "rules", mood: "alarmed", flavor: ev.action === "RETRY" ? "The tool reported an error. Fix it and retry." : "Wait. This outcome can't be trusted.", plain: `Post-check: ${ev.action}.`, real: first };
      case "branch":
        return { who: "agent", mood: "happy", flavor: "Switching to the track without AIS...", plain: "Showing the run without AIS.", real: ev.note };
      case "final":
        return { who: "agent", mood: ev.finished === false ? "alarmed" : "idle", flavor: "Here's my answer:", plain: "Final answer:", real: ev.text };
      case "verdict":
        return ev.fail
          ? { who: "judge", mood: "stern", flavor: "Verdict: unsafe.", plain: "Judge: failure.", real: ev.note || "" }
          : { who: "judge", mood: "happy", flavor: "Verdict: a clean run.", plain: "Judge: safe.", real: ev.note || "" };
      case "error":
        return { who: "tool", mood: "alarmed", flavor: "Something broke.", plain: "Error:", real: ev.text };
      default:
        return null;
    }
  }

  window.Crew = { C, portrait, badge, lineFor };
})();
