/**
 * gemini.js — AI Explanations Panel
 * Uses Groq API (via backend) to explain audit findings in plain English.
 */

const GeminiPanel = {

  render() {
    return `
    <div class="panel" id="panel-gemini">
      <div class="page-hd">
        <div class="page-title">AI Explanations</div>
        <div class="page-sub">
          Powered by Groq / LLaMA. Each explanation is generated from your actual audit results.
        </div>
      </div>

      <div id="gemini-key-warn" style="display:none">
        <div class="banner medium">
          <span class="blabel">SETUP NEEDED</span>
          <span class="btext">
            Set <code style="font-family:var(--fm);background:var(--s3);padding:1px 5px;border-radius:4px">GROQ_API_KEY</code>
            on the backend server to enable AI explanations.
            Get a free key at
            <a href="https://console.groq.com" style="color:var(--amber)">console.groq.com</a>
          </span>
        </div>
      </div>

      <div id="gemini-no-data-warn" style="display:none">
        <div class="banner medium">
          <span class="blabel">NO DATA</span>
          <span class="btext">
            Please upload a dataset and run an audit first before generating AI explanations.
          </span>
        </div>
      </div>

      <div class="sec">
        <div class="sec-title">Executive Summary</div>
        <div class="sec-sub">Plain-English summary of the full audit for managers and stakeholders</div>
        <div id="gemini-summary-container">
          <button class="btn btn-primary" id="gen-summary-btn"
                  onclick="GeminiPanel.generateSummary()">
            Generate executive summary
          </button>
        </div>
      </div>

      <div class="sec">
        <div class="sec-title">Metric Explanations</div>
        <div class="sec-sub">Select a dimension and metric to get a plain-English explanation</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <select class="flt-select" id="gem-attr-sel">
            <option value="">Select attribute…</option>
          </select>
          <select class="flt-select" id="gem-metric-sel">
            <option value="dpd" data-threshold="-0.05">Demographic Parity Difference</option>
            <option value="dir" data-threshold="0.80">Disparate Impact Ratio</option>
            <option value="eod" data-threshold="-0.05">Equal Opportunity Difference</option>
            <option value="fpr" data-threshold="0.05">FPR Gap</option>
          </select>
          <button class="btn btn-outline" onclick="GeminiPanel.explainMetric()">
            Explain this metric
          </button>
        </div>
        <div id="gemini-metric-result"></div>
      </div>

      <div class="sec">
        <div class="sec-title">Proxy Feature Explanations</div>
        <div class="sec-sub">Why each flagged feature may introduce bias — explained for HR teams</div>
        <div id="gemini-proxy-list">
          <div class="empty">
            <div class="empty-ico">🧬</div>
            <div class="empty-title">Run proxy analysis first</div>
            <div class="empty-sub">Go to Feature Analysis panel, then come back here</div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-title">Mitigation Explanation</div>
        <div class="sec-sub">What the mitigation strategies did — in plain English</div>
        <div id="gemini-mitigation-result">
          <div class="empty">
            <div class="empty-ico">🛠️</div>
            <div class="empty-title">Run mitigation first</div>
            <div class="empty-sub">Go to Mitigation panel, run a strategy, then come back here</div>
          </div>
        </div>
      </div>
    </div>`;
  },

  async load() {
    // Check API key / health
    try {
      const h = await API.health();
      if (!h.groq_enabled && !h.gemini_enabled) {
        document.getElementById("gemini-key-warn").style.display = "block";
      }
    } catch (e) {
      console.warn("Health check failed:", e);
    }

    // Check dataset is loaded
    const meta     = App.datasetMeta || {};
    const sensCols = Object.keys(meta.sensitive_cols || {});

    if (!meta || !sensCols.length) {
      const warn = document.getElementById("gemini-no-data-warn");
      if (warn) warn.style.display = "block";
    }

    // Populate attribute selector from detected columns
    const sel     = document.getElementById("gem-attr-sel");
    sel.innerHTML = '<option value="">Select attribute…</option>';
    sensCols.forEach(col => {
      const opt       = document.createElement("option");
      opt.value       = col;
      opt.textContent = col.replace(/_/g, " ");
      sel.appendChild(opt);
    });

    this.loadProxyExplanations();
  },

  async generateSummary() {
    const container = document.getElementById("gemini-summary-container");

    // Guard: need audit data
    if (!App.datasetMeta) {
      container.innerHTML = `
        <div class="banner medium">
          <span class="blabel">NO DATA</span>
          <span class="btext">Upload a dataset and run an audit first.</span>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="loading-row"><div class="spinner"></div> Generating summary…</div>`;

    try {
      const body   = App.lastAuditId ? { audit_id: App.lastAuditId } : {};
      const result = await API._fetch("/explain/report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!result.ok && result.error) {
        throw new Error(result.error);
      }

      const summaryText = result.summary || "No summary returned.";

      container.innerHTML = `
        <div class="cbox">
          <div class="cbox-title">EXECUTIVE SUMMARY</div>
          <div style="font-size:14px;color:var(--t2);line-height:1.8;white-space:pre-wrap">${summaryText}</div>
          <div style="margin-top:14px;display:flex;gap:10px">
            <button class="btn btn-outline"
                    data-text="${summaryText.replace(/"/g, '&quot;')}"
                    onclick="GeminiPanel.copyText(this)">Copy text</button>
            <button class="btn btn-primary" onclick="GeminiPanel.generateSummary()">Regenerate</button>
          </div>
        </div>`;
    } catch (e) {
      container.innerHTML = `
        <div class="banner high">
          <span class="blabel">ERROR</span>
          <span class="btext">${e.message}</span>
        </div>
        <button class="btn btn-outline" style="margin-top:10px"
                onclick="GeminiPanel.generateSummary()">Retry</button>`;
    }
  },

  async explainMetric() {
    const attrSel   = document.getElementById("gem-attr-sel");
    const metricSel = document.getElementById("gem-metric-sel");
    const attr      = attrSel.value;

    if (!attr) {
      App.notify("Select a sensitive attribute first", "error");
      return;
    }

    const resultEl = document.getElementById("gemini-metric-result");
    resultEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Generating explanation…</div>`;

    try {
      const fm = await API.fairness(attr);

      if (!fm || fm.error) {
        throw new Error(fm?.error || "Could not load fairness data. Run an audit first.");
      }

      const metricMap = {
        dpd: { name: "Demographic Parity Difference", value: fm.demographic_parity?.dpd,  threshold: -0.05 },
        dir: { name: "Disparate Impact Ratio",        value: fm.disparate_impact?.dir,    threshold:  0.80 },
        eod: { name: "Equal Opportunity Difference",  value: fm.equal_opportunity?.eod,   threshold: -0.05 },
        fpr: { name: "False Positive Rate Gap",       value: fm.fpr_gap?.fpr_gap,         threshold:  0.05 },
      };

      const m = metricMap[metricSel.value];
      if (m.value == null) {
        resultEl.innerHTML = `
          <div class="banner medium">
            <span class="blabel">N/A</span>
            <span class="btext">Metric not available for this attribute.</span>
          </div>`;
        return;
      }

      const result = await API._fetch("/explain/metric", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          metric_name: m.name,
          value:       m.value,
          threshold:   m.threshold,
          attribute:   attr,
        }),
      });

      if (!result.ok && result.error) {
        throw new Error(result.error);
      }

      const absVal   = Math.abs(m.value);
      const absThr   = Math.abs(m.threshold);
      const valColor = absVal > absThr * 1.5 ? "var(--red)"
                     : absVal > absThr        ? "var(--amber)"
                     : "var(--green)";

      resultEl.innerHTML = `
        <div class="cbox">
          <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px">
            <div style="font-family:var(--fm);font-size:10px;color:var(--t3);text-transform:uppercase">${m.name}</div>
            <div style="font-family:var(--fd);font-size:28px;color:${valColor}">${m.value.toFixed(4)}</div>
            <div style="font-family:var(--fm);font-size:11px;color:var(--t3)">threshold: ${m.threshold}</div>
          </div>
          <div style="font-size:14px;color:var(--t2);line-height:1.8;padding:14px;background:var(--s2);border-radius:var(--r2)">
            ${result.explanation || "No explanation returned."}
          </div>
        </div>`;
    } catch (e) {
      resultEl.innerHTML = `
        <div class="banner high">
          <span class="blabel">ERROR</span>
          <span class="btext">${e.message}</span>
        </div>`;
    }
  },

  async loadProxyExplanations() {
    const container = document.getElementById("gemini-proxy-list");
    try {
      const data  = await API.proxy();
      const risks = data.feature_proxy_risks || {};
      const high  = Object.entries(risks)
                          .filter(([, r]) => r.risk_level === "HIGH")
                          .slice(0, 5);

      if (!high.length) {
        container.innerHTML = `
          <div class="banner low">
            <span class="blabel">CLEAN</span>
            <span class="btext">No high-risk proxy features detected.</span>
          </div>`;
        return;
      }

      container.innerHTML = high.map(([feat]) => `
        <div class="cbox" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-family:var(--fm);font-size:12px">${feat}</div>
            <button class="btn btn-outline" style="font-size:11px;padding:4px 10px"
                    onclick="GeminiPanel.explainProxy('${feat}', this)">Explain</button>
          </div>
          <div id="proxy-exp-${feat}" style="font-size:13px;color:var(--t3)">
            Click Explain to get a plain-English explanation
          </div>
        </div>`).join("");

    } catch (e) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-ico">🧬</div>
          <div class="empty-title">Run proxy analysis first</div>
          <div class="empty-sub">Go to Feature Analysis panel, then come back here</div>
        </div>`;
    }
  },

  async explainProxy(feature, btn) {
    const container = document.getElementById(`proxy-exp-${feature}`);
    container.innerHTML = `<div class="loading-row" style="padding:4px 0"><div class="spinner" style="width:16px;height:16px"></div> Generating…</div>`;
    btn.disabled = true;
    try {
      const result = await API._fetch(`/explain/proxy/${encodeURIComponent(feature)}`);

      if (!result.ok && result.error) {
        throw new Error(result.error);
      }

      container.innerHTML = `
        <div style="font-size:13px;color:var(--t2);line-height:1.7;padding:10px;background:var(--s2);border-radius:var(--r)">
          ${result.explanation || "No explanation returned."}
        </div>`;
    } catch (e) {
      container.innerHTML = `<span style="color:var(--red);font-size:12px">${e.message}</span>`;
    } finally {
      btn.disabled = false;
    }
  },

  async explainMitigation(before, after, strategies, sensCol) {
    const container = document.getElementById("gemini-mitigation-result");
    container.innerHTML = `<div class="loading-row"><div class="spinner"></div> Generating explanation…</div>`;
    try {
      const result = await API._fetch("/explain/mitigation", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ before, after, strategies, sensitive_col: sensCol }),
      });

      if (!result.ok && result.error) {
        throw new Error(result.error);
      }

      container.innerHTML = `
        <div class="cbox">
          <div class="cbox-title">MITIGATION EXPLANATION</div>
          <div style="font-size:14px;color:var(--t2);line-height:1.8;padding:14px;background:var(--s2);border-radius:var(--r2)">
            ${result.explanation || "No explanation returned."}
          </div>
        </div>`;
    } catch (e) {
      container.innerHTML = `
        <div class="banner high">
          <span class="blabel">ERROR</span>
          <span class="btext">${e.message}</span>
        </div>`;
    }
  },

  copyText(btn) {
    const text = btn.dataset.text || "";
    navigator.clipboard.writeText(text)
      .then(() => App.notify("Copied to clipboard", "success"))
      .catch(() => App.notify("Copy failed", "error"));
  },
};

window.GeminiPanel = GeminiPanel;