/**
 * firebase.js — Account & History panel.
 * Firebase Auth + Firestore. No Storage (free plan).
 */

const FirebasePanel = {
  _user: null,

  render() {
    return `
    <div class="panel" id="panel-firebase">
      <div class="page-hd">
        <div class="page-title">Account & History</div>
        <div class="page-sub">Sign in to save your audit history automatically after each report.</div>
      </div>

      <div id="fb-setup-warn" style="display:none">
        <div class="banner medium">
          <span class="blabel">SETUP NEEDED</span>
          <span class="btext">Firebase is not configured on the backend.</span>
        </div>
      </div>

      <div class="sec">
        <div class="sec-title">Account</div>
        <div id="fb-logged-out">
          <div class="settings-group">
            <div class="sg-title">Sign in to save audits</div>
            <div class="sg-sub">Your audit history is saved automatically after each report run.</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-width:340px;margin-top:12px">
              <input class="search-box" style="width:100%" type="email"
                     id="fb-email" placeholder="your@email.com"/>
              <input class="search-box" style="width:100%" type="password"
                     id="fb-password" placeholder="Password"/>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary" style="flex:1"
                        onclick="FirebasePanel.login()">Sign in</button>
                <button class="btn btn-outline" style="flex:1"
                        onclick="FirebasePanel.register()">Register</button>
              </div>
              <div id="fb-auth-error"
                   style="font-size:12px;color:var(--red);display:none"></div>
            </div>
          </div>
        </div>

        <div id="fb-logged-in" style="display:none">
          <div class="settings-group">
            <div class="sg-row">
              <div>
                <div class="sg-label" id="fb-user-email"></div>
                <div class="sg-hint">Signed in — audits saved automatically to Firestore</div>
              </div>
              <button class="btn btn-outline"
                      onclick="FirebasePanel.logout()">Sign out</button>
            </div>
          </div>
        </div>
      </div>

      <div class="sec">
        <div class="sec-title">Audit History</div>
        <div class="sec-sub">Your past audit runs — click View to see findings</div>
        <div id="fb-history-list">
          <div class="empty">
            <div class="empty-ico">📋</div>
            <div class="empty-title">Sign in to see history</div>
            <div class="empty-sub">Audits save automatically after each report run</div>
          </div>
        </div>
        <button class="btn btn-outline" id="fb-refresh-btn"
                style="display:none;margin-top:10px"
                onclick="FirebasePanel._loadHistory()">
          Refresh history
        </button>
      </div>
    </div>`;
  },

  async load() {
    try {
      const h = await API.health();
      if (!h.firebase_enabled) {
        document.getElementById("fb-setup-warn").style.display = "block";
        return;
      }
    } catch (e) { return; }

    if (API._token && this._user) {
      this._showLoggedIn();
      await this._loadHistory();
    }
  },

  async login() {
    const email    = document.getElementById("fb-email").value.trim();
    const password = document.getElementById("fb-password").value;
    const errEl    = document.getElementById("fb-auth-error");
    errEl.style.display = "none";

    if (!email || !password) {
      errEl.textContent   = "Enter email and password";
      errEl.style.display = "block";
      return;
    }
    try {
      const cred  = await firebase.auth()
        .signInWithEmailAndPassword(email, password);
      const token = await cred.user.getIdToken();
      this._onLogin(cred.user, token);
    } catch (e) {
      errEl.textContent   = e.message;
      errEl.style.display = "block";
    }
  },

  async register() {
    const email    = document.getElementById("fb-email").value.trim();
    const password = document.getElementById("fb-password").value;
    const errEl    = document.getElementById("fb-auth-error");
    errEl.style.display = "none";

    if (!email || !password) {
      errEl.textContent   = "Enter email and password";
      errEl.style.display = "block";
      return;
    }
    if (password.length < 6) {
      errEl.textContent   = "Password must be at least 6 characters";
      errEl.style.display = "block";
      return;
    }
    try {
      const cred  = await firebase.auth()
        .createUserWithEmailAndPassword(email, password);
      const token = await cred.user.getIdToken();
      this._onLogin(cred.user, token);
      App.notify("Account created and signed in", "success");
    } catch (e) {
      errEl.textContent   = e.message;
      errEl.style.display = "block";
    }
  },

  async logout() {
    await firebase.auth().signOut();
    API._token = null;
    this._user = null;
    document.getElementById("fb-logged-out").style.display = "block";
    document.getElementById("fb-logged-in").style.display  = "none";
    document.getElementById("fb-refresh-btn").style.display= "none";
    document.getElementById("fb-history-list").innerHTML   =
      `<div class="empty"><div class="empty-ico">📋</div>
       <div class="empty-title">Signed out</div></div>`;
    App.notify("Signed out", "success");
  },

  async _onLogin(user, token) {
    this._user  = user;
    API._token  = token;
    this._showLoggedIn();
    await this._loadHistory();
    App.notify(`Signed in as ${user.email}`, "success");
    App.log("firebase", "Signed in", user.email, "#4ade80");
  },

  _showLoggedIn() {
    document.getElementById("fb-logged-out").style.display  = "none";
    document.getElementById("fb-logged-in").style.display   = "block";
    document.getElementById("fb-refresh-btn").style.display = "block";
    document.getElementById("fb-user-email").textContent    =
      this._user?.email || "Signed in";
  },

  async _loadHistory() {
    const el = document.getElementById("fb-history-list");
    el.innerHTML = `<div class="loading-row">
      <div class="spinner"></div> Loading history…</div>`;

    // Always refresh token before calling protected endpoint
    if (this._user) {
      try {
        API._token = await this._user.getIdToken(true);
      } catch (e) { }
    }

    try {
      const data    = await API._fetch("/firebase/history");
      const history = data.history || [];

      if (!history.length) {
        el.innerHTML = `
          <div class="banner info">
            <span class="blabel">EMPTY</span>
            <span class="btext">
              No audits saved yet. Go to Audit Report panel and run a report —
              it will save automatically here.
            </span>
          </div>`;
        return;
      }

      el.innerHTML = `<div class="tbl-wrap"><table class="tbl">
        <thead>
          <tr>
            <th>Date</th><th>Records</th><th>Bias Score</th>
            <th>Level</th><th>Findings</th><th></th>
          </tr>
        </thead>
        <tbody>
        ${history.map(a => {
          const ts    = new Date(a.timestamp).toLocaleDateString("en-GB");
          const score = a.bias_score?.score ?? "—";
          const level = a.bias_score?.level ?? "—";
          const nf    = (a.findings || []).length;
          const cls   = score > 60 ? "red" : score > 30 ? "amber" : "green";
          return `<tr>
            <td style="font-family:var(--fm);font-size:11px;color:var(--t3)">${ts}</td>
            <td style="font-family:var(--fm)">${(a.n_rows||0).toLocaleString()}</td>
            <td style="font-family:var(--fm)">${score}/100</td>
            <td><span class="pill ${cls}">${level}</span></td>
            <td style="font-family:var(--fm)">${nf}</td>
            <td>
              <button class="btn btn-outline"
                      style="font-size:11px;padding:4px 8px"
                      onclick="FirebasePanel.loadAudit('${a.id}')">
                View
              </button>
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`;

    } catch (e) {
      if (e.message.includes("index") || e.message.includes("FAILED_PRECONDITION")) {
        el.innerHTML = `
          <div class="banner medium">
            <span class="blabel">INDEX NEEDED</span>
            <span class="btext">
              Firestore needs a composite index. Check the backend terminal
              for a link — click it to create the index, then refresh.
            </span>
          </div>`;
      } else if (e.message.includes("Not logged in")) {
        el.innerHTML = `
          <div class="banner medium">
            <span class="blabel">SESSION EXPIRED</span>
            <span class="btext">Please sign out and sign in again.</span>
          </div>`;
      } else {
        el.innerHTML = `
          <div class="banner high">
            <span class="blabel">ERROR</span>
            <span class="btext">${e.message}</span>
          </div>`;
      }
    }
  },

  async loadAudit(auditId) {
    try {
      const data = await API._fetch(`/firebase/audit/${auditId}`);
      const ts   = new Date(data.audit.timestamp).toLocaleDateString();
      App.notify(`Loaded audit from ${ts}`, "success");
      App.log("firebase", "Audit loaded", `ID: ${auditId}`, "#60a5fa");
      App.go("report");
    } catch (e) {
      App.notify(`Failed to load: ${e.message}`, "error");
    }
  },
};

window.FirebasePanel = FirebasePanel;