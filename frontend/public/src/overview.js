/**
 * overview.js — Overview + Dataset Bias panels.
 * All numbers come from API.stats() and API.biasScore().
 * Nothing is hardcoded.
 */

const OverviewPanel = {
  render() {
    return `
    <div class="panel" id="panel-overview">
      <div class="page-hd">
        <div class="page-title">Bias Overview</div>
        <div class="page-sub">Real-time fairness assessment from your uploaded data. All numbers computed from actual records.</div>
      </div>
      <div class="prog-wrap"><div class="prog-fill" style="width:0%" id="ov-prog"></div></div>
      <div id="ov-banner"></div>
      <div class="stat-row" id="ov-cards"></div>
      <div class="sec">
        <div class="sec-title">Sensitive Attributes</div>
        <div class="sec-sub">Toggle which dimensions to display in the hire rate charts below</div>
        <div class="attr-chips" id="ov-chips"></div>
      </div>
      <div id="ov-charts"></div>
    </div>

    <div class="panel" id="panel-dataset">
      <div class="page-hd">
        <div class="page-title">Dataset Bias</div>
        <div class="page-sub">Inspects the training data for representation gaps, label skew, and missing data — computed from your actual CSV.</div>
      </div>
      <div class="sec">
        <div class="sec-title">Representation Balance</div>
        <div class="sec-sub">Group share of dataset vs share of positive outcomes (hired=1)</div>
        <div id="repr-tbl"></div>
      </div>
      <div class="sec">
        <div class="sec-title">Label Distribution</div>
        <div class="sec-sub">Hired vs Not Hired count per group — from real data</div>
        <div class="cbox-row">
          <div class="cbox"><div class="cbox-title">Gender — Label Balance</div><div class="ch" style="height:210px"><canvas id="c-lbl-gender"></canvas></div></div>
          <div class="cbox"><div class="cbox-title">Race — Label Balance</div><div class="ch" style="height:210px"><canvas id="c-lbl-race"></canvas></div></div>
        </div>
        <div class="cbox"><div class="cbox-title">Education Tier — Label Balance</div><div class="ch" style="height:200px"><canvas id="c-lbl-edu"></canvas></div></div>
      </div>
      <div class="sec">
        <div class="sec-title">Proxy Feature Risk</div>
        <div class="sec-sub">Cramér's V scores computed from your actual data — higher = stronger indirect encoding of protected attributes</div>
        <div id="proxy-tbl"></div>
      </div>
      <div class="sec">
        <div class="sec-title">Missing Data Patterns</div>
        <div class="sec-sub">Columns with missing values in your dataset</div>
        <div id="missing-tbl"></div>
      </div>
    </div>`;
  },

  _activeAttrs: [],
  _stats: null,

  async load() {
    document.getElementById("ov-prog").style.width = "40%";
    try {
      const [stats, bias] = await Promise.all([API.stats(), API.biasScore()]);
      this._stats = stats;
      this._activeAttrs = (stats.group_stats ? Object.keys(stats.group_stats) : []).slice(0, 4);
      this._renderBanner(bias);
      this._renderCards(stats, bias);
      this._renderChips(stats);
      this._renderHireCharts();
      document.getElementById("ov-prog").style.width = "100%";
    } catch (e) {
      document.getElementById("ov-banner").innerHTML =
        `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    }
  },

  _renderBanner(bias) {
    const score = bias.score ?? 0;
    const level = bias.level ?? "UNKNOWN";
    const cls   = score > 60 ? "high" : score > 30 ? "medium" : "low";
    const detail = (bias.details || [])
      .map(d => `${d.attribute}: DPD ${d.dpd}, DIR ${d.dir}`)
      .join(" · ");
    document.getElementById("ov-banner").innerHTML = `
      <div class="banner ${cls}">
        <span class="blabel">${level} — BIAS SCORE ${score}/100</span>
        <span class="btext">${detail || "Bias detected across multiple demographic dimensions."}</span>
      </div>`;
  },

  _renderCards(stats, bias) {
    const hr   = (stats.hire_rate * 100).toFixed(1);
    const score = bias.score ?? "—";
    const scoreCls = score > 60 ? "danger" : score > 30 ? "warn" : "ok";

    // Compute disparate impact from gender if available
    let dir = "—"; let dirCls = "info";
    if (stats.group_stats?.gender) {
      const rates = Object.values(stats.group_stats.gender).map(g => g.hire_rate);
      const d = Math.min(...rates) / Math.max(...rates);
      dir = d.toFixed(3);
      dirCls = d < 0.6 ? "danger" : d < 0.8 ? "warn" : "ok";
    }

    const attrs = Object.keys(stats.group_stats || {}).length;

    document.getElementById("ov-cards").innerHTML = `
      <div class="stat-card ${scoreCls}">
        <div class="sc-label">Bias Score</div>
        <div class="sc-value">${score}</div>
        <div class="sc-sub">/ 100 — ${bias.level || "N/A"}</div>
      </div>
      <div class="stat-card ${dirCls}">
        <div class="sc-label">Disparate Impact (Gender)</div>
        <div class="sc-value">${dir}</div>
        <div class="sc-sub">Legal min: 0.800</div>
      </div>
      <div class="stat-card info">
        <div class="sc-label">Overall Hire Rate</div>
        <div class="sc-value">${hr}%</div>
        <div class="sc-sub">${stats.hired.toLocaleString()} of ${stats.total.toLocaleString()}</div>
      </div>
      <div class="stat-card info">
        <div class="sc-label">Sensitive Attrs</div>
        <div class="sc-value">${attrs}</div>
        <div class="sc-sub">Dimensions audited</div>
      </div>`;
  },

  _renderChips(stats) {
    const attrs = Object.keys(stats.group_stats || {});
    const labels = { gender:"Gender", race_ethnicity:"Race/Ethnicity", age_band:"Age Band",
      disability_status:"Disability", region:"Region", education_tier:"Education",
      experience_level:"Experience", nationality:"Nationality",
      language_profile:"Language", employment_gap:"Emp. Gap" };

    document.getElementById("ov-chips").innerHTML = attrs.map(a => `
      <button class="achip ${this._activeAttrs.includes(a) ? "on" : ""}" data-attr="${a}">
        <span class="adot"></span>${labels[a] || a}
      </button>`).join("");

    document.getElementById("ov-chips").querySelectorAll(".achip").forEach(btn => {
      btn.addEventListener("click", () => {
        const a = btn.dataset.attr;
        if (this._activeAttrs.includes(a)) {
          this._activeAttrs = this._activeAttrs.filter(x => x !== a);
          btn.classList.remove("on");
        } else {
          this._activeAttrs.push(a);
          btn.classList.add("on");
        }
        this._renderHireCharts();
      });
    });
  },

  _renderHireCharts() {
    const container = document.getElementById("ov-charts");
    container.innerHTML = "";
    const stats = this._stats;
    if (!stats) return;

    this._activeAttrs.filter(a => stats.group_stats?.[a]).forEach(attr => {
      const grps = stats.group_stats[attr];
      const groups = Object.entries(grps).map(([label, v]) => ({ label, rate: v.hire_rate }));
      const cid = `c-hr-${attr}`;
      const div = document.createElement("div");
      div.className = "cbox";
      div.innerHTML = `
        <div class="cbox-title">${attr.toUpperCase().replace(/_/g," ")} — HIRE RATE (FROM REAL DATA)</div>
        <div class="ch" style="height:200px"><canvas id="${cid}"></canvas></div>`;
      container.appendChild(div);
      setTimeout(() => Charts.hireRateBar(cid, groups, { rotate: 15 }), 20);
    });
  },

  // ── DATASET BIAS ──────────────────────────────────────────────
  async loadDataset() {
    try {
      const [stats, proxyData] = await Promise.all([API.stats(), API.proxy()]);
      this._renderReprTable(stats);
      this._renderLabelCharts(stats);
      this._renderProxyTable(proxyData);
      this._renderMissingTable(stats);
    } catch (e) {
      document.getElementById("repr-tbl").innerHTML =
        `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    }
  },

  _renderReprTable(stats) {
    const grpStats = stats.group_stats || {};
    let html = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Attribute</th><th>Group</th><th>Count</th><th>Dataset Share</th><th>Hire Rate</th><th>Balance</th><th>Risk</th></tr></thead><tbody>`;

    Object.entries(grpStats).forEach(([attr, groups]) => {
      const vals = Object.values(groups);
      const expected = 1 / vals.length;
      Object.entries(groups).forEach(([grp, v]) => {
        const ratio = v.pct_dataset / expected;
        const rc = ratio < 0.5 ? "red" : ratio < 0.7 ? "amber" : "green";
        const rl = ratio < 0.5 ? "HIGH" : ratio < 0.7 ? "MED" : "OK";
        html += `<tr>
          <td style="font-family:var(--fm);font-size:10px;color:var(--t3)">${attr.replace(/_/g," ")}</td>
          <td>${grp}</td>
          <td style="font-family:var(--fm)">${v.total.toLocaleString()}</td>
          <td style="font-family:var(--fm)">${(v.pct_dataset*100).toFixed(1)}%</td>
          <td style="font-family:var(--fm)">${(v.hire_rate*100).toFixed(1)}%</td>
          <td><div class="ibar"><div class="ibar-bg"><div class="ibar-fill" style="width:${Math.min(100,ratio*50)}%;background:var(--${rc})"></div></div></div></td>
          <td><span class="pill ${rc}">${rl}</span></td>
        </tr>`;
      });
    });
    html += "</tbody></table></div>";
    document.getElementById("repr-tbl").innerHTML = html;
  },

  _renderLabelCharts(stats) {
    const gs = stats.group_stats || {};
    [["gender","c-lbl-gender"], ["race_ethnicity","c-lbl-race"], ["education_tier","c-lbl-edu"]]
      .forEach(([attr, cid]) => {
        if (!gs[attr]) return;
        const grps = gs[attr];
        const labels = Object.keys(grps);
        Charts.barChart(cid, labels, [
          { label:"Hired",     data: labels.map(g => grps[g].hired),         backgroundColor:"#9d8df8", borderRadius:4 },
          { label:"Not Hired", data: labels.map(g => grps[g].total - grps[g].hired), backgroundColor:"#f87171", borderRadius:4 },
        ], { legend: true, count: true, rotate: 15 });
      });
  },

  _renderProxyTable(proxyData) {
    const risks = proxyData.feature_proxy_risks || {};
    if (!Object.keys(risks).length) {
      document.getElementById("proxy-tbl").innerHTML =
        `<div class="banner low"><span class="blabel">CLEAN</span><span class="btext">No proxy features detected above threshold.</span></div>`;
      return;
    }
    let html = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Feature</th><th>Max Cramér's V</th><th>Risk</th><th>Encodes</th><th>Recommendation</th></tr></thead><tbody>`;
    Object.entries(risks)
      .sort((a, b) => b[1].max_proxy_score - a[1].max_proxy_score)
      .forEach(([feat, r]) => {
        const attrs = r.correlations.map(c => c.sensitive_attr).join(", ");
        html += `<tr>
          <td style="font-family:var(--fm);font-size:12px">${feat}</td>
          <td style="font-family:var(--fm)">${r.max_proxy_score}</td>
          <td><span class="pill ${r.risk_level==="HIGH"?"red":"amber"}">${r.risk_level}</span></td>
          <td style="color:var(--t2);font-size:12px">${attrs}</td>
          <td style="font-size:11px;color:var(--t3);max-width:280px">${r.recommendation.slice(0,120)}…</td>
        </tr>`;
      });
    html += "</tbody></table></div>";
    document.getElementById("proxy-tbl").innerHTML = html;
  },

  _renderMissingTable(stats) {
    const missing = stats.missing_by_col || {};
    if (!Object.keys(missing).length) {
      document.getElementById("missing-tbl").innerHTML =
        `<div class="banner low"><span class="blabel">CLEAN</span><span class="btext">No missing values detected in any column.</span></div>`;
      return;
    }
    let html = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Column</th><th>Missing Count</th><th>% Missing</th><th>Impact</th></tr></thead><tbody>`;
    const total = stats.total || 1;
    Object.entries(missing).sort((a,b) => b[1]-a[1]).forEach(([col, n]) => {
      const pct = n / total;
      const rc = pct > 0.1 ? "red" : pct > 0.05 ? "amber" : "green";
      html += `<tr>
        <td style="font-family:var(--fm)">${col}</td>
        <td style="font-family:var(--fm)">${n}</td>
        <td style="font-family:var(--fm)">${(pct*100).toFixed(1)}%</td>
        <td><span class="pill ${rc}">${pct>0.1?"HIGH":pct>0.05?"MED":"LOW"}</span></td>
      </tr>`;
    });
    html += "</tbody></table></div>";
    document.getElementById("missing-tbl").innerHTML = html;
  },
};

window.OverviewPanel = OverviewPanel;
