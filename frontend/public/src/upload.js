/**
 * upload.js — Universal upload panel.
 * After upload, shows auto-detected column roles.
 * User can correct any misdetection before analysis starts.
 */

const UploadPanel = {
  _colConfig: null,
  _allCols: [],

  render() {
    return `
    <div class="panel" id="panel-upload">
      <div class="page-hd">
        <div class="page-title">Upload Dataset</div>
        <div class="page-sub">
          Drop <strong>any CSV</strong> — hiring, loan approvals, admissions, healthcare.
          The engine auto-detects columns. You can correct any misdetection before analysis.
        </div>
      </div>

      <div class="drop-zone" id="drop-zone">
        <div class="dz-icon">📂</div>
        <div class="dz-title">Drop your CSV here</div>
        <div class="dz-sub">Any tabular dataset with a binary outcome column and demographic attributes</div>
        <button class="dz-btn" id="browse-btn">Browse file</button>
        <input type="file" id="file-input" accept=".csv"/>
      </div>

      <div id="upload-status"></div>
      <div id="col-config-panel"></div>
    </div>`;
  },

  bind() {
    const dz  = document.getElementById("drop-zone");
    const fi  = document.getElementById("file-input");
    const btn = document.getElementById("browse-btn");
    btn.addEventListener("click", (e) => { e.stopPropagation(); fi.click(); });
    dz.addEventListener("click", () => fi.click());
    fi.addEventListener("change", (e) => this._handleFile(e.target.files[0]));
    dz.addEventListener("dragover",  (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault(); dz.classList.remove("over");
      this._handleFile(e.dataTransfer.files[0]);
    });
  },

  async _handleFile(file) {
    if (!file) return;
    const statusEl = document.getElementById("upload-status");
    statusEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Parsing ${file.name}…</div>`;
    App.setStatus("Uploading…", "");

    try {
      const data = await API.upload(file);
      this._colConfig = data;
      this._allCols   = data.columns || [];
      App.datasetLoaded = true;
      App.datasetMeta   = data;
      document.getElementById("ds-badge").textContent =
        `${file.name} — ${data.n_rows.toLocaleString()} rows`;
      App.setStatus("Parsed", "warn");
      App.log("upload", "Dataset uploaded", `${file.name} · ${data.n_rows} rows · ${data.n_cols} cols`, "#9d8df8");

      // Show detection result
      statusEl.innerHTML = this._detectionBanner(data);

      // Show column config UI for user to review/correct
      this._renderColConfig(data);

    } catch (e) {
      statusEl.innerHTML = `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
      App.setStatus("Error", "dead");
    }
  },

  _detectionBanner(data) {
    const warns = (data.warnings || []).join(" · ");
    const ready = data.ready;
    return `
      <div class="banner ${ready ? "low" : "medium"}" style="margin-top:16px">
        <span class="blabel">${ready ? "READY" : "REVIEW NEEDED"}</span>
        <span class="btext">
          ${data.n_rows.toLocaleString()} rows · ${data.n_cols} columns ·
          Outcome: <strong>${data.outcome_col || "not detected"}</strong>
          (confidence: ${((data.outcome_confidence||0)*100).toFixed(0)}%) ·
          Sensitive attrs: <strong>${Object.keys(data.sensitive_cols||{}).join(", ") || "none"}</strong> ·
          Features: <strong>${(data.numeric_cols||[]).length} numeric</strong>
          ${warns ? `<br><span style="color:var(--amber)">⚠ ${warns}</span>` : ""}
        </span>
      </div>`;
  },

  _renderColConfig(data) {
    const panel = document.getElementById("col-config-panel");
    const sens  = data.sensitive_cols || {};
    const num   = data.numeric_cols   || [];
    const cat   = data.categorical_cols || [];
    const ids   = data.id_cols || [];
    const allCols = data.columns || [];

    const colOption = (c, selected) =>
      `<option value="${c}" ${selected === c ? "selected" : ""}>${c}</option>`;

    const multiChips = (cols, selectedSet, name) =>
      cols.map(c => `
        <label style="display:inline-flex;align-items:center;gap:5px;margin:3px;
          padding:5px 10px;border-radius:20px;cursor:pointer;font-size:12px;
          border:1px solid ${selectedSet.has(c) ? "var(--purple)" : "var(--b2)"};
          background:${selectedSet.has(c) ? "var(--pbg)" : "transparent"};
          color:${selectedSet.has(c) ? "var(--purple)" : "var(--t3)"}">
          <input type="checkbox" name="${name}" value="${c}"
            ${selectedSet.has(c) ? "checked" : ""}
            style="display:none"
            onchange="UploadPanel._onChipChange(this)"/>
          ${c}
        </label>`).join("");

    panel.innerHTML = `
      <div style="margin-top:24px">
        <div class="sec-title">Column Configuration</div>
        <div class="sec-sub">
          Review what was auto-detected below. Correct anything before running analysis.
          The engine uses only what you confirm here — no assumptions.
        </div>

        <!-- Outcome column -->
        <div class="settings-group">
          <div class="sg-title">Outcome Column <span class="pill red" style="font-size:9px">REQUIRED</span></div>
          <div class="sg-sub">The binary label column — what you're trying to predict (hired/not, approved/rejected, etc.)</div>
          <div class="sg-row">
            <div><div class="sg-label">Detected outcome column</div><div class="sg-hint">Must be binary (0/1, Yes/No, Hired/Not, etc.)</div></div>
            <select class="flt-select" id="cfg-outcome" style="width:220px">
              ${allCols.map(c => colOption(c, data.outcome_col)).join("")}
            </select>
          </div>
        </div>

        <!-- Sensitive columns -->
        <div class="settings-group">
          <div class="sg-title">Sensitive / Protected Attributes <span class="pill red" style="font-size:9px">REQUIRED</span></div>
          <div class="sg-sub">Demographic columns to audit for bias — gender, race, age, etc. Select all that apply.</div>
          <div style="padding:12px 0">
            ${multiChips(allCols.filter(c => c !== data.outcome_col && !ids.includes(c)),
                new Set(Object.keys(sens)), "sensitive")}
          </div>
        </div>

        <!-- Numeric feature columns -->
        <div class="settings-group">
          <div class="sg-title">Numeric Feature Columns</div>
          <div class="sg-sub">Score/measurement columns used as model inputs — resume scores, test scores, years of experience, etc.</div>
          <div style="padding:12px 0">
            ${multiChips(allCols.filter(c => c !== data.outcome_col && !ids.includes(c) && !Object.keys(sens).includes(c)),
                new Set(num), "numeric")}
          </div>
        </div>

        <!-- ID columns (skip) -->
        ${ids.length ? `
        <div class="settings-group" style="opacity:0.6">
          <div class="sg-title">ID Columns (skipped)</div>
          <div class="sg-sub">These will not be used in analysis: ${ids.join(", ")}</div>
        </div>` : ""}

        <div class="btn-row" style="margin-top:20px">
          <button class="btn btn-primary" id="confirm-config-btn">
            ✓ Confirm & Run Analysis
          </button>
          <span style="font-size:12px;color:var(--t3);align-self:center">
            This will train a real ML model on your data
          </span>
        </div>
        <div id="train-status" style="margin-top:16px"></div>
      </div>`;

    document.getElementById("confirm-config-btn").addEventListener("click",
      () => this._confirmAndTrain());
  },

  _onChipChange(checkbox) {
    const label = checkbox.closest("label");
    const checked = checkbox.checked;
    label.style.borderColor  = checked ? "var(--purple)" : "var(--b2)";
    label.style.background   = checked ? "var(--pbg)"   : "transparent";
    label.style.color        = checked ? "var(--purple)" : "var(--t3)";
  },

  _getConfigFromUI() {
    const outCol = document.getElementById("cfg-outcome").value;
    const sens   = [...document.querySelectorAll('input[name="sensitive"]:checked')].map(e => e.value);
    const num    = [...document.querySelectorAll('input[name="numeric"]:checked')].map(e => e.value);
    return { outcome_col: outCol, sensitive_cols: sens, numeric_cols: num };
  },

  async _confirmAndTrain() {
    const cfg     = this._getConfigFromUI();
    const trainEl = document.getElementById("train-status");

    if (!cfg.outcome_col) {
      App.notify("Select an outcome column first", "error"); return;
    }
    if (!cfg.sensitive_cols.length) {
      App.notify("Select at least one sensitive attribute", "error"); return;
    }

    trainEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Applying column configuration…</div>`;

    try {
      // Apply config overrides
      const cfgResult = await API.configure(cfg);
      App.datasetMeta = cfgResult;

      trainEl.innerHTML = `<div class="loading-row"><div class="spinner"></div> Training model on your data — this takes 10–20 seconds…</div>`;

      const trainResult = await API.train();
      App.modelTrained = true;
      App.trainResult  = trainResult;

      trainEl.innerHTML = `
        <div class="banner low">
          <span class="blabel">✓ MODEL TRAINED</span>
          <span class="btext">
            <strong>${trainResult.model_type}</strong> ·
            Accuracy: <strong>${(trainResult.accuracy*100).toFixed(1)}%</strong> ·
            AUC: <strong>${trainResult.auc}</strong> ·
            CV-AUC: <strong>${trainResult.cv_auc_mean} ± ${trainResult.cv_auc_std}</strong> ·
            Outcome column: <strong>${trainResult.outcome_col}</strong> ·
            Features used: <strong>${trainResult.feature_cols?.join(", ")}</strong>
          </span>
        </div>`;

      App.unlockAll();
      App.setStatus("Ready", "live");
      App.log("model", "Model trained",
        `Acc ${(trainResult.accuracy*100).toFixed(1)}% · AUC ${trainResult.auc} · ` +
        `Outcome: ${trainResult.outcome_col}`, "#4ade80");
      App.notify("✅ Model trained — all analysis panels unlocked", "success");
      setTimeout(() => App.go("overview"), 1200);

    } catch (e) {
      trainEl.innerHTML = `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    }
  },
};

window.UploadPanel = UploadPanel;
