/**
 * api.js — All backend API calls.
 * Auto-attaches Firebase auth token to every request when available.
 */

const API_BASE = "http://localhost:5050/api";

const API = {
  _token: null,

  async _fetch(path, opts = {}) {
    try {
      // Build headers — always include auth token if we have one
      const headers = { "Content-Type": "application/json" };
      if (this._token) headers["Authorization"] = `Bearer ${this._token}`;
      // Merge any extra headers passed in
      if (opts.headers) Object.assign(headers, opts.headers);

      const res  = await fetch(API_BASE + path, { ...opts, headers });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      console.error(`API [${path}]:`, e.message);
      throw e;
    }
  },

  async health() { return this._fetch("/health"); },

  async upload(file, overrides = {}) {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(overrides).forEach(([k, v]) =>
      fd.append(k, typeof v === "object" ? JSON.stringify(v) : v));
    try {
      const headers = {};
      if (this._token) headers["Authorization"] = `Bearer ${this._token}`;
      const res  = await fetch(API_BASE + "/upload",
        { method: "POST", body: fd, headers });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Upload failed");
      return data;
    } catch (e) { throw e; }
  },

  async configure(overrides) {
    return this._fetch("/configure", {
      method: "POST", body: JSON.stringify(overrides) });
  },

  async stats()          { return this._fetch("/stats"); },
  async preview(n = 100) { return this._fetch(`/preview?n=${n}`); },
  async train()          { return this._fetch("/train", { method: "POST" }); },
  async fairness(attr)   { return this._fetch(`/fairness/${attr}`); },
  async fairnessAll()    { return this._fetch("/fairness"); },
  async proxy()          { return this._fetch("/proxy"); },
  async biasScore()      { return this._fetch("/bias-score"); },
  async report()         { return this._fetch("/report"); },

  async candidates(filters = {}, page = 1, limit = 50) {
    const params = new URLSearchParams({ page, limit, ...filters });
    return this._fetch(`/candidates?${params}`);
  },

  async flagged(threshold = 0.65) {
    return this._fetch(`/flagged?threshold=${threshold}`);
  },

  async mitigate(strategies, sensCol) {
    return this._fetch("/mitigate", {
      method: "POST",
      body:   JSON.stringify({ strategies, sensitive_col: sensCol }),
    });
  },
};

window.API = API;