/**
 * charts.js — All Chart.js wrappers.
 * Panels import these instead of writing Chart.js inline.
 */

const CHART_COLORS = [
  "#9d8df8","#f87171","#60a5fa","#4ade80",
  "#fbbf24","#f472b6","#34d399","#fb923c","#a78bfa",
];

const _charts = {};

function _destroy(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function _baseOpts(opts = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: opts.legend || false },
      tooltip: {
        callbacks: {
          label: (c) => {
            if (opts.pct)   return (c.parsed.y * 100).toFixed(1) + "%";
            if (opts.count) return c.parsed.y.toFixed(0);
            return c.parsed.y.toFixed(3);
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: opts.max,
        ticks: {
          callback: (v) => opts.pct ? (v * 100).toFixed(0) + "%" : v,
          color: "#6a6a7e",
          font: { size: 10 },
        },
        grid: { color: "rgba(255,255,255,0.04)" },
        border: { color: "var(--b1)" },
      },
      x: {
        ticks: { color: "#a8a8b8", font: { size: 10 }, maxRotation: opts.rotate || 0 },
        grid: { display: false },
        border: { color: "var(--b1)" },
      },
    },
  };
}

/** Grouped bar chart */
function barChart(canvasId, labels, datasets, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  _charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: _baseOpts(opts),
  });
  return _charts[canvasId];
}

/** Horizontal bar chart */
function hbarChart(canvasId, labels, data, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  _charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: data.map((v, i) =>
          opts.colorFn ? opts.colorFn(v, i) : CHART_COLORS[i % CHART_COLORS.length]
        ),
        borderRadius: 4,
      }],
    },
    options: {
      ...(_baseOpts(opts)),
      indexAxis: "y",
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: "#6a6a7e", font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          ticks: { color: "#a8a8b8", font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });
  return _charts[canvasId];
}

/**
 * Hire rate bar — red/amber/green coloring based on 80% rule.
 * @param {string} canvasId
 * @param {{label:string, rate:number}[]} groups
 */
function hireRateBar(canvasId, groups, opts = {}) {
  const labels = groups.map((g) => g.label);
  const rates  = groups.map((g) => g.rate);
  const maxR   = Math.max(...rates);
  const colors = rates.map((r) =>
    r < maxR * 0.8 ? "#f87171" : r < maxR * 0.9 ? "#fbbf24" : "#9d8df8"
  );
  return barChart(
    canvasId, labels,
    [{ label: "Hire Rate", data: rates, backgroundColor: colors, borderRadius: 5 }],
    { pct: true, max: Math.min(1, maxR * 1.4), ...opts }
  );
}

/** Before/after comparison bars */
function beforeAfterBar(canvasId, labels, before, after) {
  return barChart(
    canvasId, labels,
    [
      { label: "Before", data: before, backgroundColor: "#f87171", borderRadius: 4 },
      { label: "After",  data: after,  backgroundColor: "#4ade80", borderRadius: 4 },
    ],
    { legend: true }
  );
}

/** Score histogram */
function histogram(canvasId, byGroup, bins = 10, opts = {}) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const edges  = Array.from({ length: bins + 1 }, (_, i) => i / bins);
  const blabels = edges.slice(0, -1).map((b) => b.toFixed(1));
  const genders = Object.keys(byGroup);

  const datasets = genders.map((g, i) => {
    const vals = byGroup[g];
    const hist = edges.slice(0, -1).map((lo, j) =>
      vals.filter((v) => v >= lo && v < edges[j + 1]).length
    );
    return {
      label: g,
      data: hist,
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      borderRadius: 3,
    };
  });

  _charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels: blabels, datasets },
    options: { ..._baseOpts({ legend: true, count: true }), ...opts },
  });
  return _charts[canvasId];
}

/** Calibration scatter */
function calibrationChart(canvasId, calibrationData) {
  _destroy(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const datasets = Object.entries(calibrationData).map(([g, bins], i) => ({
    label: g,
    data: bins.map((b) => ({ x: b.predicted_mean, y: b.actual_rate })),
    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
    pointRadius: 6,
  }));

  // Diagonal reference line (perfect calibration)
  datasets.push({
    label: "Perfect calibration",
    data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    type: "line",
    borderColor: "rgba(255,255,255,0.2)",
    borderDash: [4, 4],
    pointRadius: 0,
    fill: false,
  });

  _charts[canvasId] = new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: "#a8a8b8", font: { size: 11 } } } },
      scales: {
        x: { min: 0, max: 1, title: { display: true, text: "Predicted score", color: "#6a6a7e" }, ticks: { color: "#6a6a7e" }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { min: 0, max: 1, title: { display: true, text: "Actual hire rate", color: "#6a6a7e" }, ticks: { color: "#6a6a7e" }, grid: { color: "rgba(255,255,255,0.04)" } },
      },
    },
  });
}

window.Charts = { barChart, hbarChart, hireRateBar, beforeAfterBar, histogram, calibrationChart, CHART_COLORS };
