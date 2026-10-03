/* Fuse 訓練追蹤模組 — 教練版（Fuse Coach）同愛好者版（Fuse Fit）共用
 *
 * 版本由網址決定（?edition=coach | fit，由 coach.html / fit.html 轉入；冇指定就係教練版）。
 * 提供：版本品牌／導覽調整、訓練日誌（組數×次數×重量×RPE、1RM估算、PR）、
 * 身體數據追蹤、組間休息／間歇計時器。資料經 window.storage（localStorage 後備）儲存，
 * key 以 fuse: 開頭，所以會自動包含喺「匯出備份」入面。
 *   教練版：資料跟住「目前揀咗嘅客戶」；愛好者版：資料屬於固定嘅「我」(id = 'me')。
 */
(function () {
  'use strict';
  var ED = window.FUSE_EDITION === 'fit' ? 'fit' : 'coach';
  var EDITIONS = {
    coach: { name: 'FUSE COACH', zh: '教練版', sub: 'PRI-BASED POSTURAL ASSESSMENT SYSTEM', other: 'fit', otherLabel: '切換去愛好者版 Fuse Fit' },
    fit:   { name: 'FUSE FIT',   zh: '愛好者版', sub: '體態評估 × 訓練追蹤', other: 'coach', otherLabel: '切換去教練版 Fuse Coach' }
  };
  var HIDDEN = window.FUSE_HIDDEN_RAILS || [];

  // ───────────────────────── 小工具 ─────────────────────────
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmt(n) { n = Math.round(n * 10) / 10; return String(n); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function shortDate(iso) { return iso ? iso.slice(5) : ''; }
  function toast(m) { if (typeof window.showToast === 'function') window.showToast(m); }
  function normName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  var S = {
    get: function (k) { return window.storage.get(k).then(function (r) { return r ? JSON.parse(r.value) : null; }).catch(function () { return null; }); },
    set: function (k, v) { return window.storage.set(k, JSON.stringify(v)).then(function () { return true; }).catch(function (e) { console.error('storage set failed', k, e); toast('儲存失敗（瀏覽器儲存空間可能不足），請先匯出備份'); return false; }); },
    del: function (k) { return window.storage.delete(k).catch(function () {}); }
  };
  var KEY = {
    log: function (id) { return 'fuse:log:' + id; },
    body: function (id) { return 'fuse:body:' + id; },
    draft: function (id) { return 'fuse:draft:' + id; }
  };
  window.trkDeleteSubjectData = function (id) { return Promise.all([S.del(KEY.log(id)), S.del(KEY.body(id)), S.del(KEY.draft(id))]); };

  function subject() {
    if (ED === 'fit') return { id: 'me', name: '我' };
    var id = (typeof activeClientId !== 'undefined') ? activeClientId : null;
    if (!id) return null;
    var c = (typeof clientIndex !== 'undefined') ? clientIndex.find(function (x) { return x.id === id; }) : null;
    return { id: id, name: c ? c.name : id };
  }

  function shareText(text) {
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    var w = window.open(url, '_blank');
    if (!w && navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { toast('已複製內容，可貼上分享'); }); }
  }
  window.fuseShareText = shareText;

  // ───────────────────────── 樣式 ─────────────────────────
  var css = '' +
    '#rail-tlog.rail-panel,#rail-tbody.rail-panel,#rail-ttimer.rail-panel{max-width:560px}' +
    '.trk-wrap{display:flex;flex-direction:column;gap:10px;min-width:0}' +
    '.trk-h{font-family:var(--mono);font-size:10px;letter-spacing:2px;color:var(--sub);padding:2px 0 6px;border-bottom:1px solid var(--border)}' +
    '.trk-card{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:10px;min-width:0}' +
    '.trk-card.pr{border-color:rgba(251,191,36,.5)}' +
    '.trk-row{display:flex;gap:6px;align-items:center;min-width:0}' +
    '.trk-grow{flex:1;min-width:0}' +
    '.trk-in{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:5px;color:var(--text);font-family:var(--mono);font-size:16px;padding:7px 8px;outline:none;min-width:0}' +
    '.trk-in:focus{border-color:var(--green)}' +
    '.trk-btn{font-family:var(--mono);font-size:11px;padding:8px 10px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text);cursor:pointer;white-space:nowrap;min-height:36px}' +
    '.trk-btn.primary{background:rgba(0,229,160,.14);border-color:rgba(0,229,160,.45);color:var(--green)}' +
    '.trk-btn.warn{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.35);color:#f87171}' +
    '.trk-btn.blue{background:rgba(96,165,250,.1);border-color:rgba(96,165,250,.4);color:#60a5fa}' +
    '.trk-btn.small{padding:4px 8px;font-size:10px;min-height:28px}' +
    '.trk-btn.on{background:rgba(0,229,160,.2);border-color:var(--green);color:var(--green)}' +
    '.trk-sets{display:grid;grid-template-columns:24px minmax(0,1.2fr) minmax(0,1fr) minmax(0,.8fr) 34px 26px;gap:5px;align-items:center;margin-top:6px}' +
    '.trk-sets .hd{font-family:var(--mono);font-size:9px;color:var(--sub);text-align:center}' +
    '.trk-sets .n{font-family:var(--mono);font-size:11px;color:var(--sub);text-align:center}' +
    '.trk-sets .tick{height:34px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--sub);cursor:pointer;font-size:14px}' +
    '.trk-sets .tick.done{background:rgba(0,229,160,.2);border-color:var(--green);color:var(--green)}' +
    '.trk-sets .x{background:none;border:none;color:var(--sub);cursor:pointer;font-size:13px}' +
    '.trk-hint{font-family:var(--mono);font-size:10px;color:var(--sub);line-height:1.6;margin-top:4px}' +
    '.trk-pr{display:inline-block;font-family:var(--mono);font-size:9px;padding:1px 6px;border-radius:9px;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.5);color:#fbbf24;margin-left:4px}' +
    '.trk-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}' +
    '.trk-stat{text-align:center;padding:8px 4px;border:1px solid var(--border);border-radius:7px;background:rgba(255,255,255,.02)}' +
    '.trk-stat b{display:block;font-family:var(--mono);font-size:16px;color:var(--green)}' +
    '.trk-stat span{font-family:var(--mono);font-size:9px;color:var(--sub)}' +
    '.trk-empty{font-family:var(--mono);font-size:11px;color:var(--sub);text-align:center;padding:14px 6px;line-height:1.7}' +
    '.trk-sess{border:1px solid var(--border);border-radius:7px;background:rgba(255,255,255,.02);overflow:hidden}' +
    '.trk-sess .top{display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer}' +
    '.trk-sess .det{padding:0 10px 10px;font-size:12px;color:#9aa3b5;line-height:1.7}' +
    '.trk-chips{display:flex;flex-wrap:wrap;gap:5px}' +
    '.trk-chart{width:100%;height:auto;display:block}' +
    '.trk-time{font-family:var(--mono);font-size:56px;text-align:center;color:var(--text);letter-spacing:2px;line-height:1.1;padding:10px 0}' +
    '.trk-time.work{color:var(--green)}.trk-time.rest{color:#60a5fa}.trk-time.done{color:#fbbf24}' +
    '.trk-phase{font-family:var(--mono);font-size:12px;letter-spacing:2px;text-align:center;color:var(--sub);min-height:18px}' +
    '.trk-seg{display:flex;gap:6px}.trk-seg .trk-btn{flex:1}' +
    '.trk-flash{animation:trkflash .5s 3}@keyframes trkflash{50%{background:rgba(251,191,36,.18)}}' +
    '#trk-chip{position:fixed;top:10px;right:10px;z-index:160;display:none;font-family:var(--mono);font-size:13px;padding:7px 12px;border-radius:18px;background:rgba(19,22,29,.95);border:1px solid var(--green);color:var(--green);cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
    '#trk-chip.rest{border-color:#60a5fa;color:#60a5fa}' +
    '.trk-edition{font-family:var(--mono);font-size:9px;letter-spacing:1px;color:var(--sub);margin-top:4px}' +
    '.trk-edition a{color:#60a5fa;text-decoration:none}' +
    '@media (max-width:900px){#trk-chip{top:auto;bottom:calc(64px + env(safe-area-inset-bottom));right:10px}.trk-time{font-size:64px}}';
  var st = document.createElement('style'); st.id = 'trk-css'; st.textContent = css; document.head.appendChild(st);

  // ───────────────────────── 圖表 ─────────────────────────
  function lineChart(pts, unit) {
    if (!pts.length) return '<div class="trk-empty">未有數據</div>';
    var W = 320, H = 150, pl = 34, pr = 10, pt = 12, pb = 24;
    var ys = pts.map(function (p) { return p.y; });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    if (min === max) { min -= 1; max += 1; }
    var padv = (max - min) * 0.15; min -= padv; max += padv;
    var xs = pts.map(function (p, i) { return pts.length === 1 ? pl + (W - pl - pr) / 2 : pl + (W - pl - pr) * i / (pts.length - 1); });
    function yv(v) { return pt + (H - pt - pb) * (1 - (v - min) / (max - min)); }
    var path = xs.map(function (x, i) { return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yv(ys[i]).toFixed(1); }).join(' ');
    var grid = '';
    for (var g = 0; g <= 2; g++) {
      var v = min + (max - min) * g / 2, y = yv(v);
      grid += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#2a3040" stroke-width="1"/>' +
        '<text x="' + (pl - 4) + '" y="' + (y + 3).toFixed(1) + '" fill="#9aa3b5" font-size="9" text-anchor="end" font-family="monospace">' + fmt(v) + '</text>';
    }
    var dots = pts.map(function (p, i) { return '<circle cx="' + xs[i].toFixed(1) + '" cy="' + yv(p.y).toFixed(1) + '" r="3.5" fill="#00e5a0"><title>' + esc(p.x) + '：' + fmt(p.y) + (unit || '') + '</title></circle>'; }).join('');
    var xl = '<text x="' + xs[0].toFixed(1) + '" y="' + (H - 6) + '" fill="#9aa3b5" font-size="9" text-anchor="' + (pts.length === 1 ? 'middle' : 'start') + '" font-family="monospace">' + esc(shortDate(pts[0].x)) + '</text>' +
      (pts.length > 1 ? '<text x="' + xs[xs.length - 1].toFixed(1) + '" y="' + (H - 6) + '" fill="#9aa3b5" font-size="9" text-anchor="end" font-family="monospace">' + esc(shortDate(pts[pts.length - 1].x)) + '</text>' : '');
    return '<svg class="trk-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="趨勢圖">' + grid +
      '<path d="' + path + '" fill="none" stroke="#00e5a0" stroke-width="2" stroke-linejoin="round"/>' + dots + xl + '</svg>';
  }

  // ───────────────────────── 版本品牌＋導覽 ─────────────────────────
  var NAV_HTML =
    '<button class="rail-group-header" data-group="track" onclick="toggleRailGroup(\'track\')" title="訓練追蹤">' +
      '<span class="rail-icon">📈</span><span class="rail-label">追蹤</span><span class="rail-group-caret">▾</span></button>' +
    '<div class="rail-group-buttons" data-group-buttons="track">' +
      '<button class="rail-btn" data-rail="tlog" title="訓練日誌 · 組數/重量/RPE/PR"><span class="rail-icon">🏋️</span><span class="rail-label">訓練</span></button>' +
      '<button class="rail-btn" data-rail="tbody" title="身體數據 · 體重/體脂/圍度"><span class="rail-icon">⚖️</span><span class="rail-label">身體</span></button>' +
      '<button class="rail-btn" data-rail="ttimer" title="計時器 · 組間休息/Tabata/EMOM"><span class="rail-icon">⏱</span><span class="rail-label">計時</span></button>' +
    '</div>';

  function applyEdition() {
    var e = EDITIONS[ED];
    var h1 = $('.logo h1'), p = $('.logo p');
    if (h1) h1.textContent = e.name;
    if (p) p.innerHTML = esc(e.zh) + ' · ' + esc(e.sub) + '<div class="trk-edition"><a href="?edition=' + e.other + '">⇄ ' + esc(e.otherLabel) + '</a></div>';
    document.title = 'Fuse ' + (ED === 'fit' ? 'Fit 愛好者版' : 'Coach 教練版') + ' — ' + (ED === 'fit' ? '體態評估 × 訓練追蹤' : 'PRI 全身評估系統');

    var nav = $('#rail-nav');
    if (nav && !$('[data-group="track"]', nav)) {
      var tmp = document.createElement('div'); tmp.innerHTML = NAV_HTML;
      var kids = Array.prototype.slice.call(tmp.children);
      var anchor = ED === 'fit' ? nav.firstElementChild : $('.rail-group-header[data-group="client"]', nav);
      kids.forEach(function (k) { nav.insertBefore(k, anchor); });
      ['tlog', 'tbody', 'ttimer'].forEach(function (r) {
        var b = $('.rail-btn[data-rail="' + r + '"]', nav);
        if (b) b.addEventListener('click', function () { window.switchRail(r); });
      });
      if (typeof RAIL_GROUP_OF !== 'undefined') { RAIL_GROUP_OF.tlog = 'track'; RAIL_GROUP_OF.tbody = 'track'; RAIL_GROUP_OF.ttimer = 'track'; }
    }
    // 隱藏呢個版本唔需要嘅頁面，同埋變成空嘅分組
    HIDDEN.forEach(function (r) { var b = $('.rail-btn[data-rail="' + r + '"]'); if (b) b.style.display = 'none'; });
    Array.prototype.forEach.call(document.querySelectorAll('.rail-group-buttons'), function (g) {
      var vis = Array.prototype.some.call(g.querySelectorAll('.rail-btn'), function (b) { return b.style.display !== 'none'; });
      if (!vis) {
        g.style.display = 'none';
        var hd = $('.rail-group-header[data-group="' + g.getAttribute('data-group-buttons') + '"]'); if (hd) hd.style.display = 'none';
      }
    });
    if (ED === 'fit') {
      var bar = $('#active-client-bar');
      if (bar) { var lab = bar.querySelector('div > div'); if (lab) lab.textContent = '我嘅檔案 MY PROFILE'; }
    }
  }

  // ───────────────────────── 面板骨架 ─────────────────────────
  function mkPanel(id, title, sub, bodyId) {
    var wrap = $('#rail-panels-wrap'); if (!wrap || $('#rail-' + id)) return;
    var d = document.createElement('div'); d.className = 'rail-panel'; d.id = 'rail-' + id;
    d.innerHTML = '<div class="trk-wrap"><div class="trk-h">' + title + '</div>' +
      (sub ? '<div style="font-size:11px;color:#9aa3b5;line-height:1.6;margin-top:-2px">' + sub + '</div>' : '') +
      '<div id="' + bodyId + '" class="trk-wrap"></div></div>';
    wrap.appendChild(d);
  }
  function onActivate(panelId, fn) {
    var el = $('#rail-' + panelId); if (!el) return;
    new MutationObserver(function () { if (el.classList.contains('active')) fn(); }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  function noSubjectHtml() {
    return '<div class="trk-card"><div class="trk-empty">請先喺「客戶」頁揀一位客戶（撳客戶名載入），訓練同身體數據會記錄喺該客戶名下。</div>' +
      '<div class="trk-row"><button class="trk-btn primary trk-grow" data-a="goclients">👤 去揀客戶</button></div></div>';
  }
  function subjectBar(sub) {
    if (ED === 'fit') return '';
    return '<div class="trk-row"><div class="trk-grow" style="font-family:var(--mono);font-size:11px;color:var(--sub)">客戶：<b style="color:var(--green)">' + esc(sub.name) + '</b></div>' +
      '<button class="trk-btn small" data-a="goclients">切換客戶</button></div>';
  }

  // ───────────────────────── 訓練日誌 ─────────────────────────
  var EX_BUILTIN = ['Back Squat 背蹲', 'Front Squat 前蹲', 'Bench Press 臥推', 'Incline Bench Press 上斜臥推', 'Deadlift 硬舉', 'Romanian Deadlift 羅馬尼亞硬舉',
    'Overhead Press 肩推', 'Barbell Row 槓鈴划船', 'Pull-up 引體向上', 'Chin-up 反手引體', 'Lat Pulldown 高位下拉', 'Hip Thrust 臀推', 'Bulgarian Split Squat 保加利亞分腿蹲',
    'Walking Lunge 行走弓步', 'Leg Press 腿推', 'Leg Curl 腿彎舉', 'Leg Extension 腿伸展', 'Dumbbell Bench Press 啞鈴臥推', 'Dumbbell Shoulder Press 啞鈴肩推',
    'Lateral Raise 側平舉', 'Biceps Curl 二頭彎舉', 'Triceps Pushdown 三頭下壓', 'Face Pull 面拉', 'Seated Cable Row 坐姿划船', 'Push-up 伏地挺身', 'Dip 雙槓撐體',
    'Plank 平板支撐', 'Calf Raise 提踵', 'Farmer Carry 農夫走路', 'Kettlebell Swing 壺鈴擺盪', 'Goblet Squat 高腳杯深蹲', 'Single Leg RDL 單腳羅馬尼亞硬舉'];
  var L = { sid: null, sessions: [], draft: null, open: null, token: 0, prefs: { rest: 90, auto: true }, progEx: '' };
  try { var pp = JSON.parse(localStorage.getItem('fuse_trk_prefs') || 'null'); if (pp) { L.prefs.rest = pp.rest || 90; L.prefs.auto = pp.auto !== false; } } catch (e) {}
  function savePrefs() { try { localStorage.setItem('fuse_trk_prefs', JSON.stringify(L.prefs)); } catch (e) {} }

  function newDraft() { return { date: todayISO(), title: '', exercises: [{ name: '', sets: [{ kg: '', reps: '', rpe: '', done: false }] }] }; }
  function e1rm(kg, reps) { kg = num(kg); reps = num(reps); return kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0; }
  function setMetric(s) { return num(s.kg) > 0 ? e1rm(s.kg, s.reps) : num(s.reps); }
  function exBest(sessions, key) {
    var best = 0;
    sessions.forEach(function (ss) { ss.exercises.forEach(function (ex) { if (normName(ex.name) === key) ex.sets.forEach(function (s) { best = Math.max(best, setMetric(s)); }); }); });
    return best;
  }
  function lastOf(sessions, key) {
    for (var i = 0; i < sessions.length; i++) for (var j = 0; j < sessions[i].exercises.length; j++) if (normName(sessions[i].exercises[j].name) === key) return { date: sessions[i].date, ex: sessions[i].exercises[j] };
    return null;
  }
  function volume(ses) { var v = 0; ses.exercises.forEach(function (ex) { ex.sets.forEach(function (s) { v += num(s.kg) * num(s.reps); }); }); return v; }
  function setStr(s) { return (num(s.kg) > 0 ? fmt(num(s.kg)) + 'kg' : '自重') + '×' + fmt(num(s.reps)) + (num(s.rpe) ? ' @' + fmt(num(s.rpe)) : ''); }
  function sortSessions() { L.sessions.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0); }); }
  function allExNames() {
    var seen = {}, out = [];
    function add(n) { var k = normName(n); if (k && !seen[k]) { seen[k] = 1; out.push(n); } }
    L.sessions.forEach(function (ss) { ss.exercises.forEach(function (ex) { add(ex.name); }); });
    EX_BUILTIN.forEach(add);
    try { (EXERCISE_LIBRARY.categories || []).forEach(function (c) { (c.items || []).forEach(function (it) { if (it.n) add((it.en ? it.en + ' ' : '') + it.n); }); }); } catch (e) {}
    return out;
  }
  var saveDraft = debounce(function () { if (L.sid && L.draft) S.set(KEY.draft(L.sid), L.draft); }, 400);

  function draftHtml() {
    var d = L.draft;
    return d.exercises.map(function (ex, ei) {
      var key = normName(ex.name), last = key ? lastOf(L.sessions, key) : null;
      var hint = last ? '上次 ' + shortDate(last.date) + '：' + last.ex.sets.map(setStr).join(' · ') : (key ? '首次記錄呢個動作' : '');
      var rows = ex.sets.map(function (s, si) {
        return '<div class="n">' + (si + 1) + '</div>' +
          '<input class="trk-in" type="number" inputmode="decimal" step="0.5" min="0" placeholder="kg" aria-label="第' + (si + 1) + '組 重量kg" data-f="kg" data-e="' + ei + '" data-s="' + si + '" value="' + esc(s.kg) + '">' +
          '<input class="trk-in" type="number" inputmode="numeric" step="1" min="0" placeholder="次" aria-label="第' + (si + 1) + '組 次數" data-f="reps" data-e="' + ei + '" data-s="' + si + '" value="' + esc(s.reps) + '">' +
          '<input class="trk-in" type="number" inputmode="decimal" step="0.5" min="1" max="10" placeholder="RPE" aria-label="第' + (si + 1) + '組 RPE" data-f="rpe" data-e="' + ei + '" data-s="' + si + '" value="' + esc(s.rpe) + '">' +
          '<button class="tick' + (s.done ? ' done' : '') + '" data-a="tick" data-e="' + ei + '" data-s="' + si + '" aria-label="完成第' + (si + 1) + '組" aria-pressed="' + (!!s.done) + '">✓</button>' +
          '<button class="x" data-a="delset" data-e="' + ei + '" data-s="' + si + '" aria-label="刪除第' + (si + 1) + '組">✕</button>';
      }).join('');
      return '<div class="trk-card">' +
        '<div class="trk-row"><input class="trk-in trk-grow" list="trk-exlist" placeholder="動作名稱（例如 Back Squat 背蹲）" aria-label="動作名稱" data-f="name" data-e="' + ei + '" value="' + esc(ex.name) + '">' +
        '<button class="trk-btn small warn" data-a="delex" data-e="' + ei + '" aria-label="刪除動作">✕</button></div>' +
        (hint ? '<div class="trk-hint">' + esc(hint) + '</div>' : '') +
        '<div class="trk-sets"><div class="hd">組</div><div class="hd">重量kg</div><div class="hd">次數</div><div class="hd">RPE</div><div class="hd">完成</div><div class="hd"></div>' + rows + '</div>' +
        '<div class="trk-row" style="margin-top:8px"><button class="trk-btn small" data-a="addset" data-e="' + ei + '">＋ 加一組（複製上組）</button></div></div>';
    }).join('');
  }

  function summaryHtml() {
    var now = Date.now(), wk = L.sessions.filter(function (s) { return now - new Date(s.date + 'T00:00:00').getTime() <= 7 * 86400000 + 86400000; });
    var vol = wk.reduce(function (a, s) { return a + (s.volume || 0); }, 0);
    var prs = [];
    L.sessions.forEach(function (s) { if (now - new Date(s.date + 'T00:00:00').getTime() <= 30 * 86400000 + 86400000) s.exercises.forEach(function (ex) { if (ex.pr) prs.push(ex.name.replace(/\s*[一-鿿].*$/, '') || ex.name); }); });
    return '<div class="trk-stats"><div class="trk-stat"><b>' + wk.length + '</b><span>近7日訓練</span></div>' +
      '<div class="trk-stat"><b>' + (vol >= 1000 ? fmt(vol / 1000) + 't' : fmt(vol) + 'kg') + '</b><span>近7日總量</span></div>' +
      '<div class="trk-stat"><b>' + prs.length + '</b><span>近30日 PR</span></div></div>' +
      (prs.length ? '<div class="trk-hint">🏆 ' + esc(prs.slice(0, 5).join('、')) + '</div>' : '');
  }

  function historyHtml() {
    if (!L.sessions.length) return '<div class="trk-empty">未有訓練記錄——喺上面記低第一堂啦。</div>';
    return L.sessions.slice(0, 30).map(function (s) {
      var prc = s.exercises.filter(function (e) { return e.pr; }).length, open = L.open === s.id;
      var det = open ? '<div class="det">' + s.exercises.map(function (ex) {
        return '<div><b style="color:var(--text)">' + esc(ex.name) + '</b>' + (ex.pr ? '<span class="trk-pr">🏆 PR</span>' : '') + '<br>' + ex.sets.map(setStr).map(esc).join(' · ') + '</div>';
      }).join('') +
        '<div class="trk-row" style="margin-top:8px;flex-wrap:wrap"><button class="trk-btn small blue" data-a="redo" data-id="' + s.id + '">↻ 重做呢堂</button>' +
        '<button class="trk-btn small" data-a="share" data-id="' + s.id + '">💬 WhatsApp</button>' +
        '<button class="trk-btn small warn" data-a="delsess" data-id="' + s.id + '">刪除</button></div></div>' : '';
      return '<div class="trk-sess"><div class="top" data-a="toggle" data-id="' + s.id + '" role="button" tabindex="0">' +
        '<div class="trk-grow"><b style="font-family:var(--mono);font-size:12px;color:var(--text)">' + esc(s.date) + (s.title ? ' · ' + esc(s.title) : '') + '</b>' +
        '<div class="trk-hint" style="margin:0">' + s.exercises.length + ' 個動作 · 總量 ' + Math.round(s.volume || 0).toLocaleString() + 'kg</div></div>' +
        (prc ? '<span class="trk-pr">🏆 ' + prc + '</span>' : '') + '<span style="color:var(--sub)">' + (open ? '▾' : '›') + '</span></div>' + det + '</div>';
    }).join('') + (L.sessions.length > 30 ? '<div class="trk-hint">只顯示最近30堂（全部資料都有保存／備份）</div>' : '');
  }

  function progressHtml() {
    var names = {}, list = [];
    L.sessions.forEach(function (s) { s.exercises.forEach(function (ex) { var k = normName(ex.name); if (k && !names[k]) { names[k] = ex.name; list.push(k); } }); });
    if (!list.length) return '';
    if (!L.progEx || !names[L.progEx]) L.progEx = list[0];
    var pts = [], weighted = false, bestSet = null, bestM = 0;
    L.sessions.slice().reverse().forEach(function (s) {
      s.exercises.forEach(function (ex) {
        if (normName(ex.name) !== L.progEx) return;
        var m = 0; ex.sets.forEach(function (st2) { var v = setMetric(st2); if (num(st2.kg) > 0) weighted = true; if (v > m) m = v; if (v > bestM) { bestM = v; bestSet = st2; } });
        if (m > 0) pts.push({ x: s.date, y: m });
      });
    });
    var delta = pts.length > 1 ? pts[pts.length - 1].y - pts[0].y : 0;
    return '<div class="trk-card"><div class="trk-row"><select class="trk-in trk-grow" data-f="progex" aria-label="揀動作睇進度">' +
      list.map(function (k) { return '<option value="' + esc(k) + '"' + (k === L.progEx ? ' selected' : '') + '>' + esc(names[k]) + '</option>'; }).join('') + '</select></div>' +
      lineChart(pts, weighted ? 'kg' : '次') +
      '<div class="trk-hint">' + (weighted ? '估算 1RM（Epley）' : '最佳次數') + (pts.length > 1 ? ' · 由 ' + fmt(pts[0].y) + ' → ' + fmt(pts[pts.length - 1].y) + '（' + (delta >= 0 ? '+' : '') + fmt(delta) + '）' : '') +
      (bestSet ? ' · 最佳組：' + esc(setStr(bestSet)) : '') + '</div></div>';
  }

  function onboardingHtml() {
    if (ED !== 'fit' || L.sessions.length) return '';
    return '<div class="trk-card" style="border-color:rgba(0,229,160,.35)"><b style="color:var(--green)">👋 歡迎使用 Fuse Fit</b>' +
      '<div class="trk-hint" style="font-size:11px">記錄訓練、追蹤 PR 同身體數據，再配合體態評估搵出自己嘅弱項。</div>' +
      '<div class="trk-row" style="flex-wrap:wrap;margin-top:8px">' +
      '<button class="trk-btn primary" data-a="goseq">📐 快速評估指南</button>' +
      '<button class="trk-btn" data-a="gobody">⚖️ 記身體數據</button>' +
      '<button class="trk-btn" data-a="gotimer">⏱ 計時器</button></div></div>';
  }
  function fitToolsHtml() {
    if (ED !== 'fit') return '';
    return '<div class="trk-row" style="flex-wrap:wrap"><button class="trk-btn small" data-a="myhist">📈 我嘅評估歷史</button><button class="trk-btn small" data-a="myedit">✎ 我嘅資料</button></div>';
  }

  async function renderLog() {
    var root = $('#trk-log-body'); if (!root) return;
    var sub = subject();
    if (!sub) { root.innerHTML = noSubjectHtml(); return; }
    var tok = ++L.token;
    if (L.sid !== sub.id) {
      var data = await S.get(KEY.log(sub.id)), dr = await S.get(KEY.draft(sub.id));
      if (tok !== L.token) return;
      L.sid = sub.id; L.sessions = data || []; sortSessions(); L.draft = dr && dr.exercises ? dr : newDraft(); L.open = null; L.progEx = '';
    }
    root.innerHTML = subjectBar(sub) + onboardingHtml() + summaryHtml() +
      '<datalist id="trk-exlist">' + allExNames().slice(0, 500).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<div class="trk-h">今日訓練</div>' +
      '<div class="trk-row"><input class="trk-in" type="date" aria-label="訓練日期" data-f="date" value="' + esc(L.draft.date) + '" style="flex:0 0 150px">' +
      '<input class="trk-in trk-grow" placeholder="標題（例如 Push Day）" aria-label="訓練標題" data-f="title" value="' + esc(L.draft.title) + '"></div>' +
      '<div id="trk-draft" class="trk-wrap">' + draftHtml() + '</div>' +
      '<div class="trk-row"><button class="trk-btn trk-grow" data-a="addex">＋ 加動作</button></div>' +
      '<div class="trk-card"><div class="trk-row"><div class="trk-grow" style="font-family:var(--mono);font-size:11px;color:var(--sub)">組間休息</div>' +
      '<select class="trk-in" style="flex:0 0 96px" data-f="rest" aria-label="組間休息秒數">' + [30, 45, 60, 90, 120, 180, 240, 300].map(function (v) { return '<option value="' + v + '"' + (v === L.prefs.rest ? ' selected' : '') + '>' + v + ' 秒</option>'; }).join('') + '</select></div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px;color:#9aa3b5"><input type="checkbox" data-f="auto"' + (L.prefs.auto ? ' checked' : '') + '> 剔完一組自動開始休息計時</label></div>' +
      '<div class="trk-row"><button class="trk-btn primary trk-grow" data-a="save">💾 儲存今日訓練</button><button class="trk-btn warn" data-a="clear">清空</button></div>' +
      fitToolsHtml() +
      '<div class="trk-h">動作進度 PROGRESS</div>' + (progressHtml() || '<div class="trk-empty">儲存訓練後，呢度會顯示每個動作嘅估算1RM趨勢。</div>') +
      '<div class="trk-h">訓練記錄 HISTORY</div><div id="trk-hist" class="trk-wrap">' + historyHtml() + '</div>';
  }

  function refreshDraft() { var el = $('#trk-draft'); if (el) el.innerHTML = draftHtml(); }
  function refreshHist() { var el = $('#trk-hist'); if (el) el.innerHTML = historyHtml(); }

  function prefillFromLast(ei) {
    var ex = L.draft.exercises[ei], key = normName(ex.name); if (!key) return;
    var empty = ex.sets.every(function (s) { return !s.kg && !s.reps && !s.rpe; });
    var last = lastOf(L.sessions, key);
    if (empty && last) ex.sets = last.ex.sets.map(function (s) { return { kg: s.kg, reps: s.reps, rpe: s.rpe, done: false }; });
  }

  async function saveSession() {
    var d = L.draft, sub = subject(); if (!sub) return;
    var exs = [];
    d.exercises.forEach(function (ex) {
      var name = String(ex.name || '').trim(); if (!name) return;
      var sets = ex.sets.filter(function (s) { return num(s.reps) > 0; }).map(function (s) { return { kg: num(s.kg), reps: num(s.reps), rpe: num(s.rpe) || 0 }; });
      if (sets.length) exs.push({ name: name, sets: sets });
    });
    if (!exs.length) { toast('請至少填一個動作同每組嘅次數'); return; }
    var prCount = 0;
    exs.forEach(function (ex) {
      var prev = exBest(L.sessions, normName(ex.name)), top = 0, topSet = null;
      ex.sets.forEach(function (s) { var m = setMetric(s); if (m > top) { top = m; topSet = s; } });
      if (prev > 0 && top > prev + 1e-9) { ex.pr = true; if (topSet) topSet.pr = true; prCount++; }
    });
    var ses = { id: uid(), date: d.date || todayISO(), title: String(d.title || '').trim(), exercises: exs, created: Date.now() };
    ses.volume = volume(ses);
    L.sessions.unshift(ses); sortSessions();
    if (!(await S.set(KEY.log(sub.id), L.sessions))) { L.sessions = L.sessions.filter(function (x) { return x.id !== ses.id; }); return; }
    L.draft = newDraft(); await S.set(KEY.draft(sub.id), L.draft);
    toast('已儲存 · 總量 ' + Math.round(ses.volume).toLocaleString() + 'kg' + (prCount ? ' · 🏆 ' + prCount + ' 個PR！' : ''));
    renderLog();
  }

  function sessionText(s) {
    var who = ED === 'fit' ? '' : (subject() ? subject().name + ' ' : '');
    return '🏋️ ' + who + s.date + (s.title ? ' ' + s.title : '') + '\n' + s.exercises.map(function (ex) { return '• ' + ex.name + (ex.pr ? ' 🏆PR' : '') + '：' + ex.sets.map(setStr).join('、'); }).join('\n') +
      '\n總量 ' + Math.round(s.volume || 0).toLocaleString() + 'kg（Fuse ' + (ED === 'fit' ? 'Fit' : 'Coach') + '）';
  }

  function bindLog() {
    var p = $('#rail-tlog'); if (!p) return;
    p.addEventListener('click', async function (e) {
      var t = e.target.closest('[data-a]'); if (!t) return; var a = t.getAttribute('data-a');
      var ei = +t.getAttribute('data-e'), si = +t.getAttribute('data-s');
      if (a === 'goclients') window.switchRail('clients');
      else if (a === 'goseq') { if (window.openSeqGuide) window.openSeqGuide(); }
      else if (a === 'gobody') window.switchRail('tbody');
      else if (a === 'gotimer') window.switchRail('ttimer');
      else if (a === 'myhist') { if (window.viewClientHistory) window.viewClientHistory('me'); }
      else if (a === 'myedit') { if (window.openClientModal) window.openClientModal('me'); }
      else if (a === 'addex') { L.draft.exercises.push({ name: '', sets: [{ kg: '', reps: '', rpe: '', done: false }] }); refreshDraft(); saveDraft(); }
      else if (a === 'delex') { L.draft.exercises.splice(ei, 1); if (!L.draft.exercises.length) L.draft.exercises.push({ name: '', sets: [{ kg: '', reps: '', rpe: '', done: false }] }); refreshDraft(); saveDraft(); }
      else if (a === 'addset') { var ss = L.draft.exercises[ei].sets, lst = ss[ss.length - 1] || {}; ss.push({ kg: lst.kg || '', reps: lst.reps || '', rpe: lst.rpe || '', done: false }); refreshDraft(); saveDraft(); }
      else if (a === 'delset') { var arr = L.draft.exercises[ei].sets; arr.splice(si, 1); if (!arr.length) arr.push({ kg: '', reps: '', rpe: '', done: false }); refreshDraft(); saveDraft(); }
      else if (a === 'tick') {
        var s = L.draft.exercises[ei].sets[si]; s.done = !s.done; refreshDraft(); saveDraft();
        if (s.done && L.prefs.auto && window.FuseTimer) window.FuseTimer.startRest(L.prefs.rest);
      }
      else if (a === 'save') saveSession();
      else if (a === 'clear') { if (confirm('清空今日未儲存嘅內容？')) { L.draft = newDraft(); await S.set(KEY.draft(L.sid), L.draft); renderLog(); } }
      else if (a === 'toggle') { var id = t.getAttribute('data-id'); L.open = L.open === id ? null : id; refreshHist(); }
      else if (a === 'redo') {
        var src = L.sessions.find(function (x) { return x.id === t.getAttribute('data-id'); }); if (!src) return;
        L.draft = { date: todayISO(), title: src.title, exercises: src.exercises.map(function (ex) { return { name: ex.name, sets: ex.sets.map(function (s) { return { kg: s.kg, reps: s.reps, rpe: s.rpe || '', done: false }; }) }; }) };
        await S.set(KEY.draft(L.sid), L.draft); renderLog(); toast('已載入上次內容，調整後儲存'); p.scrollTop = 0;
      }
      else if (a === 'share') { var sx = L.sessions.find(function (x) { return x.id === t.getAttribute('data-id'); }); if (sx) shareText(sessionText(sx)); }
      else if (a === 'delsess') {
        if (!confirm('刪除呢堂訓練記錄？')) return;
        L.sessions = L.sessions.filter(function (x) { return x.id !== t.getAttribute('data-id'); });
        await S.set(KEY.log(L.sid), L.sessions); renderLog();
      }
    });
    p.addEventListener('input', function (e) {
      var t = e.target, f = t.getAttribute && t.getAttribute('data-f'); if (!f || !L.draft) return;
      if (f === 'date') L.draft.date = t.value; else if (f === 'title') L.draft.title = t.value;
      else if (f === 'name') L.draft.exercises[+t.getAttribute('data-e')].name = t.value;
      else if (f === 'kg' || f === 'reps' || f === 'rpe') L.draft.exercises[+t.getAttribute('data-e')].sets[+t.getAttribute('data-s')][f] = t.value;
      else return;
      saveDraft();
    });
    p.addEventListener('change', function (e) {
      var t = e.target, f = t.getAttribute && t.getAttribute('data-f'); if (!f) return;
      if (f === 'name' && L.draft) { prefillFromLast(+t.getAttribute('data-e')); refreshDraft(); saveDraft(); }
      else if (f === 'rest') { L.prefs.rest = +t.value; savePrefs(); }
      else if (f === 'auto') { L.prefs.auto = t.checked; savePrefs(); }
      else if (f === 'progex') { L.progEx = t.value; renderLog(); }
    });
  }

  // ───────────────────────── 身體數據 ─────────────────────────
  var BODY_FIELDS = [
    { k: 'weight', l: '體重', u: 'kg' }, { k: 'bf', l: '體脂', u: '%' }, { k: 'waist', l: '腰圍', u: 'cm' }, { k: 'chest', l: '胸圍', u: 'cm' },
    { k: 'hip', l: '臀圍', u: 'cm' }, { k: 'arm', l: '上臂圍', u: 'cm' }, { k: 'thigh', l: '大腿圍', u: 'cm' }
  ];
  var B = { sid: null, rows: [], metric: 'weight', token: 0 };

  function bodyHtml(sub) {
    var rows = B.rows, last = rows[0] || {};
    var form = '<div class="trk-card"><div class="trk-row"><input class="trk-in" type="date" aria-label="日期" id="trk-b-date" value="' + todayISO() + '"></div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:8px">' +
      BODY_FIELDS.map(function (f) {
        return '<label style="font-family:var(--mono);font-size:10px;color:var(--sub)">' + f.l + '（' + f.u + '）<input class="trk-in" type="number" inputmode="decimal" step="0.1" min="0" id="trk-b-' + f.k + '" value="' + esc(last[f.k] != null ? last[f.k] : '') + '" style="margin-top:3px"></label>';
      }).join('') + '</div>' +
      '<input class="trk-in" id="trk-b-note" placeholder="備註（選填）" style="margin-top:8px">' +
      '<div class="trk-row" style="margin-top:8px"><button class="trk-btn primary trk-grow" data-a="bsave">💾 記錄</button></div>' +
      '<div class="trk-hint">已預填上次數值，改變咗嘅先需要改。</div></div>';
    var opts = BODY_FIELDS.map(function (f) { return '<option value="' + f.k + '"' + (f.k === B.metric ? ' selected' : '') + '>' + f.l + '（' + f.u + '）</option>'; }).join('');
    var fld = BODY_FIELDS.filter(function (f) { return f.k === B.metric; })[0];
    var pts = rows.slice().reverse().filter(function (r) { return num(r[B.metric]) > 0; }).map(function (r) { return { x: r.date, y: num(r[B.metric]) }; });
    var chartCard = '<div class="trk-card"><select class="trk-in" data-f="bmetric" aria-label="揀指標">' + opts + '</select>' + lineChart(pts, fld.u) +
      (pts.length > 1 ? '<div class="trk-hint">由 ' + fmt(pts[0].y) + ' → ' + fmt(pts[pts.length - 1].y) + fld.u + '（' + (pts[pts.length - 1].y - pts[0].y >= 0 ? '+' : '') + fmt(pts[pts.length - 1].y - pts[0].y) + '）· 共 ' + pts.length + ' 筆</div>' : '') + '</div>';
    var lean = last.weight && last.bf ? '<div class="trk-hint">最新去脂體重估算：約 ' + fmt(num(last.weight) * (1 - num(last.bf) / 100)) + 'kg · 脂肪量約 ' + fmt(num(last.weight) * num(last.bf) / 100) + 'kg</div>' : '';
    var list = rows.length ? rows.slice(0, 20).map(function (r) {
      return '<div class="trk-sess"><div class="top" style="cursor:default"><div class="trk-grow"><b style="font-family:var(--mono);font-size:12px;color:var(--text)">' + esc(r.date) + '</b>' +
        '<div class="trk-hint" style="margin:0">' + BODY_FIELDS.filter(function (f) { return num(r[f.k]) > 0; }).map(function (f) { return f.l + ' ' + fmt(num(r[f.k])) + f.u; }).join(' · ') + (r.note ? ' · ' + esc(r.note) : '') + '</div></div>' +
        '<button class="trk-btn small warn" data-a="bdel" data-id="' + r.id + '" aria-label="刪除記錄">✕</button></div></div>';
    }).join('') : '<div class="trk-empty">未有記錄。</div>';
    var share = rows.length > 1 ? '<div class="trk-row"><button class="trk-btn small" data-a="bshare">💬 WhatsApp 分享身體變化</button></div>' : '';
    return subjectBar(sub) + form + chartCard + lean + share + '<div class="trk-h">記錄 HISTORY</div>' + list;
  }

  async function renderBody() {
    var root = $('#trk-body-body'); if (!root) return;
    var sub = subject(); if (!sub) { root.innerHTML = noSubjectHtml(); return; }
    var tok = ++B.token;
    if (B.sid !== sub.id) { var d = await S.get(KEY.body(sub.id)); if (tok !== B.token) return; B.sid = sub.id; B.rows = d || []; }
    root.innerHTML = bodyHtml(sub);
  }
  function bodyShareText() {
    var rows = B.rows.slice().reverse(), first = rows[0], lastR = rows[rows.length - 1];
    var who = ED === 'fit' ? '' : (subject() ? subject().name + ' ' : '');
    return '⚖️ ' + who + '身體數據變化（' + first.date + ' → ' + lastR.date + '）\n' + BODY_FIELDS.filter(function (f) { return num(first[f.k]) > 0 && num(lastR[f.k]) > 0; })
      .map(function (f) { var dlt = num(lastR[f.k]) - num(first[f.k]); return '• ' + f.l + '：' + fmt(num(first[f.k])) + ' → ' + fmt(num(lastR[f.k])) + f.u + '（' + (dlt >= 0 ? '+' : '') + fmt(dlt) + '）'; }).join('\n');
  }
  function bindBody() {
    var p = $('#rail-tbody'); if (!p) return;
    p.addEventListener('click', async function (e) {
      var t = e.target.closest('[data-a]'); if (!t) return; var a = t.getAttribute('data-a');
      if (a === 'goclients') window.switchRail('clients');
      else if (a === 'bsave') {
        var r = { id: uid(), date: ($('#trk-b-date') || {}).value || todayISO(), note: (($('#trk-b-note') || {}).value || '').trim() }, any = false;
        BODY_FIELDS.forEach(function (f) { var v = num(($('#trk-b-' + f.k) || {}).value); if (v > 0) { r[f.k] = v; any = true; } });
        if (!any) { toast('請至少填一項數值'); return; }
        B.rows.unshift(r); B.rows.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });
        if (!(await S.set(KEY.body(B.sid), B.rows))) { B.rows = B.rows.filter(function (x) { return x.id !== r.id; }); return; }
        toast('已記錄身體數據'); renderBody();
      }
      else if (a === 'bdel') { if (!confirm('刪除呢筆記錄？')) return; B.rows = B.rows.filter(function (x) { return x.id !== t.getAttribute('data-id'); }); await S.set(KEY.body(B.sid), B.rows); renderBody(); }
      else if (a === 'bshare') shareText(bodyShareText());
    });
    p.addEventListener('change', function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-f') === 'bmetric') { B.metric = t.value; renderBody(); } });
  }

  // ───────────────────────── 計時器 ─────────────────────────
  var TM = { mode: 'rest', running: false, paused: false, endAt: 0, remainMs: 0, total: 90, phase: 'idle', round: 1,
    iv: { prep: 5, work: 20, rest: 10, rounds: 8 }, lastTick: -1, wake: null, ctx: null };
  try { var tp = JSON.parse(localStorage.getItem('fuse_timer_iv') || 'null'); if (tp) TM.iv = Object.assign(TM.iv, tp); } catch (e) {}
  function saveIv() { try { localStorage.setItem('fuse_timer_iv', JSON.stringify(TM.iv)); } catch (e) {} }

  function audio() {
    try { if (!TM.ctx) TM.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (TM.ctx.state === 'suspended') TM.ctx.resume(); } catch (e) {}
    return TM.ctx;
  }
  function beep(freq, dur, vol) {
    var c = audio(); if (!c) return;
    try {
      var o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.25, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function wakeOn() { try { if (navigator.wakeLock && !TM.wake) navigator.wakeLock.request('screen').then(function (w) { TM.wake = w; w.addEventListener('release', function () { TM.wake = null; }); }).catch(function () {}); } catch (e) {} }
  function wakeOff() { try { if (TM.wake) { TM.wake.release(); TM.wake = null; } } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && TM.running && !TM.paused) wakeOn(); });

  function mmss(sec) { sec = Math.max(0, Math.ceil(sec)); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
  function remainSec() { return TM.paused ? TM.remainMs / 1000 : (TM.endAt - Date.now()) / 1000; }

  function startRest(sec) {
    TM.mode = 'rest'; TM.total = sec; TM.phase = 'rest'; TM.running = true; TM.paused = false; TM.endAt = Date.now() + sec * 1000; TM.lastTick = -1;
    audio(); wakeOn(); tickLoop(); drawTimer();
  }
  function startInterval() {
    TM.mode = 'iv'; TM.running = true; TM.paused = false; TM.round = 1; TM.lastTick = -1; audio(); wakeOn();
    setPhase(TM.iv.prep > 0 ? 'prep' : 'work'); tickLoop(); drawTimer();
  }
  function setPhase(ph) {
    TM.phase = ph; TM.lastTick = -1;
    var secs = ph === 'prep' ? TM.iv.prep : ph === 'work' ? TM.iv.work : TM.iv.rest;
    TM.total = secs; TM.endAt = Date.now() + secs * 1000;
    if (ph === 'work') { beep(1100, 0.25, 0.3); setTimeout(function () { beep(1100, 0.25, 0.3); }, 300); vibrate([200, 80, 200]); }
    else if (ph === 'rest') { beep(500, 0.4, 0.3); vibrate(300); }
  }
  function finish() {
    TM.running = false; TM.paused = false; TM.phase = 'done'; wakeOff();
    beep(880, 0.3, 0.35); setTimeout(function () { beep(880, 0.3, 0.35); }, 380); setTimeout(function () { beep(1320, 0.6, 0.35); }, 760); vibrate([300, 120, 300, 120, 600]);
    drawTimer(); var d = $('#trk-time'); if (d) { d.classList.add('trk-flash'); setTimeout(function () { d.classList.remove('trk-flash'); }, 1800); }
  }
  function advance() {
    if (TM.mode === 'rest') { finish(); return; }
    if (TM.phase === 'prep') setPhase('work');
    else if (TM.phase === 'work') {
      if (TM.round >= TM.iv.rounds) { finish(); return; }
      if (TM.iv.rest > 0) setPhase('rest'); else { TM.round++; setPhase('work'); }
    } else if (TM.phase === 'rest') { TM.round++; setPhase('work'); }
  }
  var loopId = null;
  function tickLoop() {
    if (loopId) return;
    loopId = setInterval(function () {
      if (!TM.running || TM.paused) { if (!TM.running) { clearInterval(loopId); loopId = null; } drawTimer(); return; }
      var r = remainSec();
      if (r <= 0) { advance(); drawTimer(); return; }
      var s = Math.ceil(r);
      if (s <= 3 && s !== TM.lastTick) { TM.lastTick = s; beep(700, 0.12, 0.2); }
      drawTimer();
    }, 200);
  }
  function pauseResume() {
    if (!TM.running) return;
    if (TM.paused) { TM.paused = false; TM.endAt = Date.now() + TM.remainMs; wakeOn(); }
    else { TM.paused = true; TM.remainMs = Math.max(0, TM.endAt - Date.now()); }
    drawTimer();
  }
  function resetTimer() { TM.running = false; TM.paused = false; TM.phase = 'idle'; wakeOff(); drawTimer(); }
  window.FuseTimer = { startRest: startRest, reset: resetTimer };

  function phaseLabel() {
    if (TM.phase === 'idle') return TM.mode === 'rest' ? '準備好就撳開始' : '設定好就撳開始';
    if (TM.phase === 'done') return '✅ 完成！';
    if (TM.mode === 'rest') return TM.paused ? '⏸ 暫停' : '休息中';
    var nm = TM.phase === 'prep' ? '準備' : TM.phase === 'work' ? '工作 WORK' : '休息 REST';
    return (TM.paused ? '⏸ ' : '') + nm + ' · 第 ' + TM.round + ' / ' + TM.iv.rounds + ' 輪';
  }
  function drawTimer() {
    var chip = $('#trk-chip'), panel = $('#rail-ttimer'), onPanel = panel && panel.classList.contains('active');
    var disp = $('#trk-time'), lab = $('#trk-phase');
    var secs = TM.phase === 'idle' ? (TM.mode === 'rest' ? TM.total : TM.iv.work) : TM.phase === 'done' ? 0 : remainSec();
    if (disp) { disp.textContent = mmss(secs); disp.className = 'trk-time ' + (TM.phase === 'work' ? 'work' : TM.phase === 'rest' || TM.phase === 'prep' ? 'rest' : TM.phase === 'done' ? 'done' : ''); }
    if (lab) lab.textContent = phaseLabel();
    var pb = $('#trk-pause'); if (pb) { pb.textContent = TM.paused ? '▶ 繼續' : '⏸ 暫停'; pb.disabled = !TM.running; }
    var sb = $('#trk-start'); if (sb) sb.textContent = TM.running ? '↻ 重新開始' : '▶ 開始';
    if (chip) {
      var show = TM.running && !onPanel;
      chip.style.display = show ? 'block' : 'none';
      if (show) { chip.className = TM.phase === 'work' ? '' : 'rest'; chip.textContent = '⏱ ' + mmss(remainSec()) + (TM.mode === 'iv' ? ' · ' + (TM.phase === 'work' ? '工作' : TM.phase === 'prep' ? '準備' : '休息') + TM.round + '/' + TM.iv.rounds : ''); }
    }
  }
  var IV_PRESETS = [{ n: 'Tabata 20/10×8', w: 20, r: 10, o: 8 }, { n: 'EMOM 60×10', w: 60, r: 0, o: 10 }, { n: 'HIIT 40/20×10', w: 40, r: 20, o: 10 }, { n: '30/30×12', w: 30, r: 30, o: 12 }];
  function timerHtml() {
    var tabs = '<div class="trk-seg"><button class="trk-btn' + (TM.mode === 'rest' ? ' on' : '') + '" data-a="mode" data-m="rest">休息計時</button><button class="trk-btn' + (TM.mode === 'iv' ? ' on' : '') + '" data-a="mode" data-m="iv">間歇計時</button></div>';
    var cfg;
    if (TM.mode === 'rest') {
      cfg = '<div class="trk-chips">' + [30, 45, 60, 90, 120, 180, 240, 300].map(function (v) { return '<button class="trk-btn small' + (v === L.prefs.rest ? ' on' : '') + '" data-a="restpick" data-v="' + v + '">' + (v >= 60 ? (v / 60) + '分' : v + '秒') + '</button>'; }).join('') + '</div>' +
        '<div class="trk-hint">喺「訓練」頁剔完一組，會自動用呢個時間開始休息計時。</div>';
    } else {
      cfg = '<div class="trk-chips">' + IV_PRESETS.map(function (p, i) { return '<button class="trk-btn small" data-a="ivpreset" data-i="' + i + '">' + p.n + '</button>'; }).join('') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">' +
        [['prep', '準備秒'], ['work', '工作秒'], ['rest', '休息秒'], ['rounds', '輪數']].map(function (f) { return '<label style="font-family:var(--mono);font-size:10px;color:var(--sub)">' + f[1] + '<input class="trk-in" type="number" inputmode="numeric" min="0" max="3600" data-f="iv-' + f[0] + '" value="' + TM.iv[f[0]] + '" style="margin-top:3px"></label>'; }).join('') + '</div>';
    }
    return tabs + '<div class="trk-card"><div class="trk-phase" id="trk-phase"></div><div class="trk-time" id="trk-time">00:00</div>' +
      '<div class="trk-row"><button class="trk-btn primary trk-grow" id="trk-start" data-a="start">▶ 開始</button><button class="trk-btn trk-grow" id="trk-pause" data-a="pause">⏸ 暫停</button><button class="trk-btn warn" data-a="reset">重置</button></div></div>' +
      '<div class="trk-card">' + cfg + '</div>' +
      '<div class="trk-hint">💡 計時用系統時鐘計算，切去其他頁面或鎖屏後時間仍然準確（鎖屏時提示音可能受手機限制）。計時進行中會保持螢幕長亮，並喺其他頁面顯示浮動倒數。</div>';
  }
  function renderTimer() { var r = $('#trk-timer-body'); if (!r) return; r.innerHTML = timerHtml(); drawTimer(); }
  function bindTimer() {
    var p = $('#rail-ttimer'); if (!p) return;
    p.addEventListener('click', function (e) {
      var t = e.target.closest('[data-a]'); if (!t) return; var a = t.getAttribute('data-a');
      if (a === 'mode') { TM.mode = t.getAttribute('data-m'); if (TM.running) resetTimer(); renderTimer(); }
      else if (a === 'restpick') { L.prefs.rest = +t.getAttribute('data-v'); savePrefs(); TM.total = L.prefs.rest; renderTimer(); }
      else if (a === 'ivpreset') { var pr = IV_PRESETS[+t.getAttribute('data-i')]; TM.iv.work = pr.w; TM.iv.rest = pr.r; TM.iv.rounds = pr.o; saveIv(); renderTimer(); }
      else if (a === 'start') { if (TM.mode === 'rest') startRest(L.prefs.rest); else startInterval(); }
      else if (a === 'pause') pauseResume();
      else if (a === 'reset') resetTimer();
    });
    p.addEventListener('change', function (e) {
      var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
      if (f && f.indexOf('iv-') === 0) { var k = f.slice(3), v = Math.max(k === 'rounds' ? 1 : 0, Math.min(3600, Math.round(num(t.value)))); TM.iv[k] = v; t.value = v; saveIv(); drawTimer(); }
    });
    var chip = document.createElement('div'); chip.id = 'trk-chip'; chip.setAttribute('role', 'button'); chip.setAttribute('tabindex', '0'); chip.setAttribute('aria-label', '返去計時器');
    chip.addEventListener('click', function () { window.switchRail('ttimer'); });
    document.body.appendChild(chip);
  }

  // ───────────────────────── 啟動 ─────────────────────────
  function init() {
    applyEdition();
    mkPanel('tlog', '🏋️ 訓練日誌 TRAINING LOG', '記低每組重量、次數同 RPE，自動估算 1RM 同偵測 PR；上次嘅數字會預填。', 'trk-log-body');
    mkPanel('tbody', '⚖️ 身體數據 BODY METRICS', '追蹤體重、體脂同圍度變化。', 'trk-body-body');
    mkPanel('ttimer', '⏱ 計時器 TIMER', '組間休息同 Tabata／EMOM／HIIT 間歇計時。', 'trk-timer-body');
    bindLog(); bindBody(); bindTimer();
    onActivate('tlog', renderLog); onActivate('tbody', renderBody); onActivate('ttimer', function () { renderTimer(); });
    if (ED === 'fit') {
      setTimeout(function () { if (typeof window.switchRail === 'function') window.switchRail('tlog'); }, 50);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.FuseTracker = { edition: ED, renderLog: renderLog, renderBody: renderBody };
})();
