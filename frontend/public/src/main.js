/**
 * main.js — App bootstrap, routing, global state, audit log.
 * Registers all panels including the new Gemini + Firebase ones.
 */

const App = {
  datasetLoaded:  false,
  modelTrained:   false,
  datasetMeta:    null,
  trainResult:    null,
  lastAuditId:    null,       // set after report saves to Firebase
  _log:           [],
  _notifTimer:    null,

  STEP_MAP: {
    upload:"upload", preview:"inspect", overview:"inspect",
    dataset:"measure", model:"measure", features:"measure",
    inspector:"measure", mitigation:"fix", report:"report",
    gemini:"report", firebase:"", auditlog:"",
  },

  init() {
    this._buildPanels();
    this._bindNav();
    this._checkHealth();
    this.go("upload");
    this.log("system", "FairLens v4 initialised",
      "Gemini + Firebase + Real-Time Engine ready", "#6a6a7e");
  },

  _buildPanels() {
    const root = document.getElementById("content-root");
    root.innerHTML = [
      // Upload
      UploadPanel.render(),

      // Data preview (inline)
      `<div class="panel" id="panel-preview">
        <div class="page-hd">
          <div class="page-title">Data Preview</div>
          <div class="page-sub">First 100 rows from your uploaded CSV. All values are real — nothing assumed.</div>
        </div>
        <div class="stat-row" id="prev-cards"></div>
        <div class="sec">
          <div class="sec-title">Raw Records</div>
          <div class="sec-sub" id="prev-sub"></div>
          <div id="prev-tbl-wrap"></div>
        </div>
      </div>`,

      // Overview + Dataset panels
      OverviewPanel.render(),

      // Metrics + Features panels
      MetricsPanel.render(),

      // Inspector
      InspectorPanel.render(),

      // Mitigation
      MitigationPanel.render(),

      // Report + Audit log
      ReportPanel.render(),

      // NEW — Gemini explanations
      GeminiPanel.render(),

      // NEW — Firebase account & history
      FirebasePanel.render(),

      // Audit log (standalone panel from ReportPanel.render() already includes it)
    ].join("");

    // Bind upload events
    UploadPanel.bind();
  },

  _bindNav() {
    document.querySelectorAll(".nav-item[data-panel]").forEach(btn => {
      btn.addEventListener("click", () => this.go(btn.dataset.panel));
    });
  },

  go(panelId) {
    // Only block locked panels if dataset not loaded
    const alwaysOpen = ["upload", "auditlog", "firebase"];
    if (!this.datasetLoaded && !alwaysOpen.includes(panelId)) {
      this.notify("Upload a dataset first", "error");
      return;
    }

    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

    const panel  = document.getElementById(`panel-${panelId}`);
    if (panel) panel.classList.add("active");
    const navBtn = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
    if (navBtn) navBtn.classList.add("active");

    this._updateStepper(this.STEP_MAP[panelId] || "");

    // Trigger panel data loads
    const loaders = {
      preview:    () => this._loadPreview(),
      overview:   () => OverviewPanel.load(),
      dataset:    () => OverviewPanel.loadDataset(),
      model:      () => MetricsPanel.load(),
      features:   () => MetricsPanel.loadFeatures(),
      inspector:  () => InspectorPanel.load(),
      mitigation: () => MitigationPanel.load(),
      report:     () => ReportPanel.load(),
      gemini:     () => GeminiPanel.load(),        // NEW
      firebase:   () => FirebasePanel.load(),      // NEW
      auditlog:   () => this._renderLog(),
    };
    if (loaders[panelId]) loaders[panelId]();
  },

  async _loadPreview() {
    try {
      const data = await API.preview(100);
      const meta = this.datasetMeta || {};
      const ds   = meta.dataset_stats || {};
      const hired = ds.hired || 0;
      const total = data.total_rows || 0;

      document.getElementById("prev-cards").innerHTML = `
        <div class="stat-card info"><div class="sc-label">Total Records</div>
          <div class="sc-value">${total.toLocaleString()}</div>
          <div class="sc-sub">${(data.columns||[]).length} columns</div></div>
        <div class="stat-card ok"><div class="sc-label">Positive Outcome</div>
          <div class="sc-value">${hired.toLocaleString()}</div>
          <div class="sc-sub">${(hired/total*100||0).toFixed(1)}% rate</div></div>
        <div class="stat-card warn"><div class="sc-label">Negative Outcome</div>
          <div class="sc-value">${(total-hired).toLocaleString()}</div>
          <div class="sc-sub">${((total-hired)/total*100||0).toFixed(1)}%</div></div>
        <div class="stat-card info"><div class="sc-label">Showing</div>
          <div class="sc-value">${data.rows?.length||0}</div>
          <div class="sc-sub">of ${total.toLocaleString()} records</div></div>`;

      document.getElementById("prev-sub").textContent =
        `${total.toLocaleString()} total records · outcome column: "${data.col_config?.outcome_col||"?"}"`;

      const cols = data.columns || [];
      const rows = data.rows   || [];
      let html = `<div class="tbl-wrap scroll" style="overflow-x:auto">
        <table class="tbl" style="white-space:nowrap">
          <thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead>
          <tbody>`;
      rows.forEach(r => {
        const outcome = parseInt(r[data.col_config?.outcome_col]);
        html += `<tr>${cols.map(c => {
          const v = r[c] ?? "—";
          if (c === data.col_config?.outcome_col)
            return `<td><span class="pill ${outcome?"green":"red"}">${outcome?"POSITIVE":"NEGATIVE"}</span></td>`;
          const n = parseFloat(v);
          if (!isNaN(n) && v !== "" && v !== "—")
            return `<td style="font-family:var(--fm);color:var(--t2)">${n.toFixed(2)}</td>`;
          return `<td>${v}</td>`;
        }).join("")}</tr>`;
      });
      html += "</tbody></table></div>";
      document.getElementById("prev-tbl-wrap").innerHTML = html;

    } catch (e) {
      document.getElementById("prev-tbl-wrap").innerHTML =
        `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    }
  },

  unlockAll() {
    document.querySelectorAll(".nav-item.locked").forEach(n => n.classList.remove("locked"));
  },

  _updateStepper(step) {
    const steps = ["upload","inspect","measure","fix","report"];
    const idx   = steps.indexOf(step);
    steps.forEach((s, i) => {
      const el = document.getElementById(`step-${s}`);
      if (!el) return;
      el.className = "step" + (i < idx ? " done" : i === idx ? " active" : "");
    });
  },

  setStatus(text, state) {
    document.getElementById("stext").textContent = text;
    document.getElementById("sdot").className    = "sdot" + (state ? " "+state : "");
  },

  async _checkHealth() {
    const check = async () => {
      try {
        const h = await API.health();
        const gemini   = h.gemini_enabled   ? "✓ Gemini"   : "✗ Gemini";
        const firebase = h.firebase_enabled ? "✓ Firebase" : "✗ Firebase";
        this.setStatus(`Connected · ${gemini} · ${firebase}`, "live");
      } catch {
        this.setStatus("Backend offline — run python app.py", "dead");
        this.notify("⚠ Backend not running. Start: cd backend && python app.py", "error");
      }
    };
    await check();
    setInterval(check, 15000);
  },

  notify(msg, type = "") {
    const el = document.getElementById("notif");
    el.textContent   = msg;
    el.className     = "notif show " + type;
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => el.classList.remove("show"), 4000);
  },

  log(type, action, detail, color = "#6a6a7e") {
    this._log.unshift({
      type, action, detail, color,
      time: new Date().toLocaleTimeString(),
    });
    const badge = document.getElementById("log-badge");
    if (badge) badge.textContent = this._log.length;
    if (document.getElementById("panel-auditlog")?.classList.contains("active")) {
      this._renderLog();
    }
  },

  _renderLog() {
    const el = document.getElementById("log-entries");
    if (!el) return;
    if (!this._log.length) {
      el.innerHTML = `<div class="empty"><div class="empty-ico">📋</div>
        <div class="empty-title">No actions logged yet</div></div>`;
      return;
    }
    el.innerHTML = this._log.map(e => `
      <div class="log-entry">
        <div class="log-time">${e.time}</div>
        <div class="log-dot" style="background:${e.color}"></div>
        <div>
          <div class="log-action">${e.action}</div>
          <div class="log-detail">${e.detail}</div>
        </div>
      </div>`).join("");
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
window.App = App;
