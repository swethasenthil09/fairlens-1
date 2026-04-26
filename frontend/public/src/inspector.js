/**
 * inspector.js — Candidate Inspector.
 * Filter dropdowns built from actual values in the uploaded dataset.
 */

const InspectorPanel = {
  _page:    1,
  _total:   0,
  _columns: [],

  render() {
    return `
    <div class="panel" id="panel-inspector">
      <div class="page-hd">
        <div class="page-title">Candidate Inspector</div>
        <div class="page-sub">Search and filter applicants. Highlighted rows scored above threshold but were not selected.</div>
      </div>
      <div class="inspector-filters">
        <input class="search-box" id="insp-q" placeholder="Search…"/>
        <div id="insp-dynamic-filters" style="display:flex;gap:10px;flex-wrap:wrap"></div>
        <select class="flt-select" id="flt-outcome">
          <option value="">All Outcomes</option>
          <option value="1">Selected</option>
          <option value="0">Not Selected</option>
        </select>
        <button class="btn btn-outline" id="insp-reset">Reset</button>
      </div>
      <div class="insp-count" id="insp-count"></div>
      <div class="tbl-wrap scroll" id="insp-tbl">
        <div class="loading-row"><div class="spinner"></div> Loading records…</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px;align-items:center;">
        <button class="btn btn-outline" id="insp-prev" disabled>← Prev</button>
        <span style="font-family:var(--fm);font-size:11px;color:var(--t3)" id="insp-page-info"></span>
        <button class="btn btn-outline" id="insp-next">Next →</button>
      </div>
      <div class="sec" style="margin-top:28px;">
        <div class="sec-title">Flagged Applicants</div>
        <div class="sec-sub">Applicants who scored above threshold on score columns but were not selected</div>
        <div id="flagged-summary"></div>
      </div>
    </div>`;
  },

  async load() {
    this._page = 1;
    await this._buildFilters();
    this._bindEvents();
    await this._fetch();
    await this._loadFlagged();
  },

  async _buildFilters() {
    const container = document.getElementById("insp-dynamic-filters");
    container.innerHTML = "";

    try {
      // Get actual unique values from the uploaded dataset
      const preview = await API.preview(5000);
      const rows    = preview.rows || [];
      const meta    = App.datasetMeta || {};
      const sensCols= Object.keys(meta.sensitive_cols || {});

      sensCols.slice(0, 4).forEach(col => {
        // Get real unique values from actual data rows
        const uniqueVals = [...new Set(
          rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "")
        )].sort();

        if (!uniqueVals.length) return;

        const label = col.replace(/_/g, " ")
          .split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

        const sel = document.createElement("select");
        sel.className   = "flt-select";
        sel.dataset.col = col;
        sel.innerHTML   = `<option value="">All ${label}</option>` +
          uniqueVals.map(v => `<option value="${v}">${v}</option>`).join("");
        sel.addEventListener("change", () => { this._page = 1; this._fetch(); });
        container.appendChild(sel);
      });
    } catch (e) {
      console.error("Filter build error:", e);
    }
  },

  _bindEvents() {
    let t;
    const q = document.getElementById("insp-q");
    if (q) q.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { this._page = 1; this._fetch(); }, 400);
    });

    document.getElementById("flt-outcome")
      .addEventListener("change", () => { this._page = 1; this._fetch(); });

    document.getElementById("insp-prev")
      .addEventListener("click", () => {
        if (this._page > 1) { this._page--; this._fetch(); }
      });

    document.getElementById("insp-next")
      .addEventListener("click", () => {
        if (this._page * 50 < this._total) { this._page++; this._fetch(); }
      });

    document.getElementById("insp-reset")
      .addEventListener("click", () => {
        document.getElementById("insp-q").value      = "";
        document.getElementById("flt-outcome").value = "";
        document.querySelectorAll("#insp-dynamic-filters select")
          .forEach(s => s.value = "");
        this._page = 1;
        this._fetch();
      });
  },

  _getFilters() {
    const f = {};
    document.querySelectorAll("#insp-dynamic-filters select").forEach(sel => {
      if (sel.value) f[sel.dataset.col] = sel.value;
    });
    const outcome = document.getElementById("flt-outcome").value;
    if (outcome) f.outcome = outcome;
    return f;
  },

  async _fetch() {
    try {
      const data    = await API.candidates(this._getFilters(), this._page, 50);
      this._total   = data.total;
      this._columns = data.columns || [];
      this._renderTable(data);
    } catch (e) {
      document.getElementById("insp-tbl").innerHTML =
        `<div class="banner high"><span class="blabel">ERROR</span><span class="btext">${e.message}</span></div>`;
    }
  },

  _renderTable(data) {
    const { rows, total } = data;
    const outcomeCol      = App.datasetMeta?.outcome_col || "hired";

    document.getElementById("insp-count").textContent =
      `Showing ${(this._page-1)*50+1}–${Math.min(this._page*50, total)} of ${total.toLocaleString()} records`;
    document.getElementById("insp-page-info").textContent =
      `Page ${this._page} of ${Math.ceil(total/50)}`;
    document.getElementById("insp-prev").disabled = this._page <= 1;
    document.getElementById("insp-next").disabled = this._page * 50 >= total;

    const skipCols = ["__outcome__"];
    const dispCols = this._columns.filter(c => !skipCols.includes(c)).slice(0, 12);

    if (!rows.length) {
      document.getElementById("insp-tbl").innerHTML =
        `<div class="empty"><div class="empty-ico">🔍</div><div class="empty-title">No matching records</div></div>`;
      return;
    }

    let html = `<table class="tbl"><thead><tr>
      ${dispCols.map(c => `<th>${c.replace(/_/g," ")}</th>`).join("")}
    </tr></thead><tbody>`;

    rows.forEach(r => {
      const outcome = parseInt(r[outcomeCol] ?? r["__outcome__"]);
      // Flag if all score cols above 0.65 but not selected
      const scoreCols = dispCols.filter(c =>
        c.includes("score") || c.includes("gpa") || c.includes("rating"));
      const qualified = scoreCols.length > 0 &&
        scoreCols.every(c => parseFloat(r[c]) >= 0.65);
      const flagged   = qualified && !outcome;

      html += `<tr ${flagged ? 'style="background:rgba(248,113,113,0.06)"' : ""}>`;
      dispCols.forEach(c => {
        const v = r[c] ?? "—";
        if (c === outcomeCol) {
          html += `<td>
            <span class="pill ${outcome ? "green" : "red"}">${outcome ? "Selected" : "Not Selected"}</span>
            ${flagged ? '<span class="pill amber" style="font-size:9px;margin-left:4px">⚠ Flagged</span>' : ""}
          </td>`;
        } else if (c === "model_score") {
          const n = parseFloat(v);
          html += `<td style="font-family:var(--fm);color:var(--purple)">${isNaN(n) ? v : n.toFixed(2)}</td>`;
        } else {
          const n = parseFloat(v);
          const isScore = c.includes("score") || c.includes("gpa");
          if (!isNaN(n) && isScore) {
            const col = n > 0.75 ? "var(--green)" : n < 0.45 ? "var(--red)" : "var(--t2)";
            html += `<td style="font-family:var(--fm);color:${col}">${n.toFixed(2)}</td>`;
          } else {
            html += `<td>${v}</td>`;
          }
        }
      });
      html += "</tr>";
    });

    html += "</tbody></table>";
    document.getElementById("insp-tbl").innerHTML = html;
  },

  async _loadFlagged() {
    const el = document.getElementById("flagged-summary");
    try {
      const data = await API.flagged(0.65);
      if (!data.n_flagged) {
        el.innerHTML = `<div class="banner low"><span class="blabel">CLEAN</span>
          <span class="btext">No flagged applicants at current threshold.</span></div>`;
        return;
      }
      const breakdown = data.group_breakdown || {};
      let html = `
        <div class="banner high" style="margin-bottom:14px">
          <span class="blabel">⚠ ${data.n_flagged} FLAGGED</span>
          <span class="btext">
            ${data.n_flagged} of ${data.n_qualified} qualified applicants were not selected.
            Review these cases manually.
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">`;

      Object.entries(breakdown).slice(0, 4).forEach(([attr, counts]) => {
        html += `<div class="cbox">
          <div class="cbox-title">${attr.replace(/_/g," ").toUpperCase()}</div>
          <table class="tbl"><tbody>
          ${Object.entries(counts).sort((a,b)=>b[1]-a[1])
            .map(([g,n])=>`<tr>
              <td>${g}</td>
              <td style="font-family:var(--fm);color:var(--red)">${n}</td>
            </tr>`).join("")}
          </tbody></table>
        </div>`;
      });
      html += "</div>";
      el.innerHTML = html;
    } catch (e) {
      el.innerHTML = `<div class="banner high"><span class="blabel">ERROR</span>
        <span class="btext">${e.message}</span></div>`;
    }
  },
};

window.InspectorPanel = InspectorPanel;