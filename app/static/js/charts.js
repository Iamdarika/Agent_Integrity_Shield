/* Charts: horizontal paired bars, "without AIS" vs "with AIS". Failure rates share one axis (0-100%).
   Marks <= 22px, 4px rounded data end, square at the baseline, 2px gap between paired bars,
   direct value labels at the tips, legend above, hover tooltip, and a table view below. */
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function barPath(x0, y, w, h, r) {
    if (w <= 0) return "";
    r = Math.min(r, w, h / 2);
    return `M${x0} ${y} H${x0 + w - r} Q${x0 + w} ${y} ${x0 + w} ${y + r} V${y + h - r} Q${x0 + w} ${y + h} ${x0 + w - r} ${y + h} H${x0} Z`;
  }

  /* rows: [{label, sub, n, without, with, withLabel}] counts of failures out of n */
  function paired(el, rows, opts = {}) {
    const W = opts.W || 760, labelW = opts.labelW || 210, right = opts.right || 120, bh = 20, gap = 2, groupGap = 22;
    const plotW = W - labelW - right;
    const H = 28 + rows.length * (bh * 2 + gap + groupGap);
    const x = (v) => labelW + v * plotW;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "Failure rate without and with AIS")}">`;
    for (const t of [0, .25, .5, .75, 1]) {
      s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="18" y2="${H - 6}"/><text x="${x(t)}" y="12" text-anchor="middle" class="small">${Math.round(t * 100)}%</text>`;
    }
    let y = 28;
    rows.forEach((r, i) => {
      const a = r.n ? r.without / r.n : 0, b = r.n ? r.with / r.n : 0;
      s += `<text class="lbl-strong" x="${labelW - 14}" y="${y + bh - 2}" text-anchor="end">${esc(r.label)}</text>`;
      if (r.sub) s += `<text x="${labelW - 14}" y="${y + bh * 2 + 2}" text-anchor="end" style="fill:var(--muted);font-size:12px">${esc(r.sub)}</text>`;
      s += `<path d="${barPath(x(0), y, Math.max(2, a * plotW), bh, 4)}" fill="var(--without)"/>`;
      s += `<text x="${x(a) + 8}" y="${y + bh - 5}">${r.without}/${r.n} (${Math.round(a * 100)}%)</text>`;
      s += `<rect class="hit" x="${labelW}" y="${y}" width="${plotW + right}" height="${bh}" data-tip="${esc(`${r.label}, without AIS: ${r.without} of ${r.n} runs failed (${Math.round(a * 100)}%)`)}"/>`;
      const y2 = y + bh + gap;
      s += `<path d="${barPath(x(0), y2, Math.max(2, b * plotW), bh, 4)}" fill="var(--with)"/>`;
      s += `<text x="${x(b) + 8}" y="${y2 + bh - 5}">${r.with}/${r.n} (${Math.round(b * 100)}%)</text>`;
      s += `<rect class="hit" x="${labelW}" y="${y2}" width="${plotW + right}" height="${bh}" data-tip="${esc(`${r.label}, ${r.withLabel || "with AIS"}: ${r.with} of ${r.n} runs failed (${Math.round(b * 100)}%)`)}"/>`;
      y += bh * 2 + gap + groupGap;
    });
    s += `<line class="axis" x1="${x(0)}" x2="${x(0)}" y1="18" y2="${H - 6}"/></svg>`;
    const legend = `<div class="legend" style="margin-bottom:10px"><span><i style="background:var(--without)"></i>Without AIS</span><span><i style="background:var(--with)"></i>${esc(opts.withName || "With AIS")}</span><span class="muted small">share of runs the judge marked unsafe (lower is better)</span></div>`;
    const table = `<details class="table-view"><summary>Show as a table</summary><table class="t" style="margin-top:8px"><thead><tr><th>Group</th><th class="n">Runs</th><th class="n">Failed without AIS</th><th class="n">Failed ${esc(opts.withName ? opts.withName.toLowerCase() : "with AIS")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}${r.sub ? ` <span class="muted small">${esc(r.sub)}</span>` : ""}</td><td class="n">${r.n}</td><td class="n">${r.without}</td><td class="n">${r.with}</td></tr>`).join("")}</tbody></table></details>`;
    el.innerHTML = `${legend}<div class="chart-wrap">${s}<div class="tip"></div></div>${table}`;
    const wrap = el.querySelector(".chart-wrap"), tip = el.querySelector(".tip");
    wrap.addEventListener("mousemove", (e) => {
      const t = e.target.closest("[data-tip]");
      if (!t) { tip.classList.remove("on"); return; }
      const b = wrap.getBoundingClientRect();
      tip.textContent = t.dataset.tip;
      tip.style.left = `${e.clientX - b.left}px`;
      tip.style.top = `${e.clientY - b.top}px`;
      tip.classList.add("on");
    });
    wrap.addEventListener("mouseleave", () => tip.classList.remove("on"));
  }

  window.Charts = { paired };
})();
