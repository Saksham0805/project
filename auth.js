/* Campus Radar - email OTP login + bookmark sync.
   Add before </body>:  <script src="auth.js"></script>
   Optional: put data-auth-btn on any button/link to use it as the Login button. */
(function () {
  const API = 'http://localhost:3000/api';
  const KEY = 'cr_token', MAIL = 'cr_email';

  const css = `
  .cr-ov{position:fixed;inset:0;background:rgba(20,18,40,.55);display:none;align-items:center;justify-content:center;z-index:9999;padding:16px}
  .cr-ov.open{display:flex}
  .cr-box{background:#fff;border-radius:20px;padding:28px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(60,40,160,.25);font-family:inherit}
  .cr-box h3{margin:0 0 6px;font-size:22px;color:#1e1b3a}
  .cr-box p{margin:0 0 16px;color:#6b6a80;font-size:14px}
  .cr-box input{width:100%;box-sizing:border-box;padding:13px 14px;border:1.5px solid #dcd8f5;border-radius:10px;font-size:16px;outline:none;margin-bottom:12px}
  .cr-box input:focus{border-color:#6c4fe6}
  .cr-otp{letter-spacing:10px;text-align:center;font-size:22px!important;font-weight:700}
  .cr-btn{width:100%;padding:13px;border:0;border-radius:10px;background:#6c4fe6;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  .cr-btn:disabled{opacity:.6;cursor:wait}
  .cr-link{background:none;border:0;color:#6c4fe6;cursor:pointer;font-size:13px;margin-top:10px;padding:0}
  .cr-err{color:#d93a3a;font-size:13px;min-height:18px;margin-bottom:6px}
  .cr-x{float:right;background:none;border:0;font-size:22px;cursor:pointer;color:#999}
  .cr-float{position:fixed;right:18px;bottom:18px;z-index:9998;padding:11px 18px;border:0;border-radius:999px;background:#6c4fe6;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(108,79,230,.4)}
  .cr-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#1e1b3a;color:#fff;padding:10px 18px;border-radius:10px;z-index:10000;font-size:14px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const ov = document.createElement('div');
  ov.className = 'cr-ov';
  ov.innerHTML = `
    <div class="cr-box">
      <button class="cr-x" aria-label="Close">&times;</button>
      <div id="cr-s1">
        <h3>Login to Campus Radar</h3>
        <p>We'll email you a 6-digit code. No password needed.</p>
        <input id="cr-email" type="email" placeholder="you@college.edu" autocomplete="email">
        <div class="cr-err" id="cr-e1"></div>
        <button class="cr-btn" id="cr-send">Send OTP</button>
      </div>
      <div id="cr-s2" style="display:none">
        <h3>Enter OTP</h3>
        <p id="cr-sub"></p>
        <input id="cr-otp" class="cr-otp" inputmode="numeric" maxlength="6" placeholder="------" autocomplete="one-time-code">
        <div class="cr-err" id="cr-e2"></div>
        <button class="cr-btn" id="cr-verify">Verify &amp; Login</button>
        <button class="cr-link" id="cr-back">Change email / resend</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const $ = (id) => document.getElementById(id);
  const toast = (m) => { const t = document.createElement('div'); t.className = 'cr-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); };
  const open = () => { ov.classList.add('open'); $('cr-s1').style.display = ''; $('cr-s2').style.display = 'none'; $('cr-email').focus(); };
  const close = () => ov.classList.remove('open');
  ov.querySelector('.cr-x').onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  async function call(path, opts = {}) {
    const token = localStorage.getItem(KEY);
    const res = await fetch(API + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) logout(true);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  let pendingEmail = '';
  $('cr-send').onclick = async () => {
    const email = $('cr-email').value.trim().toLowerCase();
    $('cr-e1').textContent = '';
    if (!email) return ($('cr-e1').textContent = 'Enter your email');
    $('cr-send').disabled = true;
    try {
      await call('/auth/request-otp', { method: 'POST', body: JSON.stringify({ email }) });
      pendingEmail = email;
      $('cr-sub').textContent = 'Code sent to ' + email;
      $('cr-s1').style.display = 'none'; $('cr-s2').style.display = ''; $('cr-otp').value = ''; $('cr-otp').focus();
    } catch (e) { $('cr-e1').textContent = e.message; }
    $('cr-send').disabled = false;
  };
  $('cr-email').addEventListener('keydown', (e) => e.key === 'Enter' && $('cr-send').click());
  $('cr-otp').addEventListener('keydown', (e) => e.key === 'Enter' && $('cr-verify').click());
  $('cr-back').onclick = () => { $('cr-s2').style.display = 'none'; $('cr-s1').style.display = ''; };

  $('cr-verify').onclick = async () => {
    $('cr-e2').textContent = '';
    $('cr-verify').disabled = true;
    try {
      const d = await call('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: pendingEmail, otp: $('cr-otp').value.trim() }) });
      localStorage.setItem(KEY, d.token); localStorage.setItem(MAIL, d.email);
      close(); updateBtn(); toast('Logged in as ' + d.email);
      document.dispatchEvent(new CustomEvent('cr:login', { detail: { email: d.email } }));
      pushLocalSaved();
    } catch (e) { $('cr-e2').textContent = e.message; }
    $('cr-verify').disabled = false;
  };

  function logout(silent) {
    localStorage.removeItem(KEY); localStorage.removeItem(MAIL);
    updateBtn(); if (!silent) toast('Logged out');
    document.dispatchEvent(new CustomEvent('cr:logout'));
  }

  /* Login button */
  let btn = document.querySelector('[data-auth-btn]');
  if (!btn) { btn = document.createElement('button'); btn.className = 'cr-float'; document.body.appendChild(btn); }
  function updateBtn() {
    const email = localStorage.getItem(MAIL);
    btn.textContent = email ? 'Logout (' + email.split('@')[0] + ')' : 'Login';
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); localStorage.getItem(KEY) ? logout() : open(); });
  updateBtn();

  /* Bookmark sync.
     h = { id, title, deadline: '2026-12-05' (or ISO), url } */
  const isLoggedIn = () => !!localStorage.getItem(KEY);

  async function syncBookmark(h, isSaved) {
    if (!isLoggedIn()) { toast('Login to get deadline reminders'); open(); return false; }
    try {
      if (isSaved) {
        await call('/bookmarks', { method: 'POST', body: JSON.stringify({ hackathonId: h.id, title: h.title, deadline: h.deadline, url: h.url }) });
        toast('Saved. We\'ll email you before the deadline.');
      } else {
        await call('/bookmarks/' + encodeURIComponent(h.id), { method: 'DELETE' });
      }
      return true;
    } catch (e) { toast(e.message); return false; }
  }

  /* After login, push anything the user saved while logged out.
     Expects window.CR_getLocalSaved() -> array of {id,title,deadline,url}  (optional) */
  async function pushLocalSaved() {
    if (typeof window.CR_getLocalSaved !== 'function') return;
    for (const h of window.CR_getLocalSaved() || []) {
      try { await call('/bookmarks', { method: 'POST', body: JSON.stringify({ hackathonId: h.id, title: h.title, deadline: h.deadline, url: h.url }) }); } catch {}
    }
  }

  window.CampusAuth = { open, logout, isLoggedIn, syncBookmark, email: () => localStorage.getItem(MAIL) };
})();
