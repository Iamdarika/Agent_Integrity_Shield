/* ShieldRun: plays one session (live or replay) on the deck.
   Every movement is driven by a real event from the server; the client only paces them. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pretty = (v) => { try { return typeof v === "string" ? JSON.stringify(JSON.parse(v), null, 2) : JSON.stringify(v, null, 2); } catch { return String(v); } };
  const VCLASS = { ALLOW: "go", OK: "go", REPAIR: "repair", CONFIRM: "hold", BLOCK: "stop", SKIP: "skip" };
  const VWORD = { ALLOW: "Allowed", REPAIR: "Repair", CONFIRM: "Hold", BLOCK: "Blocked", SKIP: "Skipped" };

  // ---------------------------------------------------------------- geometry
  const Y = 104;
  const N = {
    you: { x: 70, w: 104, label: "Your task", sub: "you" },
    agent: { x: 230, w: 118, label: "Agent", sub: "Pip" },
    lock: { x: 470, w: 230, label: "AIS interlock", sub: "", h: 96 },
    tool: { x: 712, w: 118, label: "Tool", sub: "Forge" },
    post: { x: 868, w: 122, label: "Post-check", sub: "Warden" },
    final: { x: 1022, w: 118, label: "Answer", sub: "Pip" },
    verdict: { x: 1146, w: 98, label: "Verdict", sub: "Arbiter" },
  };
  const H = 66;
  const L = (k) => N[k].x - N[k].w / 2, R = (k) => N[k].x + N[k].w / 2;
  const PATHS = {
    you_agent: `M${R("you")} ${Y} H${L("agent")}`,
    agent_lock: `M${R("agent")} ${Y} H${L("lock")}`,
    lock_tool: `M${R("lock")} ${Y} H${L("tool")}`,
    tool_post: `M${R("tool")} ${Y} H${L("post")}`,
    loop: `M${N.post.x} ${Y + H / 2} V${Y + 70} H${N.agent.x + 20} V${Y + H / 2}`,
    reject: `M${N.lock.x - 40} ${Y + 48} C${N.lock.x - 60} ${Y + 92}, ${N.agent.x + 60} ${Y + 92}, ${N.agent.x - 18} ${Y + H / 2}`,
    finish: `M${N.agent.x} ${Y - H / 2} V${Y - 76} H${N.final.x} V${Y - H / 2}`,
    final_verdict: `M${R("final")} ${Y} H${L("verdict")}`,
  };
  const LAMPS = [["rules", "Rules", -66], ["policy", "Policy", 0], ["semantic", "Semantic", 66]];

  function deckSVG() {
    let s = `<svg class="track-svg" viewBox="0 0 1210 214" role="img" aria-label="Path of the task through AIS">`;
    for (const [k, d] of Object.entries(PATHS)) s += `<path id="p-${k}" class="seg-path ${k === "loop" ? "loop-path" : ""}" d="${d}"/>`;
    s += `<text x="${(N.post.x + N.agent.x) / 2}" y="${Y + 88}" fill="#77818b" font-size="11.5" text-anchor="middle">next step</text>`;
    s += `<text x="${(N.final.x + N.agent.x) / 2}" y="${Y - 84}" fill="#77818b" font-size="11.5" text-anchor="middle">task finished</text>`;
    s += `<text x="${N.lock.x - 128}" y="${Y + 98}" fill="#77818b" font-size="11.5" text-anchor="middle">re-plan</text>`;
    for (const [k, n] of Object.entries(N)) {
      const h = n.h || H;
      s += `<g class="node" id="n-${k}"><rect class="node-box" x="${n.x - n.w / 2}" y="${Y - h / 2}" width="${n.w}" height="${h}" rx="12"/>`;
      if (k === "lock") {
        s += `<text x="${n.x}" y="${Y - 26}" text-anchor="middle">${n.label}</text>`;
        for (const [lk, ll, dx] of LAMPS) {
          s += `<circle class="sig off" id="lamp-${lk}" cx="${n.x + dx}" cy="${Y + 6}" r="13"/>`;
          s += `<text class="sub" x="${n.x + dx}" y="${Y + 36}" text-anchor="middle">${ll}</text>`;
        }
        s += `<circle class="sig off" id="lamp-gate" cx="${n.x + n.w / 2 - 14}" cy="${Y - 30}" r="7"/>`;
      } else {
        s += `<text x="${n.x}" y="${Y - 2}" text-anchor="middle">${n.label}</text><text class="sub" x="${n.x}" y="${Y + 17}" text-anchor="middle">${n.sub}</text>`;
      }
      s += `</g>`;
    }
    s += `<g id="token" opacity="0"><circle class="token" r="14"/><text class="token-label" id="token-n">1</text></g></svg>`;
    return s;
  }

  // ---------------------------------------------------------------- class
  class ShieldRun {
    constructor(root, opts = {}) {
      this.root = root;
      this.opts = Object.assign({ compact: false, plain: false, speed: 1, onEnd: null, onEvent: null, title: "" }, opts);
      this.queue = [];
      this.busy = false;
      this.lastSeq = -1;
      this.render();
    }

    render() {
      const c = this.opts.compact;
      this.root.innerHTML = `
        <div class="deck">
          <div class="deck-head"><span class="task" data-r="task">${esc(this.opts.title || "Pick a scenario or type a task, then press Run.")}</span><span data-r="status"></span></div>
          ${deckSVG()}
        </div>
        ${c ? `<div class="theatre compact-line"><div class="vn" style="margin:12px"><span class="nametag" data-r="name">AIS</span><div class="line" data-r="line">Ready.</div></div><div data-r="choices"></div><div data-r="impact"></div></div>` : `
        <div class="stage">
          <div class="theatre" data-r="theatre">
            <div class="scene">
              <div class="portrait" data-r="portrait">${Crew.portrait("agent", "idle")}</div>
              <div class="panel">
                <div class="node-title" data-r="ntitle"><b>Waiting</b><span>for a task</span></div>
                <div class="datacard" data-r="data"><span class="k">What happens here</span><p style="margin-top:6px">The task travels the track. Each part of AIS opens up here as the task reaches it, and shows what it actually decided and why.</p></div>
              </div>
            </div>
            <div class="vn" data-r="vn"><span class="nametag" data-r="name" style="--who:${Crew.C.agent.color}">Pip</span><div class="line" data-r="line">Give me a task!</div><span class="more" data-r="more"></span></div>
            <div data-r="choices"></div>
            <div data-r="impact"></div>
          </div>
          <aside class="log" aria-live="polite"><h3>Run log</h3><ol data-r="log"><li class="empty">Nothing yet.</li></ol></aside>
        </div>`}`;
      this.$ = (k) => this.root.querySelector(`[data-r="${k}"]`);
      this.svg = this.root.querySelector(".track-svg");
      this.token = this.svg.querySelector("#token");
      const vn = this.$("vn");
      if (vn) vn.addEventListener("click", () => { this.skipType = true; });
    }

    // ------------------------------------------------------------ session
    async start(payload) {
      this.stop();
      this.reset();
      this.payload = payload;
      const res = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "could not start");
      this.sid = j.id;
      this.es = new EventSource(`/api/sessions/${j.id}/events`);
      this.es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.seq <= this.lastSeq) return;
        this.lastSeq = ev.seq;
        this.queue.push(ev);
        this.pump();
        if (ev.type === "end") { this.es.close(); }
      };
      this.es.onerror = () => { if (this.ended) this.es.close(); };
      return j;
    }

    stop() {
      if (this.es) this.es.close();
      this.es = null;
      this.queue = [];
      this.cancelled = true;
    }

    reset() {
      this.cancelled = false;
      this.ended = false;
      this.lastSeq = -1;
      this.step = 0;
      this.at = "you";
      this.active = [];
      this.svg.querySelectorAll(".seg-path").forEach((p) => p.classList.remove("lit", "red", "amber"));
      this.svg.querySelectorAll(".sig").forEach((l) => (l.className.baseVal = "sig off"));
      this.svg.querySelectorAll(".node").forEach((n) => n.classList.remove("active"));
      this.token.setAttribute("opacity", "0");
      const log = this.$("log");
      if (log) log.innerHTML = "";
      this.$("choices").innerHTML = "";
      this.$("impact").innerHTML = "";
    }

    get spd() { return Math.max(0.25, this.opts.speed || 1); }
    ms(x) { return reduced() ? Math.min(x, 120) / this.spd : x / this.spd; }

    async pump() {
      if (this.busy) return;
      this.busy = true;
      while (this.queue.length && !this.cancelled) {
        const ev = this.queue.shift();
        try { await this.handle(ev); } catch (e) { console.error(e); }
        if (this.opts.onEvent) this.opts.onEvent(ev);
      }
      this.busy = false;
    }

    // ------------------------------------------------------------ deck helpers
    focus(node) {
      this.svg.querySelectorAll(".node").forEach((n) => n.classList.toggle("active", n.id === `n-${node}`));
    }
    pos(node) { return { x: N[node].x, y: Y }; }

    async travel(pathKey, toNode, cls = "lit", reverse = false) {
      const p = this.svg.querySelector(`#p-${pathKey}`);
      this.token.setAttribute("opacity", "1");
      this.svg.querySelector("#token-n").textContent = String(this.step + 1);
      const len = p.getTotalLength();
      const dur = this.ms(Math.min(1300, 320 + len * 1.3));
      const t0 = performance.now();
      p.classList.remove("lit", "red", "amber");
      p.classList.add(cls);
      await new Promise((resolve) => {
        const tick = (t) => {
          if (this.cancelled) return resolve();
          const k = Math.min(1, (t - t0) / dur);
          const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const pt = p.getPointAtLength((reverse ? 1 - e : e) * len);
          this.token.setAttribute("transform", `translate(${pt.x},${pt.y})`);
          if (k < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      });
      this.at = toNode;
      this.focus(toNode);
    }

    place(node) {
      const p = this.pos(node);
      this.token.setAttribute("transform", `translate(${p.x},${p.y})`);
      this.token.setAttribute("opacity", "1");
      this.at = node;
      this.focus(node);
    }

    lamp(id, verdict) {
      const l = this.svg.querySelector(`#lamp-${id}`);
      if (l) l.className.baseVal = "sig " + (verdict ? VCLASS[verdict] || "go" : "off");
    }

    // ------------------------------------------------------------ theatre helpers
    async say(who, mood, flavor, real, data, title) {
      const plain = this.opts.plain;
      const c = Crew.C[who] || Crew.C.agent;
      const name = this.$("name");
      if (name) { name.textContent = who === "ais" ? "AIS interlock" : c.name; name.style.setProperty("--who", c.color); }
      const portrait = this.$("portrait");
      if (portrait && Crew.C[who] && who !== "ais" && who !== "you") {
        const changed = portrait.dataset.who !== who;
        portrait.innerHTML = Crew.portrait(who, mood);
        portrait.dataset.who = who;
        portrait.classList.remove("enter", "shake");
        void portrait.offsetWidth;
        portrait.classList.add(mood === "alarmed" ? "shake" : changed ? "enter" : "x");
      }
      if (title && this.$("ntitle")) this.$("ntitle").innerHTML = `<b>${esc(title[0])}</b><span>${esc(title[1] || "")}</span>`;
      if (data !== undefined && this.$("data")) this.$("data").innerHTML = data;
      const line = this.$("line");
      if (!line) return;
      const lead = plain ? "" : flavor;
      const body = real ? String(real) : "";
      line.innerHTML = "";
      this.skipType = false;
      const leadSpan = document.createElement("span");
      const realSpan = document.createElement("span");
      realSpan.className = "real";
      line.append(leadSpan, lead && body ? " " : "", realSpan);
      const type = async (el, text) => {
        if (reduced() || this.spd >= 4) { el.textContent = text; return; }
        const step = Math.max(1, Math.round(text.length / 90));
        for (let i = 0; i < text.length; i += step) {
          if (this.skipType || this.cancelled) { el.textContent = text; return; }
          el.textContent = text.slice(0, i + step);
          await sleep(14 / this.spd);
        }
      };
      await type(leadSpan, plain && !body ? flavor : lead);
      await type(realSpan, body.length > 420 ? body.slice(0, 420) + "..." : body);
    }

    logItem(who, text, verdict, chipText) {
      const ol = this.$("log");
      const c = Crew.C[who] || Crew.C.agent;
      if (!ol) {
        return;
      }
      const li = document.createElement("li");
      li.className = "new";
      li.innerHTML = `<span class="who" style="--c:${c.color}"><i></i>${esc(who === "ais" ? "AIS interlock" : c.name)} <span class="muted small">step ${this.step + 1}</span>${verdict ? ` <span class="chip ${VCLASS[verdict] === "go" ? "go" : VCLASS[verdict] === "hold" || VCLASS[verdict] === "repair" ? "hold" : VCLASS[verdict] === "stop" ? "stop" : "idle"}">${esc(chipText || VWORD[verdict] || verdict)}</span>` : ""}</span><span class="what">${esc(text)}</span>`;
      ol.appendChild(li);
      ol.parentElement.scrollTop = ol.parentElement.scrollHeight;
    }

    impact(kind, word) {
      const box = this.$("impact");
      if (!box || reduced()) return;
      box.innerHTML = `<div class="impact ${kind}"><div class="flash"></div><div class="lines"></div><div class="stamp">${esc(word)}</div></div>`;
      setTimeout(() => { if (box.firstChild) box.innerHTML = ""; }, 1300 / Math.min(this.spd, 2));
    }

    status(t) { const s = this.$("status"); if (s) s.textContent = t; }

    // ------------------------------------------------------------ event handlers
    async handle(ev) {
      const Lf = Crew.lineFor(ev, this);
      const wait = (x) => sleep(this.ms(x));
      switch (ev.type) {
        case "start": {
          this.active = ev.active_layers || [];
          const t = this.$("task");
          if (t) t.textContent = ev.task;
          for (const [k] of LAMPS) this.lamp(k, null);
          this.status([ev.kind === "live" ? "Live agent" : "Replay", ev.kind === "live" ? "" : ev.benchmark, ev.shield ? "AIS on" : "AIS off"].filter(Boolean).join(" | "));
          this.place("you");
          await this.say("agent", "happy", Lf.flavor, ev.task, `<span class="k">Domain</span><p>${esc((ev.domain || "").replace("_", " "))}</p>${ev.toolkits ? `<span class="k">Tools given to the agent</span><p>${esc(ev.toolkits.join(", "))}</p>` : ""}<span class="k">Active checks</span><p>${ev.shield ? esc(this.active.join(", ") || "none") : "none: AIS is off on this track"}</p>${ev.note ? `<p class="small" style="color:#f0c96b;margin-top:6px">${esc(ev.note)}</p>` : ""}`, ["Your task", ev.kind === "live" ? "typed by you" : "recorded scenario"]);
          this.logItem("agent", "Task received: " + ev.task);
          await wait(700);
          break;
        }
        case "agent": {
          this.step = ev.step;
          if (this.at === "you") await this.travel("you_agent", "agent");
          else if (this.at === "post" || this.at === "tool") await this.travel("loop", "agent", "lit");
          else if (this.at === "lock") await this.travel("reject", "agent", "red");
          else this.place("agent");
          for (const [k] of LAMPS) this.lamp(k, this.active.includes(k) ? null : null);
          this.lamp("gate", null);
          await this.say("agent", "think", Lf.flavor, "", undefined, ["Agent", `planning step ${ev.step + 1}`]);
          await wait(250);
          break;
        }
        case "proposed": {
          const data = `<span class="k">Tool</span><pre>${esc(ev.tool)}</pre><span class="k">Arguments</span><pre>${esc(pretty(ev.args))}</pre>${ev.thought ? `<span class="k">Reasoning</span><p>${esc(ev.thought)}</p>` : ""}`;
          await this.say("agent", Lf.mood, Lf.flavor, ev.summary, data, ["Agent", ev.kind === "risky" ? "proposes an action that changes something" : "proposes a call"]);
          this.logItem("agent", ev.summary);
          this.lastProposed = ev;
          await wait(500);
          if (!ev.unshielded && this.payload && this.payload.shield !== false) await this.travel("agent_lock", "lock");
          break;
        }
        case "check": {
          this.lamp(ev.layer, ev.verdict);
          if (!Lf) break;
          const data = `<span class="k">${esc(Crew.C[Lf.who].role)} verdict</span><p><span class="chip ${VCLASS[ev.verdict] === "go" ? "go" : VCLASS[ev.verdict] === "stop" ? "stop" : VCLASS[ev.verdict] === "skip" ? "idle" : "hold"}">${VWORD[ev.verdict] || ev.verdict}</span></p>${(ev.reasons || []).length ? `<span class="k">Reasons</span><ul>${ev.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}`;
          await this.say(Lf.who, Lf.mood, Lf.flavor, Lf.real, data, [Crew.C[Lf.who].role, "inside the interlock"]);
          this.logItem(Lf.who, (ev.reasons || [])[0] || VWORD[ev.verdict] || ev.verdict, ev.verdict);
          if (ORD(ev.verdict) > 0) this.stopper = Lf.who;
          await wait(ev.verdict === "ALLOW" || ev.verdict === "SKIP" ? 450 : 900);
          break;
        }
        case "gate": {
          this.lamp("gate", ev.action);
          if (ev.action === "CONFIRM") this.impact("amber", "HOLD");
          if (ev.action === "BLOCK") this.impact("red", "BLOCKED");
          if (ev.action === "REPAIR") this.impact("amber", "REPAIR");
          if (ev.action !== "ALLOW") this.logItem("ais", (ev.reasons || []).join("; ") || ev.action, ev.action);
          await wait(ev.action === "ALLOW" ? 250 : 1100);
          if (ev.action === "ALLOW") await this.travel("lock_tool", "tool");
          break;
        }
        case "hold": {
          await this.say(this.stopper || "rules", "stern", "The interlock is holding. This one is your call.", ev.summary, undefined, ["Waiting for you", "the agent is paused"]);
          await this.decide(ev);
          break;
        }
        case "human": {
          await this.say("agent", Lf.mood, Lf.flavor, ev.reason || "");
          this.logItem("you", ev.decision === "approve" ? (ev.reason ? `You approved (${ev.reason}).` : "You approved the action.") : "You denied the action. The agent must re-plan.", ev.decision === "approve" ? "ALLOW" : "BLOCK", ev.decision === "approve" ? "Approved" : "Denied");
          if (ev.decision === "approve") await this.travel("lock_tool", "tool");
          break;
        }
        case "branch": {
          this.svg.querySelectorAll("#lamp-rules,#lamp-policy,#lamp-semantic,#lamp-gate").forEach((l) => (l.className.baseVal = "sig off"));
          await this.say("agent", "happy", Lf.flavor, ev.note);
          this.logItem("agent", ev.note);
          await wait(600);
          break;
        }
        case "tool": {
          if (ev.executed) {
            if (this.at !== "tool") {
              if (this.at === "agent") await this.travel("agent_lock", "lock", "lit");   // no interlock active: passes straight through
              if (this.at === "lock") await this.travel("lock_tool", "tool");
            }
            const data = `<span class="k">Output</span><pre>${esc(pretty(ev.output)).slice(0, 1800)}</pre>`;
            await this.say("tool", Lf.mood, Lf.flavor, "", data, ["Tool sandbox", ev.unshielded ? "executed without any check" : "executed"]);
            this.logItem("tool", "Executed: " + String(ev.output).replace(/\s+/g, " ").slice(0, 140));
            await wait(650);
            await this.travel("tool_post", "post");
          } else {
            await this.say("tool", "idle", Lf.flavor, "", `<span class="k">Result</span><p>${esc(ev.output.startsWith("{") ? "Not executed. The agent receives the reasons and has to re-plan." : ev.output)}</p>`, ["Tool sandbox", "nothing ran"]);
            this.logItem("tool", "Not executed");
            await wait(500);
          }
          break;
        }
        case "post": {
          if (this.at !== "post" && this.at === "tool") await this.travel("tool_post", "post");
          await this.say("rules", "alarmed", Lf.flavor, Lf.real, `<span class="k">Post-check</span><p><span class="chip hold">${esc(ev.action)}</span></p><ul>${(ev.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`, ["Post-check", "after the tool ran"]);
          this.logItem("rules", (ev.reasons || [])[0] || ev.action, "CONFIRM");
          await wait(700);
          break;
        }
        case "final": {
          if (this.at !== "agent") {
            if (this.at === "post" || this.at === "tool") await this.travel("loop", "agent");
            else if (this.at === "lock") await this.travel("reject", "agent", "red");
          }
          await this.travel("finish", "final");
          await this.say("agent", Lf.mood, Lf.flavor, ev.text, `<span class="k">Final answer to the user</span><p>${esc(ev.text)}</p>`, ["Answer", ev.finished === false ? "ran out of steps" : "task finished"]);
          this.logItem("agent", ev.text);
          await wait(600);
          break;
        }
        case "verdict": {
          await this.travel("final_verdict", "verdict", ev.fail ? "red" : "lit");
          this.impact(ev.fail ? "red" : "green", ev.fail ? "UNSAFE" : "SAFE");
          await this.say("judge", Lf.mood, Lf.flavor, Lf.real, `<span class="k">Safety judge (LLM)</span><p><span class="chip ${ev.fail ? "stop" : "go"}">${ev.fail ? "Failure" : "Safe"}</span> ${ev.category ? esc(ev.category.replace("_", " ")) : ""}</p><p class="small" style="margin-top:6px;color:#77818b">${ev.arm === "baseline" ? "Recorded run without AIS." : ev.arm === "live" ? "Judged just now." : "Recorded run with AIS."}</p>`, ["Verdict", "independent LLM judge"]);
          this.logItem("judge", ev.note || "", ev.fail ? "BLOCK" : "ALLOW", ev.fail ? "Unsafe" : "Safe");
          break;
        }
        case "error": {
          await this.say("tool", "alarmed", "Something broke.", ev.text);
          this.logItem("tool", ev.text, "BLOCK");
          break;
        }
        case "end": {
          this.ended = true;
          this.status("Finished");
          if (this.opts.onEnd) this.opts.onEnd(ev);
          break;
        }
      }
    }

    // ------------------------------------------------------------ the decision
    decide(ev) {
      return new Promise((resolve) => {
        const box = this.$("choices");
        const th = this.root.querySelector(".theatre");
        if (th && !this.opts.compact) th.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
        const typed = ev.require_typed;
        const reasons = (ev.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
        box.innerHTML = `<div class="choices"><div class="choice-box" role="dialog" aria-modal="true" aria-labelledby="cq">
          <h3 id="cq">The agent wants to:</h3>
          <div class="what">${esc(ev.summary)}</div>
          ${reasons ? `<ul>${reasons}</ul>` : ""}
          ${typed ? `<label class="typed">Large payment. Type <b style="color:#fff">${esc(typed)}</b> to approve<input data-k="typed" autocomplete="off"></label>` : ""}
          <div class="edit-area" data-k="editarea"><span class="small" style="color:#77818b">Edit the arguments, then approve the edited call:</span><textarea data-k="args">${esc(JSON.stringify(ev.args || {}, null, 2))}</textarea></div>
          <div class="opts">
            <button class="opt approve" data-k="approve"><span class="key">A</span> Approve${ev.replay ? " (shows what happened without AIS)" : ""}</button>
            <button class="opt deny" data-k="deny"><span class="key">D</span> Deny. The agent must re-plan</button>
            ${ev.replay ? "" : `<button class="opt edit" data-k="edit"><span class="key">E</span> Edit, then approve</button>`}
          </div>
          ${ev.replay ? `<p class="note">This is a recorded run. Denying follows what the agent really did with AIS; approving switches to the recording without AIS.</p>` : ""}
        </div></div>`;
        const q = (k) => box.querySelector(`[data-k="${k}"]`);
        const approveBtn = q("approve");
        if (typed) {
          approveBtn.disabled = true;
          q("typed").addEventListener("input", (e) => {
            const want = typed.replace(/[$,\s]/g, ""), got = e.target.value.replace(/[$,\s]/g, "");
            approveBtn.disabled = got !== want;
          });
        }
        const send = async (decision, extra = {}) => {
          document.removeEventListener("keydown", onKey);
          box.innerHTML = "";
          if (this.opts.onDecision) this.opts.onDecision(decision);
          await fetch(`/api/sessions/${this.sid}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...extra }) });
          resolve();
        };
        let editing = false;
        approveBtn.onclick = () => {
          if (editing) {
            try { send("approve", { args: JSON.parse(q("args").value), reason: "approved with edits" }); }
            catch { q("args").style.borderColor = "#d23f3a"; }
          } else send("approve");
        };
        q("deny").onclick = () => send("deny", { reason: "denied by the reviewer" });
        if (q("edit")) q("edit").onclick = () => { editing = true; q("editarea").classList.add("on"); approveBtn.lastChild.textContent = " Approve the edited call"; q("args").focus(); };
        const onKey = (e) => {
          if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
          if (e.key === "a" || e.key === "A") { if (!approveBtn.disabled) approveBtn.click(); }
          else if (e.key === "d" || e.key === "D") q("deny").click();
          else if ((e.key === "e" || e.key === "E") && q("edit")) q("edit").click();
        };
        document.addEventListener("keydown", onKey);
        setTimeout(() => (q("typed") || approveBtn).focus(), 50);
      });
    }
  }

  function ORD(v) { return { ALLOW: 0, SKIP: 0, REPAIR: 1, CONFIRM: 2, BLOCK: 3 }[v] || 0; }

  window.ShieldRun = ShieldRun;
  window.AIS_esc = esc;
})();
