/* app.js — 1000 Tracker (rooms + realtime)
   Notes:
   - No auth (MVP). If you enable RLS later, add policies.
*/
(() => {
  const PLAYERS = [
    { key: "banker", label: "Банкир" },
    { key: "risk", label: "Рисковый" },
    { key: "calm", label: "Невозмутимый" },
  ];

  const PLAYER_KEYS = PLAYERS.map(p => p.key);

  const $ = (id) => document.getElementById(id);

  // ----- Toast -----
  let toastTimer = null;
  function showToast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
  }

  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    } catch { return iso; }
  };

  // Views
  const viewHome = $("viewHome");
  const viewRoom = $("viewRoom");
  const statusPill = $("statusPill");

  // Home controls
  const roomCodeInput = $("roomCode");
  const meSelect = $("meSelect");
  const btnJoin = $("btnJoin");
  const btnCopyLink = $("btnCopyLink");
  const recentWrap = $("recentWrap");
  const recentList = $("recentList");
  const btnClearRecent = $("btnClearRecent");

  // Room header
  const roomCodeLabel = $("roomCodeLabel");
  const meLabel = $("meLabel");
  const lockLabel = $("lockLabel");
  const btnShare = $("btnShare");
  const btnExit = $("btnExit");

  // Tabs
  const tabButtons = Array.from(document.querySelectorAll(".tab"));
  const tabPanels = {
    rules: $("tab-rules"),
    score: $("tab-score"),
    history: $("tab-history"),
    graph: $("tab-graph") };

  // Rules tab
  const agreeGrid = $("agreeGrid");
  const btnSources = $("btnSources");
  const modalSources = $("modalSources");
  const btnCloseSources = $("btnCloseSources");

  const optVariantsOn = $("optVariantsOn");
  const variantsBody = $("variantsBody");
  const optRounding = $("optRounding");
  const optBoltsOn = $("optBoltsOn");
  const optBoltsPenalty = $("optBoltsPenalty");
  const opt555On = $("opt555On");
  const optBarrelOn = $("optBarrelOn");
  const optRospisOn = $("optRospisOn");
  const optGoldenOn = $("optGoldenOn");
  const btnSaveOptions = $("btnSaveOptions");
  const optionsHint = $("optionsHint");

  // Score tab
  const scoreGrid = $("scoreGrid");
  const liveHint = $("liveHint");
  const fBidder = $("fBidder");
  const fBid = $("fBid");
  const fMade = $("fMade");
  const fRospis = $("fRospis");
  const fGolden = $("fGolden");
  const pointsInputs = $("pointsInputs");
  const boltInputs = $("boltInputs");
  const btnAddRound = $("btnAddRound");
  const btnUndo = $("btnUndo");

  // History
  const historyList = $("historyList");

  // Graph
  const canvas = $("graph");
  const graphHint = $("graphHint");
  const ctx = canvas.getContext("2d");

  // Supabase
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient missing. Check supabase.js");
  }

  // State
  let room = null;
  let me = null;
  let subs = [];
  let lastSyncAt = null;
  let currentRulesObj = null;

  const RECENT_KEY = "tt_recent_rooms_v1";

  function setStatus(text) {
    statusPill.textContent = text;
  }

  function setLiveHint() {
    if (!lastSyncAt) {
      liveHint.textContent = "ожидание данных…";
      return;
    }
    liveHint.textContent = "обновлено: " + new Date(lastSyncAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function getQuery() {
    const p = new URLSearchParams(location.search);
    return {
      room: (p.get("room") || "").trim(),
      me: (p.get("me") || "").trim() };
  }

  function updateQuery(code, meKey) {
    const p = new URLSearchParams(location.search);
    if (code) p.set("room", code); else p.delete("room");
    if (meKey) p.set("me", meKey); else p.delete("me");
    const url = location.pathname + "?" + p.toString();
    history.replaceState(null, "", url);
  }

  function saveRecent(code) {
    if (!code) return;
    const now = Date.now();
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch {}
    list = list.filter(x => x.code !== code);
    list.unshift({ code, t: now });
    list = list.slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    renderRecent();
  }

  function renderRecent() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch {}
    if (!list.length) {
      recentWrap.style.display = "none";
      return;
    }
    recentWrap.style.display = "";
    recentList.innerHTML = "";
    list.forEach(item => {
      const b = document.createElement("button");
      b.className = "btn";
      b.type = "button";
      b.textContent = item.code;
      b.onclick = () => { roomCodeInput.value = item.code; };
      recentList.appendChild(b);
    });
  }

  function playerLabel(key) {
    return PLAYERS.find(p => p.key === key)?.label || key;
  }

  function setView(which) {
    const inRoom = which === "room";
    viewHome.style.display = inRoom ? "none" : "";
    viewRoom.style.display = inRoom ? "" : "none";
  }

  function setActiveTab(name) {
    tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    Object.entries(tabPanels).forEach(([k, el]) => {
      el.style.display = (k === name) ? "" : "none";
    });
  }

  function openSources(open) {
    modalSources.style.display = open ? "" : "none";
  }

  function setOptionsEnabled(enabled) {
    // enabled = can edit (not locked)
    [optVariantsOn, optRounding, optBoltsOn, optBoltsPenalty, opt555On, btnSaveOptions].forEach(el => {
      el.disabled = !enabled;
    });
    optionsHint.textContent = enabled ? "После 3х “Согласен ✅” настройки блокируются." : "Настройки заблокированы (правила согласованы).";
    variantsBody.style.opacity = optVariantsOn.checked ? "1" : ".55";
  }

  // ----- DB helpers -----
  async function getOrCreateRoom(code) {
    // Try select
    const { data: found, error: e1 } = await sb.from("rooms").select("*").eq("code", code).maybeSingle();
    if (e1 && e1.code !== "PGRST116") throw e1;
    if (found) return found;
    const { data: created, error: e2 } = await sb.from("rooms").insert({ code }).select("*").single();
    if (e2) throw e2;
    return created;
  }

  async function ensurePlayer(roomId, name) {
    const { data: found, error: e1 } = await sb.from("players").select("*").eq("room_id", roomId).eq("name", name).maybeSingle();
    if (e1 && e1.code !== "PGRST116") throw e1;
    if (found) return found;
    const { data: created, error: e2 } = await sb.from("players").insert({ room_id: roomId, name, agreed: false }).select("*").single();
    if (e2) throw e2;
    return created;
  }

  async function ensureRules(roomId) {
    const defaults = {
      variants_on: true,
      rounding: "none",
      bolts_on: false,
      bolts_penalty: 120,
      samoval_555_on: false };
    const { data: rows, error } = await sb.from("rules").select("*").eq("room_id", roomId);
    if (error) throw error;

    const existing = new Map(rows.map(r => [r.rule_key, r]));
    const inserts = [];
    for (const [k,v] of Object.entries(defaults)) {
      if (!existing.has(k)) inserts.push({ room_id: roomId, rule_key: k, value: v });
    }
    if (inserts.length) {
      const { error: e2 } = await sb.from("rules").insert(inserts);
      if (e2) throw e2;
    }
    return;
  }

  async function fetchState(roomId) {
    const [roomsRes, playersRes, rulesRes, roundsRes] = await Promise.all([
      sb.from("rooms").select("*").eq("id", roomId).single(),
      sb.from("players").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
      sb.from("rules").select("*").eq("room_id", roomId),
      sb.from("rounds").select("*").eq("room_id", roomId).order("created_at", { ascending: true }),
    ]);

    if (roomsRes.error) throw roomsRes.error;
    if (playersRes.error) throw playersRes.error;
    if (rulesRes.error) throw rulesRes.error;
    if (roundsRes.error) throw roundsRes.error;
    
    lastSyncAt = Date.now();
    setLiveHint();

    return { room: roomsRes.data, players: playersRes.data, rules: rulesRes.data, rounds: roundsRes.data };
  }

  function rulesToObj(rulesRows) {
    const o = {};
    for (const r of rulesRows) o[r.rule_key] = r.value;
    // Ensure types
    o.variants_on = !!o.variants_on;
    o.bolts_on = !!o.bolts_on;
    o.samoval_555_on = !!o.samoval_555_on;
    o.bolts_penalty = Number(o.bolts_penalty || 120);
    o.rounding = o.rounding || "none";
    o.barrel_880_on = !!o.barrel_880_on;
    o.rospis_on = !!o.rospis_on;
    o.golden_on = !!o.golden_on;
    o.match_id = (o.match_id && String(o.match_id)) || "default";
    return o;
  }

  function applyRounding(val, mode) {
    const n = Number(val || 0);
    if (mode === "none") return n;
    if (mode === "to5") return Math.round(n / 5) * 5;
    if (mode === "to10_5up") {
      // round to nearest 10, 5 rounds up
      const rem = n % 10;
      const base = n - rem;
      return rem >= 5 ? base + 10 : base;
    }
    return n;
  }

  
  // Backward-compat alias (older UI code used fetchRoomState)
  async function fetchRoomState(roomId) { return fetchState(roomId); }

function computeFromRounds(roundRows, rulesObj) {
    const order = PLAYER_KEYS.slice();
    const scores = Object.fromEntries(order.map(k => [k, 0]));
    const bolts = Object.fromEntries(order.map(k => [k, 0]));
    const barrel = Object.fromEntries(order.map(k => [k, false]));

    const matchId = (rulesObj.match_id || "default");
    const variantsOn = !!rulesObj.variants_on;

    // Build series for graph (running totals after each round in this match)
    const series = [];
    const filtered = (roundRows || [])
      .map(r => ({...r, payload: r.payload || {}}))
      .filter(r => (r.payload.match_id || "default") === matchId)
      .sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

    for (const r of filtered) {
      const p = r.payload || {};
      if (p.type === "new_match") {
        // boundary marker (keep as point for graph continuity)
        series.push({ t: r.created_at, scores: {...scores}, marker: "new_match" });
        continue;
      }

      const bidder = p.bidder;
      const bid = Number(p.bid || 0);
      const made = !!p.made;
      const rospis = variantsOn && !!rulesObj.rospis_on && !!p.rospis;
      const golden = variantsOn && !!rulesObj.golden_on && !!p.golden;
      const mult = golden ? 2 : 1;

      // points for each player (manual input)
      const pts = {};
      for (const k of order) pts[k] = Number((p.points && p.points[k]) || 0);

      // Apply rounding option to defenders (optional; only affects non-bidder points)
      const rounding = variantsOn ? (rulesObj.rounding || "none") : "none";
      function roundDef(x) {
        if (rounding === "to5") {
          return Math.round(x / 5) * 5;
        }
        if (rounding === "to10_5up") {
          // to nearest 10; 5 goes up
          const mod = ((x % 10) + 10) % 10;
          const base = x - mod;
          if (mod === 0) return x;
          if (mod < 5) return base;
          return base + 10;
        }
        return x;
      }

      // Bolts (0 tricks) tracking
      const boltsOn = variantsOn && !!rulesObj.bolts_on;
      if (boltsOn && p.bolts) {
        for (const k of order) {
          if (p.bolts[k]) bolts[k] += 1;
        }
      }

      // Samoval 555
      const samovalOn = variantsOn && !!rulesObj.samoval_555_on;

      if (rospis) {
        // bidder surrenders: −bid; others get +half each
        const half = roundDef(Math.floor(bid / 2));
        for (const k of order) {
          if (k === bidder) {
            scores[k] -= bid * mult;
          } else {
            scores[k] += half * mult;
          }
        }
      } else {
        // Contract result affects bidder by ±bid (multiplied if golden)
        if (bidder) scores[bidder] += (made ? 1 : -1) * bid * mult;

        // Add defenders' points (optionally rounded), multiplied if golden
        for (const k of order) {
          let add = pts[k];
          if (variantsOn && k !== bidder) add = roundDef(add);
          scores[k] += add * mult;
        }
      }

      // Apply 3-bolt penalty (if enabled) when someone reaches 3,6,9...
      if (boltsOn) {
        const pen = Number(rulesObj.bolts_penalty || 120);
        for (const k of order) {
          if (bolts[k] > 0 && bolts[k] % 3 === 0) {
            scores[k] -= pen;
          }
        }
      }

      // Samoval: exact 555 -> 0
      if (samovalOn) {
        for (const k of order) {
          if (scores[k] === 555) scores[k] = 0;
        }
      }

      // Barrel flag (simplified): mark if reached >= 880 at any moment
      const barrelOn = variantsOn && !!rulesObj.barrel_880_on;
      if (barrelOn) {
        for (const k of order) {
          if (!barrel[k] && scores[k] >= 880) barrel[k] = true;
        }
      }

      series.push({ t: r.created_at, scores: {...scores} });
    }

    return { scores, bolts, barrel, series, match_id: matchId };
  }

// ----- Render -----
  function renderAgree(players) {
    agreeGrid.innerHTML = "";
    const byName = Object.fromEntries((players || []).map(p => [p.name, p]));
    const agreedCount = (players || []).filter(p => p.agreed).length;

    PLAYER_KEYS.forEach(k => {
      const p = byName[PLAYER_NAMES[k]];
      const agreed = !!(p && p.agreed);
      const btn = document.createElement("button");
      btn.className = "btn " + (agreed ? "ok" : "");
      btn.textContent = agreed ? "Согласен ✅" : "Согласен";
      btn.setAttribute("data-agree", PLAYER_NAMES[k]);
      btn.disabled = agreed || (me.player_key !== k); // only you can set your consent
      agreeGrid.appendChild(btn);
    });

    // hint line
    optionsHint.textContent = agreedCount >= 3
      ? "Все согласны ✅ Если изменить варианты — начнётся новая партия."
      : "Нажмите “Согласен” каждый на своём устройстве. Изменение вариантов начнёт новую партию.";

    Array.from(agreeGrid.querySelectorAll("button")).forEach(btn => {
      btn.onclick = async () => {
        const who = btn.getAttribute("data-agree");
        await sb.from("players").update({ agreed: true }).eq("room_id", room.id).eq("name", who);
        toast("Согласие записано ✅");
      };
    });
  }

function renderScoreCards(computed, rulesObj) {
    scoreGrid.innerHTML = "";
    const scores = (computed && computed.scores) ? computed.scores : { banker: 0, risk: 0, calm: 0 };
    const bolts = (computed && computed.bolts) ? computed.bolts : { banker: 0, risk: 0, calm: 0 };
    for (const p of PLAYERS) {
      const row = { score: scores[p.key] ?? 0, bolts: bolts[p.key] ?? 0 };
      const sc = document.createElement("div");
      sc.className = "scoreCard";
      const boltText = (rulesObj.variants_on && rulesObj.bolts_on) ? ` • болты: ${row.bolts || 0}` : "";
      sc.innerHTML = `
        <div class="scoreName">${p.label}</div>
        <div class="scoreVal">${row.score ?? 0}</div>
        <div class="scoreSub">классика до 1000${boltText}</div>
      `;
      scoreGrid.appendChild(sc);
    }
  }

  function renderForm() {
    fBidder.innerHTML = PLAYERS.map(p => `<option value="${p.key}">${p.label}</option>`).join("");
    pointsInputs.innerHTML = PLAYERS.map(p => `
      <label class="field">
        <span>Очки: ${p.label}</span>
        <input type="number" step="1" id="pt_${p.key}" value="0" />
      </label>
    `).join("");
    boltInputs.innerHTML = PLAYERS.map(p => `
      <label class="boltChip">
        <input type="checkbox" id="bolt_${p.key}" />
        <span>${p.label}: 0 взяток</span>
      </label>
    `).join("");
  }

  function renderHistory(rounds) {
    historyList.innerHTML = "";
    if (!rounds.length) {
      historyList.innerHTML = `<div class="muted">Пока пусто. Добавьте первый кон.</div>`;
      return;
    }
    rounds.slice().reverse().forEach(r => {
      const p = r.payload || {};
      const who = playerLabel(p.created_by || "—");
      const time = fmtTime(r.created_at);
      const bidder = playerLabel(p.bidder || "—");
      const bid = Number(p.bid || 0);
      const made = p.made === true ? "Сыграл" : "Не сыграл";
      const pts = p.points || {};
      const bolts = p.bolts || {};
      const boltStr = Object.entries(bolts).filter(([,v])=>v).map(([k])=>playerLabel(k)).join(", ");
      const item = document.createElement("div");
      item.className = "hItem";
      item.innerHTML = `
        <div class="hTop">
          <div>
            <div class="hWho">${who}</div>
            <div class="hTime">${time}</div>
          </div>
          <div class="badge">${bidder} • ${bid} • ${made}</div>
        </div>
        <div class="hMain">Очки: Банкир ${Number(pts.banker||0)}, Рисковый ${Number(pts.risk||0)}, Невозмутимый ${Number(pts.calm||0)}</div>
        <div class="hDetails">
          ${boltStr ? ("Болт: " + boltStr) : "—"}
        </div>
      `;
      historyList.appendChild(item);
    });
  }

  function drawGraph(series) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (!series || series.length < 2) {
      ctx.fillStyle = "rgba(232,238,252,.7)";
      ctx.font = "16px system-ui";
      ctx.fillText("Пока нет данных. Добавьте первый кон.", 20, 40);
      return;
    }

    // Compute bounds
    let minY = 0, maxY = 0;
    for (const s of series) {
      for (const k of ["banker","risk","calm"]) {
        minY = Math.min(minY, s[k]);
        maxY = Math.max(maxY, s[k]);
      }
    }
    const pad = 30;
    const x0 = 40, y0 = 20, x1 = W-20, y1 = H-30;

    const n = series.length - 1;
    const sx = (i) => x0 + (x1-x0) * (n===0?0:i/n);
    const sy = (v) => {
      if (maxY === minY) return (y0+y1)/2;
      return y1 - (y1-y0) * ((v - minY) / (maxY - minY));
    };

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Label
    ctx.fillStyle = "rgba(159,177,208,.9)";
    ctx.font = "12px system-ui";
    ctx.fillText(String(maxY), 8, sy(maxY)+4);
    ctx.fillText(String(minY), 8, sy(minY)+4);

    // Colors (not configurable; subtle)
    const colors = {
      banker: "rgba(122,162,255,.95)",
      risk: "rgba(45,212,191,.95)",
      calm: "rgba(255,107,107,.9)" };

    for (const k of ["banker","risk","calm"]) {
      ctx.strokeStyle = colors[k];
      ctx.beginPath();
      for (let i=0;i<series.length;i++){
        const x = sx(i);
        const y = sy(series[i][k]);
        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();

      // points
      ctx.fillStyle = colors[k];
      for (let i=0;i<series.length;i++){
        const x = sx(i);
        const y = sy(series[i][k]);
        ctx.beginPath();
        ctx.arc(x,y,3,0,Math.PI*2);
        ctx.fill();
      }
    }

    graphHint.textContent = `Конов: ${n}. Диапазон: ${minY}…${maxY}.`;
  }

  async function maybeLockRoom() {
    const { data: players, error } = await sb.from("players").select("*").eq("room_id", room.id);
    if (error) throw error;
    const all = PLAYERS.every(p => players.some(x => x.name === p.key && x.agreed));
    if (all) {
      await sb.from("rooms").update({ locked: true }).eq("id", room.id);
    }
  }

  function renderOptions(rulesObj) {
    optVariantsOn.checked = !!rulesObj.variants_on;
    optRounding.value = rulesObj.rounding || "none";
    optBoltsOn.checked = !!rulesObj.bolts_on;
    optBoltsPenalty.value = Number(rulesObj.bolts_penalty || 120);
    opt555On.checked = !!rulesObj.samoval_555_on;
    if (optBarrelOn) optBarrelOn.checked = !!rulesObj.barrel_880_on;
    if (optRospisOn) optRospisOn.checked = !!rulesObj.rospis_on;
    if (optGoldenOn) optGoldenOn.checked = !!rulesObj.golden_on;

    variantsBody.style.display = optVariantsOn.checked ? "" : "none";
    const innerEnabled = !!optVariantsOn.checked;
    optRounding.disabled = !innerEnabled;
    optBoltsOn.disabled = !innerEnabled;
    optBoltsPenalty.disabled = !innerEnabled || !optBoltsOn.checked;
    opt555On.disabled = !innerEnabled;
    if (optBarrelOn) optBarrelOn.disabled = !innerEnabled;
    if (optRospisOn) optRospisOn.disabled = !innerEnabled;
    if (optGoldenOn) optGoldenOn.disabled = !innerEnabled;
  }

  async function saveOptions() {
    const state = await fetchRoomState(room.id);
    const oldObj = rulesToObj(state.rules);
    const newObj = {
      variants_on: !!optVariantsOn.checked,
      rounding: optRounding.value,
      bolts_on: !!optBoltsOn.checked,
      bolts_penalty: Number(optBoltsPenalty.value || 120),
      samoval_555_on: !!opt555On.checked,
      barrel_880_on: !!(optBarrelOn && optBarrelOn.checked),
      rospis_on: !!(optRospisOn && optRospisOn.checked),
      golden_on: !!(optGoldenOn && optGoldenOn.checked),
      match_id: oldObj.match_id || "default",
    };

    const keys = ["variants_on","rounding","bolts_on","bolts_penalty","samoval_555_on","barrel_880_on","rospis_on","golden_on"];
    const changed = keys.some(k => JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k]));

    const roundsInMatch = (state.rounds || []).filter(r => (r.payload?.match_id || "default") === (oldObj.match_id || "default") && r.payload?.type !== "new_match");
    if (changed && roundsInMatch.length > 0) {
      const ok = confirm("Изменение вариантов начнёт новую партию (счёт пойдёт с нуля, старая история сохранится). Продолжить?");
      if (!ok) return;

      const newMatchId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      newObj.match_id = newMatchId;

      for (const p of (state.players || [])) {
        await sb.from("players").update({ agreed: false }).eq("id", p.id);
      }

      await sb.from("rounds").insert({
        room_id: room.id,
        payload: { type: "new_match", match_id: newMatchId, by: keyToLabel(meKey), note: "Новая партия: изменены варианты", at: new Date().toISOString() } });
    }

    const payloads = [
      ["variants_on", newObj.variants_on],
      ["rounding", newObj.rounding],
      ["bolts_on", newObj.bolts_on],
      ["bolts_penalty", newObj.bolts_penalty],
      ["samoval_555_on", newObj.samoval_555_on],
      ["barrel_880_on", newObj.barrel_880_on],
      ["rospis_on", newObj.rospis_on],
      ["golden_on", newObj.golden_on],
      ["match_id", newObj.match_id],
    ];
    for (const [k,v] of payloads) {
      await sb.from("rules").upsert({ room_id: room.id, rule_key: k, value: v }, { onConflict: "room_id,rule_key" });
    }

    toast("Варианты сохранены ✅");
  }

  async function recomputeAndPersist(state) {
    const rulesObj = rulesToObj(state.rules);
    const computed = computeFromRounds(state.rounds, rulesObj);
    return { rulesObj, computed };
  }

  // ----- Realtime -----
  function clearSubs() {
    subs.forEach(s => { try { sb.removeChannel(s); } catch {} });
    subs = [];
  }

  function subscribeRoom(roomId) {
    clearSubs();
    const channel = sb.channel("room-" + roomId)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: "room_id=eq." + roomId }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "rules", filter: "room_id=eq." + roomId }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: "room_id=eq." + roomId }, () => refresh())
            .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "id=eq." + roomId }, () => refresh());
    channel.subscribe((status) => {
      setStatus(status === "SUBSCRIBED" ? "online" : status.toLowerCase());
    });
    subs.push(channel);
  }

  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 200);
  }

  async function refresh() {
    if (!room) return;
    try {
      const state = await fetchState(room.id);
      // ensure totals correct (in case another device added round)
      const { rulesObj, computed } = await recomputeAndPersist(state);

      // UI
      roomCodeLabel.textContent = state.room.code;
      meLabel.textContent = playerLabel(me);
      const agreedCount = (state.players || []).filter(p => p.agreed).length;
      lockLabel.textContent = `Согласие: ${agreedCount}/3`;
      renderAgree(state.players);
      renderOptions(rulesObj);
      renderScoreCards(computed, rulesObj);
      renderHistory(state.rounds);
      drawGraph(computed.series);

      // scoring is always available; consent is for reducing спор
      const canPlay = true;
      [btnAddRound, btnUndo].forEach(b => b.disabled = !canPlay);

      // keep variants body visible
      variantsBody.style.display = optVariantsOn.checked ? "" : "none";
      setLiveHint();
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  // ----- Actions -----
  async function joinFlow() {
    const code = (roomCodeInput.value || "").trim();
    const meKey = meSelect.value;
    if (!code) { alert("Введите код комнаты"); return; }
    me = meKey;

    try {
      setStatus("connecting…");
      room = await getOrCreateRoom(code);
      await ensureRules(room.id);
      await ensurePlayer(room.id, "banker");
      await ensurePlayer(room.id, "risk");
      await ensurePlayer(room.id, "calm");
      // ensure current player's row exists (already)
      await ensurePlayer(room.id, meKey);

      saveRecent(code);
      updateQuery(code, meKey);

      roomCodeLabel.textContent = code;
      meLabel.textContent = playerLabel(meKey);

      setView("room");
      setActiveTab("rules");

      renderForm();
      subscribeRoom(room.id);
      await refresh();

    } catch (e) {
      console.error(e);
      alert("Не получилось войти. Проверь Supabase URL/Key, RLS и Realtime.\n\n" + (e.message || e));
      setStatus("error");
    }
  }

  async function addRound() {
    try {
      if (!room) return;
      const bid = Number(fBid.value || 0);
      const bidder = fBidder.value;
      const made = fMade.value === "made";


      const wantRospis = !!(fRospis && fRospis.checked);
      const wantGolden = !!(fGolden && fGolden.checked);
      if (wantRospis && !(currentRulesObj && currentRulesObj.variants_on && currentRulesObj.rospis_on)) {
        alert("Роспись выключена в вариантах. Включите её в “Правила → Варианты”.");
        return;
      }
      if (wantGolden && !(currentRulesObj && currentRulesObj.variants_on && currentRulesObj.golden_on)) {
        alert("“Золотой кон” выключен в вариантах. Включите его в “Правила → Варианты”.");
        return;
      }


      const points = {};
      for (const p of ["banker","risk","calm"]) {
        const el = $("pt_" + p);
        points[p] = Number(el?.value || 0);
      }

      const bolts = {};
      for (const p of ["banker","risk","calm"]) {
        bolts[p] = !!$("bolt_" + p)?.checked;
      }

      const payload = {
        created_by: me,
        bidder,
        bid,
        made,
        rospis: !!(fRospis && fRospis.checked),
        golden: !!(fGolden && fGolden.checked),
        match_id: (currentRulesObj && currentRulesObj.match_id) ? currentRulesObj.match_id : "default",
        points,
        bolts,
      };

      const { error } = await sb.from("rounds").insert({ room_id: room.id, payload });
      if (error) throw error;

      showToast("Кон записан ✅");
      // Realtime will update all devices; refresh immediately for the current device
      refresh();

      // Clear inputs
      fBid.value = "";
      if (fRospis) fRospis.checked = false;
      if (fGolden) fGolden.checked = false;
      for (const p of ["banker","risk","calm"]) {
        $("pt_" + p).value = "0";
        $("bolt_" + p).checked = false;
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось записать кон. Проверь Supabase и поля ввода.\n\n" + (e?.message || e));
    }
  }

  async function undoLast() {
    const { data: last, error } = await sb.from("rounds").select("id").eq("room_id", room.id).order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    if (!last || !last.length) return;
    await sb.from("rounds").delete().eq("id", last[0].id);
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).catch(()=>{});
  }

  // ----- Events -----
  btnJoin.onclick = joinFlow;
  btnCopyLink.onclick = () => {
    const code = (roomCodeInput.value || "").trim();
    const meKey = meSelect.value;
    if (!code) { alert("Сначала впишите код комнаты"); return; }
    const url = location.origin + location.pathname + "?room=" + encodeURIComponent(code) + "&me=" + encodeURIComponent(meKey);
    copy(url);
    alert("Ссылка скопирована ✅");
  };
  btnClearRecent.onclick = () => { localStorage.removeItem(RECENT_KEY); renderRecent(); };

  btnExit.onclick = () => {
    clearSubs();
    room = null;
    updateQuery("", "");
    setView("home");
  };
  btnShare.onclick = () => {
    const url = location.origin + location.pathname + "?room=" + encodeURIComponent(room.code) + "&me=" + encodeURIComponent(me || "");
    copy(url);
    alert("Ссылка на комнату скопирована ✅");
  };

  tabButtons.forEach(b => b.onclick = () => setActiveTab(b.dataset.tab));

  btnSources.onclick = () => openSources(true);
  btnCloseSources.onclick = () => openSources(false);
  modalSources.onclick = (e) => { if (e.target === modalSources) openSources(false); };

  optVariantsOn.onchange = () => { variantsBody.style.display = optVariantsOn.checked ? "" : "none"; };
  btnSaveOptions.onclick = async () => {
    if (!room) return;
    const state = await fetchState(room.id);
    // soft consent: never blocks saving; changing options may start a new match

    try {
      await saveOptions();
      await refresh();
      alert("Сохранено ✅");
    } catch (e) {
      console.error(e);
      alert("Не удалось сохранить варианты. Проверь RLS.");
    }
  };

  btnAddRound.onclick = async () => {
    if (!room) return;
    try {
      await addRound();
    } catch (e) {
      console.error(e);
      alert("Не удалось добавить кон. Проверь RLS/Realtime.");
    }
  };

  btnUndo.onclick = async () => {
    if (!room) return;
    if (!confirm("Отменить последний кон?")) return;
    try {
      await undoLast();
    } catch (e) {
      console.error(e);
      alert("Не удалось отменить. Проверь RLS/Realtime.");
    }
  };

  // Init
  function init() {
    renderRecent();
    setView("home");
    setActiveTab("rules");
    renderForm();

    const q = getQuery();
    if (q.room) {
      roomCodeInput.value = q.room;
      if (q.me && PLAYERS.some(p => p.key === q.me)) meSelect.value = q.me;
      // auto join
      joinFlow();
    } else {
      setStatus("offline");
    }
  }

  init();
})();
