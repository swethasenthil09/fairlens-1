/**
 * mitigation.js — Mitigation panel.
 * Calls API.mitigate() which re-trains model with real strategies.
 * Before/after numbers come from actual model runs — not hardcoded.
 */

const MitigationPanel = {
  _enabled: { reweight: false, threshold: false },
  _results: null,
  _sensAttr: "gender",

  render() {
    return `
    <div class="panel" id="panel-mitigation">
      <div class="page-hd">
        <div class="page-title">Mitigation Strategies</div>
        <div class="page-sub">
          Apply bias reduction techniques and compare results before and after.
          Results are computed from your actual dataset.
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
        <span style="font-size:12px;color:var(--t3)">Evaluate on:</span>
        <select class="flt-select" id="mit-attr-sel">
          <option value="gender">Gender</option>
          <option value="race_ethnicity">Race / Ethnicity</option>
          <option value="age_band">Age Band</option>
          <option value="disability_status">Disability</option>
        </select>
        <button class="btn btn-primary" id="run-mit-btn">
          Run Mitigation
        </button>
        <div class="spinner" id="mit-spinner" style="display:none"></div>
      </div>

      <div id="mit-cards-container"></div>

      <div id="mit-results">
        <div class="empty">
          <div class="empty-ico">🛠️</div>
          <div class="empty-title">Select strategies and click Run Mitigation</div>
          <div class="empty-sub">Results will show before/after metrics after applying the selected strategy</div>
        </div>
      </div>
    </div>`;
  },

  load() {
    this._renderCards();
    document.getElementById("run-mit-btn").addEventListener("click", () => this._run());
    document.getElementById("mit-attr-sel").addEventListener("change", e => {
      this._sensAttr = e.target.value;
    });
  },

  _renderCards() {
    const strategies = [
      {
        id: "reweight",
        name: "Reweighing",
        tag: "pre", tagLabel: "Pre-processing",
        desc: "Kamiran & Calders (2012): Reweights training samples so each (group, label) combination appears with its expected frequency under independence. Applied before model training.",
      },
      {
        id: "threshold",
        name: "Equalized Odds Threshold Tuning",
        tag: "post", tagLabel: "Post-processing",
        desc: "Hardt et al. (2016): Finds per-group decision thresholds that equalize TPR and FPR across groups. Applied to model outputs after training — no retraining needed.",
      },
    ];

    document.getElementById("mit-cards-container").innerHTML = strategies.map(s => `
      <div class="mit-card ${this._enabled[s.id] ? "on" : ""}" id="mc-${s.id}">
        <div class="mit-body">
          <div class="mit-title">${s.name} <span class="mit-tag ${s.tag}">${s.tagLabel}</span></div>
          <div class="mit-desc">${s.desc}</div>
        </div>
        <button class="tog ${this._enabled[s.id] ? "on" : ""}" id="tog-${s.id}"></button>
      </div>`).join("");

    ["reweight","threshold"].forEach(id => {
      document.getElementById(`tog-${id}`).addEventListener("click", () => {
        this._enabled[id] = !this._enabled[id];
        document.getElementById(`tog-${id}`).classList.toggle("on", this._enabled[id]);
        document.getElementById(`mc-${id}`).classList.toggle("on", this._enabled[id]);
      });
    });
  },

  async _run() {
    const strategies = Object.entries(this._enabled).filter(([,v])=>v).map(([k])=>k);
    if (!strategies.length) {
      App.notify("Enable at least one strategy first", "error");
      return;
    }
    document.getElementById("mit-spinner").style.display = "inline-block";
    document.getElementById("run-mit-btn").disabled = true;
    document.getElementById("mit-results").innerHTML =
      `<div class="loading-row"><div class="spinner"></div> Applying mitigation strategy — this may take 10–20 seconds…</div>`;

    try {
      const data = await API.mitigate(strategies, this._sensAttr);
      this._results = data.mitigation_results;
      this._renderResults(strategies);
      App.log("mitigation", "Mitigation run completed",
        `Strategies: ${strategies.join(", ")} · Attr: ${this._sensAttr}`, "#9d8df8");

      // Auto-trigger AI explanation in the Gemini panel
      const r     = this._results;
      const base  = r.baseline;
      const after = r.after_combined || r.after_reweighing || r.after_threshold_adjustment;
      if (base && after && window.GeminiPanel) {
        GeminiPanel.explainMitigation(base, after, strategies, this._sensAttr);
      }
    } catch (e) {
      document.getElementById("mit-results").innerHTML =
        `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    } finally {
      document.getElementById("mit-spinner").style.display = "none";
      document.getElementById("run-mit-btn").disabled = false;
    }
  },

  _renderResults(strategies) {
    const r = this._results;
    if (!r) return;

    const base  = r.baseline;
    // pick best result
    const after = r.after_combined || r.after_reweighing || r.after_threshold_adjustment;

    const row = (k, bv, av, lowerBetter = false) => {
      const b = typeof bv === "number" ? bv.toFixed(4) : (bv ?? "N/A");
      const a = typeof av === "number" ? av.toFixed(4) : (av ?? "N/A");
      const improved = typeof bv === "number" && typeof av === "number"
        ? (lowerBetter ? Math.abs(av) < Math.abs(bv) : av > bv)
        : false;
      return `<div class="ba-row">
        <span class="ba-k">${k}</span>
        <span class="ba-v">${b}</span>
        <span style="color:${improved?"var(--green)":"var(--amber)"};font-family:var(--fm);font-size:11px">→ ${a} ${improved?"▲":"▼"}</span>
      </div>`;
    };

    let html = `
      <div class="banner low" style="margin-bottom:18px;">
        <span class="blabel">COMPUTED</span>
        <span class="btext">
          Real before/after results from running mitigation on your dataset.
          Strategy: ${strategies.join(" + ")} · Attribute: ${this._sensAttr}
        </span>
      </div>

      <div style="background:var(--s1);border:1px solid var(--b1);border-radius:var(--r2);padding:18px;margin-bottom:16px;">
        <div style="font-family:var(--fm);font-size:11px;color:var(--t3);margin-bottom:14px;text-transform:uppercase">BEFORE → AFTER COMPARISON</div>
        ${row("Accuracy", base?.accuracy, after?.accuracy)}
        ${row("AUC",      base?.auc,      after?.auc)}
        ${row("Demographic Parity Diff (DPD)", base?.dpd, after?.dpd, true)}
        ${row("Equal Opportunity Diff (EOD)",  base?.eod, after?.eod, true)}
        ${row("FPR Gap",                       base?.fpr_gap, after?.fpr_gap, true)}
        ${row("Disparate Impact Ratio (DIR)",   base?.dir, after?.dir)}
        <div class="ba-row">
          <span class="ba-k">Passes 80% Rule</span>
          <span class="ba-v" style="color:${base?.passes_80_rule?"var(--green)":"var(--red)"}">${base?.passes_80_rule?"✓":"✗"}</span>
          <span style="color:${after?.passes_80_rule?"var(--green)":"var(--amber)"};font-family:var(--fm);font-size:11px">→ ${after?.passes_80_rule?"✓ PASSES":"✗ STILL FAILS"}</span>
        </div>
      </div>`;

    // Group rates before/after
    if (base?.group_rates && after?.group_rates) {
      html += `<div class="cbox-row">
        <div class="ba-box before">
          <div class="ba-hd">Before — Group Hire Rates</div>
          ${Object.entries(base.group_rates).map(([g,r])=>`
            <div class="ba-row"><span class="ba-k">${g}</span><span class="ba-v">${(r*100).toFixed(1)}%</span></div>`).join("")}
        </div>
        <div class="ba-box after">
          <div class="ba-hd">After — Group Hire Rates</div>
          ${Object.entries(after.group_rates).map(([g,r])=>`
            <div class="ba-row"><span class="ba-k">${g}</span><span class="ba-v">${(r*100).toFixed(1)}%</span></div>`).join("")}
        </div>
      </div>`;
    }

    // Before/after chart
    html += `<div class="cbox">
      <div class="cbox-title">METRIC COMPARISON — BEFORE vs AFTER (LOWER IS BETTER FOR BIAS METRICS)</div>
      <div class="ch" style="height:220px"><canvas id="c-mit-compare"></canvas></div>
      <div class="legend"><span><span class="lsw" style="background:#f87171"></span>Before</span><span><span class="lsw" style="background:#4ade80"></span>After</span></div>
    </div>`;

    if (r.thresholds_used) {
      html += `<div class="cbox">
        <div class="cbox-title">PER-GROUP DECISION THRESHOLDS (EQUALIZED ODDS)</div>
        <table class="tbl"><thead><tr><th>Group</th><th>Threshold</th></tr></thead><tbody>
        ${Object.entries(r.thresholds_used).map(([g,t])=>`<tr><td>${g}</td><td style="font-family:var(--fm)">${t}</td></tr>`).join("")}
        </tbody></table>
      </div>`;
    }

    document.getElementById("mit-results").innerHTML = html;

    setTimeout(() => {
      const labels = ["|DPD|", "|EOD|", "FPR Gap", "1−DIR"];
      const bef = [Math.abs(base?.dpd||0), Math.abs(base?.eod||0), base?.fpr_gap||0, 1-(base?.dir||0)];
      const aft = [Math.abs(after?.dpd||0), Math.abs(after?.eod||0), after?.fpr_gap||0, 1-(after?.dir||0)];
      Charts.beforeAfterBar("c-mit-compare", labels, bef, aft);
    }, 50);
  },
};

window.MitigationPanel = MitigationPanel;