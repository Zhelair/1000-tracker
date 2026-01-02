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
  const btnSaveOptions = $("btnSaveOptions");
  const optionsHint = $("optionsHint");

  // Score tab
  const scoreGrid = $("scoreGrid");
  const liveHint = $("liveHint");
  const fBidder = $("fBidder");
  const fBid = $("fBid");
  const fMade = $("fMade");
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
  let activeMatchId = "m1";

  let subs = [];
  let lastSyncAt = null;

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


  function consentText(players) {
    const agreed = PLAYERS.map(p => players.find(x => x.name === p.key)).filter(Boolean).filter(x => x.agreed).length;
    return agreed >= 3 ? "✅ согласие: 3/3" : ("Согласие: " + agreed + "/3");
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
    // Soft-consent mode: options are always clickable.
    // We only visually dim "Возможные варианты" if выключено.
    [optVariantsOn, optRounding, optBoltsOn, optBoltsPenalty, opt555On, btnSaveOptions].forEach(el => {
      el.disabled = false;
    });
    optionsHint.textContent = "Правила можно менять, но это начнёт новую партию (счёт обнулится).";
    variantsBody.style.opacity = optVariantsOn.checked ? "1" : ".55";
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

  
function computeFromRounds(rounds, rulesObj) {
    // Matches (parties): derived from meta rounds {type:"meta", action:"new_match"}
    let activeMatchId = "m1";
    let matchIndex = 1;
    for (const r of rounds) {
      const p = r.payload || {};
      if (p.type === "meta" && p.action === "new_match" && p.match_id) {
        activeMatchId = p.match_id;
        matchIndex = Number(p.match_index || (matchIndex + 1)) || (matchIndex + 1);
      }
    }

    const scores = { banker: 0, risk: 0, calm: 0 };
    const bolts = { banker: 0, risk: 0, calm: 0 };
    const series = [{ ...scores }];

    // Only score rounds in active match (compat: rounds without match_id are assumed m1)
    const scoredRounds = [];
    for (const r of rounds) {
      const p = r.payload || {};
      if (p.type === "meta") continue;
      const mid = p.match_id || "m1";
      if (mid !== activeMatchId) continue;
      scoredRounds.push(r);

      const points = p.points || {};
      for (const k of ["banker","risk","calm"]) {
        let v = Number(points[k] || 0);
        if (rulesObj.variants_on && rulesObj.rounding !== "none" && k !== p.bidder) {
          v = applyRounding(v, rulesObj.rounding);
        }
        scores[k] += v;
      }

      // contract effect
      const bid = Number(p.bid || 0);
      if (p.bidder && bid > 0) {
        if (p.made) scores[p.bidder] += bid;
        else scores[p.bidder] -= bid;
      }

      // bolts (optional)
      if (rulesObj.bolts_on) {
        const b = p.bolts || {};
        for (const k of ["banker","risk","calm"]) {
          if (b[k]) bolts[k] += 1;
          if (bolts[k] >= 3) {
            scores[k] -= Number(rulesObj.bolts_penalty || 120);
            bolts[k] = 0;
          }
        }
      }

      // 555 dump (optional)
      if (rulesObj.samoval_555_on) {
        for (const k of ["banker","risk","calm"]) {
          if (scores[k] === 555) scores[k] = 0;
        }
      }

      series.push({ ...scores });
    }

    // Build history feed: show meta "new match" markers + only active match rounds
    const feed = [];
    for (const r of rounds) {
      const p = r.payload || {};
      if (p.type === "meta" && p.action === "new_match") {
        feed.push({ kind: "meta", r });
        continue;
      }
      const mid = p.match_id || "m1";
      if (mid === activeMatchId) feed.push({ kind: "round", r });
    }

    return { scores, bolts, series, activeMatchId, matchIndex, feed };
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

  
function renderHistory(feed) {
    historyList.innerHTML = "";
    if (!feed || !feed.length) {
      historyList.innerHTML = `<div class="muted">Пока пусто. Добавьте первый кон.</div>`;
      return;
    }

    const items = feed.slice().reverse();
    for (const it of items) {
      const r = it.r;
      const p = r.payload || {};
      const time = fmtTime(r.created_at);

      if (it.kind === "meta" && p.action === "new_match") {
        const who = playerLabel(p.created_by || "—");
        const block = document.createElement("div");
        block.className = "hItem";
        block.innerHTML = `
          <div class="hTop">
            <div>
              <div class="hWho">Новая партия</div>
              <div class="hTime">${time} • ${who}</div>
            </div>
            <div class="badge">Счёт с нуля</div>
          </div>
        `;
        historyList.appendChild(block);
        continue;
      }

      const who = playerLabel(p.created_by || "—");
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
          ${boltStr ? `<span class="muted">Болт: ${boltStr}</span>` : `<span class="muted">—</span>`}
        </div>
      `;
      historyList.appendChild(item);
    }
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
    // Soft-consent: no hard lock. We only display indicator.
  }

  function renderOptions(rulesObj) {
    optVariantsOn.checked = !!rulesObj.variants_on;
    optRounding.value = rulesObj.rounding || "none";
    optBoltsOn.checked = !!rulesObj.bolts_on;
    optBoltsPenalty.value = Number(rulesObj.bolts_penalty || 120);
    opt555On.checked = !!rulesObj.samoval_555_on;

    variantsBody.style.display = optVariantsOn.checked ? "" : "none";
    setOptionsEnabled(true);
  }

  
async function saveOptions() {
    if (!room) return;

    const newRules = {
      variants_on: !!optVariantsOn.checked,
      rounding: optRounding.value,
      bolts_on: !!optBoltsOn.checked,
      bolts_penalty: Number(optBoltsPenalty.value || 120),
      samoval_555_on: !!opt555On.checked,
    };

    // Compare with stored rules
    const state = await fetchState(room.id);
    const oldRules = rulesToObj(state.rules);
    const changed = JSON.stringify({
      variants_on: !!oldRules.variants_on,
      rounding: oldRules.rounding || "none",
      bolts_on: !!oldRules.bolts_on,
      bolts_penalty: Number(oldRules.bolts_penalty || 120),
      samoval_555_on: !!oldRules.samoval_555_on,
    }) !== JSON.stringify(newRules);

    if (!changed) return;

    const hasRounds = (state.rounds || []).some(r => (r.payload || {}).type !== "meta");
    if (hasRounds) {
      const ok = confirm("Правила изменятся. Это начнёт новую партию (счёт обнулится).\n\nПродолжить?");
      if (!ok) {
        // Re-render from DB to undo UI toggles
        renderOptions(oldRules);
        return;
      }
    }

    // Save rules
    const payloads = Object.entries(newRules).map(([k,v]) => [k, v]);
    for (const [k,v] of payloads) {
      const { error } = await sb.from("rules").upsert({ room_id: room.id, rule_key: k, value: v }, { onConflict: "room_id,rule_key" });
      if (error) throw error;
    }

    // Start new match if there were rounds already
    if (hasRounds) {
      await startNewMatch(newRules);
    }
  }


  
async function startNewMatch(rulesSnapshot) {
    // Reset agreements
    await sb.from("players").update({ agreed: false }).eq("room_id", room.id);

    const matchId = "m_" + Math.random().toString(36).slice(2, 10);
    const payload = {
      type: "meta",
      action: "new_match",
      match_id: matchId,
      created_by: me,
      rules: rulesSnapshot,
    };
    const { error } = await sb.from("rounds").insert({ room_id: room.id, payload });
    if (error) throw error;
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
      activeMatchId = computed.activeMatchId || "m1";

      // UI
      roomCodeLabel.textContent = state.room.code;
      meLabel.textContent = playerLabel(me);
      lockLabel.textContent = consentText(state.players);
      renderAgree(state.players);
      renderOptions(rulesObj);
      renderScoreCards(computed, rulesObj);
      renderHistory(computed.feed);
      drawGraph(computed.series);

      // enable/disable scoring based on lock
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
        type: "round",
        match_id: activeMatchId || "m1",
        created_by: me,
        bidder,
        bid,
        made,
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
    // soft-consent: always allow saving options
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