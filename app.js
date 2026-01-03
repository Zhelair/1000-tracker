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
const PLAYER_NAMES = Object.fromEntries(PLAYERS.map(p => [p.key, p.label]));

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

  const escapeHtml = (s) => String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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
  const btnResetGame = $("btnResetGame");

  // Win modal
  const modalWin = $("modalWin");
  const winTitle = $("winTitle");
  const winBody = $("winBody");
  const btnWinClose = $("btnWinClose");
  const btnWinNew = $("btnWinNew");

  // Event modal (barrel/bolts/555/etc)
  const modalEvent = $("modalEvent");
  const eventTitle = $("eventTitle");
  const eventBody = $("eventBody");
  const btnEventClose = $("btnEventClose");

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
  // Rounding was removed (peace mode): users enter final scores manually.
  const optRounding = null;
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
  const goldenHint = $("goldenHint");
  const fBidder = $("fBidder");
  const fBid = $("fBid");
  const fMade = $("fMade");
  const fRospis = $("fRospis");
  const fGolden = $("fGolden");
  const bidPrev = $("bidPrev");
  const bidNext = $("bidNext");
  const bidderPill = $("bidderPill");

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
  let pollTimer = null;
  let isRefreshing = false;

  let gameLocked = false;
  let winShownMatchId = null;
  let lastEventShownId = null;

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

  function myName() {
    return (me && PLAYER_NAMES[me]) ? PLAYER_NAMES[me] : "";
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

  function openWin(open) {
    if (!modalWin) return;
    modalWin.style.display = open ? "" : "none";
  }

  function openEvent(open) {
    if (!modalEvent) return;
    modalEvent.style.display = open ? "" : "none";
  }

  function setOptionsEnabled(enabled) {
    // enabled = can edit (not locked)
    [optVariantsOn, optBoltsOn, optBoltsPenalty, opt555On, btnSaveOptions]
      .filter(Boolean)
      .forEach(el => { el.disabled = !enabled; });
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
    // Barrel: per-player state
    const barrelOn = Object.fromEntries(order.map(k => [k, false]));
    const barrelCount = Object.fromEntries(order.map(k => [k, 0]));

    // Golden kon tracker (match-level): completed when bidder (заказчик) makes >=120 in a round
    let goldenKonCompleted = false;
    let goldenKonAttempts = 0;
    let goldenKonCompletedAt = null; // {attempt, bidderKey, bid}


    const matchId = (rulesObj.match_id || "default");
    const variantsOn = !!rulesObj.variants_on;

    // Build series for graph (running totals after each round in this match)
    // Shape: { t, banker, risk, calm, marker? }
    const series = [];
    const filtered = (roundRows || [])
      .map(r => ({ ...r, payload: r.payload || {} }))
      .filter(r => (r.payload.match_id || "default") === matchId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let winnerKey = null;
    let lastEvents = null; // { id, items: [...] }

    const eventsByRow = {};
    let roundNo = 0;

    for (const r of filtered) {
      const p = r.payload || {};

      if (p.type === "new_match") {
        series.push({ t: r.created_at, banker: scores.banker, risk: scores.risk, calm: scores.calm, marker: "new_match" });
        continue;
      }

      if (p.type && p.type !== "score") {
        // ignore consent / misc events
        continue;
      }

      roundNo += 1;
      const rowIdKey = (r.id || r.created_at);
      const ev = { round_no: roundNo, bolts_three: [], barrel_enter: [], barrel_plus: [], barrel_three: [], samoval: [], golden_complete: null };

      // Snapshot scores BEFORE applying this round (needed for barrel rule)
      const prevScores = { ...scores };

      const bidder = p.bidder;
      const bid = Number(p.bid || 0);
      const made = !!p.made;

      // Golden kon tracker: count attempts until bidder makes >=120
      const goldenKonOn = variantsOn;
      const goldenKonEvents = { attempt: null, completed: null, ongoing: false };
      if (goldenKonOn && !goldenKonCompleted) {
        goldenKonAttempts += 1;
        goldenKonEvents.attempt = goldenKonAttempts;
        if (bidder && made && bid >= 120) {
          goldenKonCompleted = true;
          goldenKonCompletedAt = { attempt: goldenKonAttempts, bidderKey: bidder, bid };
          goldenKonEvents.completed = { attempt: goldenKonAttempts, bidderKey: bidder, bid };
        } else {
          goldenKonEvents.ongoing = true;
        }
      }

      const rospis = variantsOn && !!rulesObj.rospis_on && !!p.rospis;
      const golden = variantsOn && !!rulesObj.golden_on && !!p.golden;
      const mult = golden ? 2 : 1;

      // points for each player (manual input)
      const pts = {};
      for (const k of order) pts[k] = Number((p.points && p.points[k]) || 0);

      // Rounding removed (peace mode): users enter final scores manually.

      // Bolts (0 tricks) tracking
      const boltsEvents = { plus: [], three: [] };
      const boltsOn = variantsOn && !!rulesObj.bolts_on;
      if (boltsOn && p.bolts) {
        for (const k of order) {
          if (p.bolts[k]) bolts[k] += 1;
        }
      }

      // Samoval 555
      ev.samoval = (samovalEvents || []).slice();
      const samovalEvents = [];
      const samovalOn = variantsOn && !!rulesObj.samoval_555_on;

      if (rospis) {
        // bidder surrenders: −bid; others get +half each
        const half = Math.floor(bid / 2);
        for (const k of order) {
          if (k === bidder) scores[k] -= bid * mult;
          else scores[k] += half * mult;
        }
      } else {
        // Contract result affects bidder by ±bid (multiplied if golden)
        if (bidder) scores[bidder] += (made ? 1 : -1) * bid * mult;

        // Add manual points (multiplied if golden)
        for (const k of order) {
          scores[k] += pts[k] * mult;
        }
      }

      // 3-bolt rule: when someone reaches 3 bolts -> penalty once -> reset bolts to 0
      if (boltsOn) {
        const pen = Number(rulesObj.bolts_penalty || 120);
        for (const k of order) {
          if (bolts[k] >= 3) {
            scores[k] -= pen;
            boltsEvents.three.push({ key: k, pen });
            bolts[k] = 0;
          }
        }
      }

      // Samoval: exact 555 -> 0
      if (samovalOn) {
        for (const k of order) {
          if (scores[k] === 555) { samovalEvents.push(k); scores[k] = 0; }
        }
      }

      // Barrel (880) rule (family mode): multiple players can be on barrel.
      // +1 barrel when player is already on barrel AND their score DECREASED in this round.
      // At 3 barrels: -120, reset barrels to 0, exit barrel.
      const barrelRuleOn = variantsOn && !!rulesObj.barrel_880_on;
      const barrelEvents = { enter: [], plus: [], three: [] };
      if (barrelRuleOn) {
        // Enter barrel (only if not already on barrel)
        for (const k of order) {
          if (!barrelOn[k] && scores[k] >= 880 && scores[k] < 1000) {
            barrelOn[k] = true;
            barrelCount[k] = 1;
            barrelEvents.enter.push({ key: k, count: 1 });
            barrelEvents.enter.push(k);
          }
        }

        // +1 barrel on decrease OR 0 tricks ("не взял ни одной")
        for (const k of order) {
          if (!barrelOn[k]) continue;
          // do not count after game is already won
          if (scores[k] >= 1000) continue;
          const zeroTricks = !!(p.bolts && p.bolts[k]);
          if (scores[k] < prevScores[k] || zeroTricks) {
            barrelCount[k] = (barrelCount[k] || 0) + 1;
            barrelEvents.plus.push({ key: k, count: barrelCount[k] });
            if (barrelCount[k] >= 3) {
              scores[k] -= 120;
              barrelCount[k] = 0;
              barrelOn[k] = false;
              barrelEvents.three.push(k);
            }
          }
        }
      }

      // Win condition: hard cap to 1000 and stop processing further rounds
      for (const k of order) {
        if (scores[k] >= 1000 && !winnerKey) winnerKey = k;
        if (scores[k] > 1000) scores[k] = 1000;
      }
      if (winnerKey) scores[winnerKey] = 1000;

      const point = { t: r.created_at, banker: scores.banker, risk: scores.risk, calm: scores.calm };

      // Attach per-round events for graph markers
      const evObj = {};
      if (barrelEvents.enter.length || barrelEvents.plus.length || barrelEvents.three.length) evObj.barrel = barrelEvents;
      if (boltsEvents.plus.length || boltsEvents.three.length) evObj.bolts = boltsEvents;
      if (samovalEvents.length) evObj.samoval = { hit: samovalEvents };
      if (goldenKonOn && (goldenKonEvents.ongoing || goldenKonEvents.completed)) evObj.golden = goldenKonEvents;
      if (Object.keys(evObj).length) point.events = evObj;

      // Build a single modal payload for the last triggering round (major events only)
      const modalItems = [];

      // Golden kon: show modal on completion, and show a one-time modal if still ongoing after attempt #1
      if (goldenKonEvents.completed) {
        ev.golden_complete = goldenKonEvents.completed;
        modalItems.push(`✨ Золотой кон завершён (попытка #${goldenKonEvents.completed.attempt}): ${playerLabel(goldenKonEvents.completed.bidderKey)} сыграл ${goldenKonEvents.completed.bid}`);
      } else if (goldenKonEvents.ongoing && goldenKonEvents.attempt === 1) {
        modalItems.push(`✨ Золотой кон продолжается: пока никто не сыграл 120+ (попытка #1)`);
      }

      // Barrel messages
      ev.barrel_enter = (barrelEvents.enter || []).filter(x => x && typeof x === "object");
      ev.barrel_plus = (barrelEvents.plus || []).filter(x => x && typeof x === "object");
      ev.barrel_three = (barrelEvents.three || []).slice();
      (barrelEvents.enter || []).forEach(e => modalItems.push(`🛢 На бочке 1/3: ${playerLabel(e.key)}`));
      (barrelEvents.plus || []).forEach(x => modalItems.push(`🛢 Бочка ${x.count}/3: ${playerLabel(x.key)}`));
      (barrelEvents.three || []).forEach(k => modalItems.push(`💥 3 бочки: ${playerLabel(k)} — штраф −120, бочки сброшены`));

      // Bolts: show when penalty triggers
      ev.bolts_three = (boltsEvents.three || []).slice();
      (boltsEvents.three || []).forEach(x => modalItems.push(`🔩 3 болта: ${playerLabel(x.key)} — штраф −${x.pen}, болты сброшены`));

      // Samoval 555
      (samovalEvents || []).forEach(k => modalItems.push(`🚛 Самосвал 555: ${playerLabel(k)} — 555→0`));

      if (modalItems.length) {
        lastEvents = { id: `events:${r.id || r.created_at}`, title: "События", items: modalItems };
      }

      eventsByRow[rowIdKey] = ev;
      series.push(point);

      if (winnerKey) break;
    }

    return {
      scores,
      bolts,
      barrel_on: barrelOn,
      barrel_count: barrelCount,
      series,
      match_id: matchId,
      golden_kon_attempts: goldenKonAttempts,
      golden_kon_completed: goldenKonCompleted,
      golden_kon_completed_at: goldenKonCompletedAt,
      winner: winnerKey,
      last_events: lastEvents,
      events_by_row: eventsByRow,
    };
  }

// ----- Render -----
  function getAgreeSet(rounds, matchId) {
    const set = new Set();
    (rounds || []).forEach(r => {
      const p = r.payload || {};
      if (p.match_id !== matchId) return;
      if (p.type === "consent_all") {
        // everyone agreed for this match
        PLAYERS.forEach(pl => set.add(pl.label));
      } else if (p.type === "consent" && p.who) {
        set.add(p.who);
      }
    });
    return set;
  }

  function renderAgree(state, rulesObj) {
    agreeGrid.innerHTML = "";

    const matchId = (rulesObj && rulesObj.match_id) ? rulesObj.match_id : "default";
    const agreedSet = getAgreeSet(state.rounds, matchId);

    // status rows
    PLAYERS.forEach(p => {
      const row = document.createElement("div");
      row.className = "agreeRow";
      const left = document.createElement("div");
      left.className = "agreeName";
      left.textContent = p.label;

      const right = document.createElement("div");
      right.className = "agreeState " + (agreedSet.has(p.label) ? "on" : "off");
      right.textContent = agreedSet.has(p.label) ? "✅" : "—";

      row.appendChild(left);
      row.appendChild(right);
      agreeGrid.appendChild(row);
    });

    // actions
    const actions = document.createElement("div");
    actions.className = "agreeActions";

    const btnMe = document.createElement("button");
    btnMe.className = "btn primary";
    const my = myName();
    btnMe.textContent = agreedSet.has(my) ? "Вы уже согласны ✅" : "Я согласен ✅";
    btnMe.disabled = !my || agreedSet.has(my);

    btnMe.onclick = async () => {
      try {
        const my = myName();
        if (!my) return;
        await sb.from("rounds").insert({
          room_id: room.id,
          payload: { type: "consent", match_id: matchId, who: my, by: my, at: new Date().toISOString() }
        });
        showToast("Согласие записано ✅");
      } catch (e) {
        console.error(e);
        showToast("Не удалось записать согласие");
      }
    };

    // Gusary toggle (local only)
    const gusaryWrap = document.createElement("label");
    gusaryWrap.className = "gusaryLine";
    const gusary = document.createElement("input");
    gusary.type = "checkbox";
    gusary.id = "optGusary";
    gusary.checked = localStorage.getItem("gusary_mode") === "1";
    gusary.onchange = () => localStorage.setItem("gusary_mode", gusary.checked ? "1" : "0");

    const gusaryText = document.createElement("span");
    gusaryText.textContent = "🐴🎺 Вперёд, Гусары";

    gusaryWrap.appendChild(gusary);
    gusaryWrap.appendChild(gusaryText);

    const gusaryHint = document.createElement("div");
    gusaryHint.className = "muted small";
    gusaryHint.textContent = "Используйте, если все за столом уже согласны и не хотите ждать кликов.";

    const btnAll = document.createElement("button");
    btnAll.className = "btn";
    btnAll.textContent = "🎺 Подтвердить за всех";
    btnAll.style.display = gusary.checked ? "" : "none";
    btnAll.disabled = agreedSet.size >= 3;

    gusary.addEventListener("change", () => {
      btnAll.style.display = gusary.checked ? "" : "none";
    });

    btnAll.onclick = async () => {
      try {
        await sb.from("rounds").insert({
          room_id: room.id,
          payload: { type: "consent_all", match_id: matchId, by: myName() || "someone", at: new Date().toISOString() }
        });
        showToast("Гусары подтвердили ✅");
      } catch (e) {
        console.error(e);
        showToast("Не удалось подтвердить");
      }
    };

    actions.appendChild(btnMe);
    actions.appendChild(gusaryWrap);
    actions.appendChild(gusaryHint);
    actions.appendChild(btnAll);

    agreeGrid.appendChild(actions);

    const agreedCount = agreedSet.size;
    optionsHint.textContent = agreedCount >= 3
      ? "Все согласны ✅ Если изменить варианты — начнётся новая партия."
      : "Нажмите “Я согласен” каждый на своём устройстве. Изменение вариантов начнёт новую партию.";
  }

function renderScoreCards(computed, rulesObj) {
    scoreGrid.innerHTML = "";
    const scores = (computed && computed.scores) ? computed.scores : { banker: 0, risk: 0, calm: 0 };
    const bolts = (computed && computed.bolts) ? computed.bolts : { banker: 0, risk: 0, calm: 0 };
    const barrelOn = (computed && computed.barrel_on) ? computed.barrel_on : { banker: false, risk: false, calm: false };
    const barrelCount = (computed && computed.barrel_count) ? computed.barrel_count : { banker: 0, risk: 0, calm: 0 };
    for (const p of PLAYERS) {
      const row = { score: scores[p.key] ?? 0, bolts: bolts[p.key] ?? 0 };
      const sc = document.createElement("div");
      sc.className = "scoreCard";
      const boltText = (rulesObj.variants_on && rulesObj.bolts_on) ? ` • болты: ${row.bolts || 0}` : "";
      const barrelText = (rulesObj.variants_on && rulesObj.barrel_880_on && barrelOn[p.key])
        ? ` • 🛢 бочки: ${Number(barrelCount[p.key] || 0)}/3`
        : "";
      const barrelBadge = (rulesObj.variants_on && rulesObj.barrel_880_on && barrelOn[p.key])
        ? `<span class="chip" title="Игрок на бочке">🛢 На бочке</span>`
        : "";
      sc.innerHTML = `
        <div class="scoreName">${p.label} ${barrelBadge}</div>
        <div class="scoreVal">${row.score ?? 0}</div>
        <div class="scoreSub">классика до 1000${boltText}${barrelText}</div>
      `;
      scoreGrid.appendChild(sc);
    }
  }

  function renderForm() {
    fBidder.innerHTML = PLAYERS.map(p => `<option value="${p.key}">${p.label}</option>`).join("");
    pointsInputs.innerHTML = PLAYERS.map(p => `
      <label class="field">
        <span>Очки: ${p.label} <span class="readyPill" id="ready_${p.key}" style="display:none">Готово ✅</span></span>
        <input type="number" step="1" id="pt_${p.key}" value="" placeholder="например 120" />
      </label>
    `).join("");
    boltInputs.innerHTML = PLAYERS.map(p => `
      <label class="boltChip">
        <input type="checkbox" id="bolt_${p.key}" />
        <span>${p.label}: 0 взяток</span>
      </label>
    `).join("");

    // Attach draft listeners
    for (const k of PLAYER_KEYS) {
      const pt = $("pt_" + k);
      const bolt = $("bolt_" + k);
      if (pt) pt.oninput = updateDraftStatus;
      if (bolt) bolt.onchange = updateDraftStatus;
    }

    bidPrev && (bidPrev.onclick = () => shiftBidder(-1));
    bidNext && (bidNext.onclick = () => shiftBidder(+1));

    updateDraftStatus();
  }

  function setBidderUI(key) {
    if (!fBidder) return;
    fBidder.value = key;
    if (bidderPill) bidderPill.textContent = playerLabel(key);
  }

  function shiftBidder(dir) {
    const cur = fBidder.value || PLAYER_KEYS[0];
    const idx = PLAYER_KEYS.indexOf(cur);
    const next = PLAYER_KEYS[(idx + dir + PLAYER_KEYS.length) % PLAYER_KEYS.length];
    bidderOverride = next;
    setBidderUI(next);
  }

  function isPlayerEntered(k) {
    const pt = $("pt_" + k);
    const bolt = $("bolt_" + k);
    const hasPoints = pt && String(pt.value || "").trim() !== "";
    const hasZero = bolt && bolt.checked;
    // points OR 0-взяток counts as entered
    return hasPoints || hasZero;
  }

  function updateDraftStatus() {
    if (!btnAddRound) return;
    const readyKeys = PLAYER_KEYS.filter(isPlayerEntered);
    const readyCount = readyKeys.length;

    for (const k of PLAYER_KEYS) {
      const pill = $("ready_" + k);
      if (!pill) continue;
      pill.style.display = isPlayerEntered(k) ? "inline-flex" : "none";
    }

    const canCommit = (readyCount === PLAYER_KEYS.length) && !gameLocked;
    btnAddRound.disabled = !canCommit;
    btnAddRound.textContent = canCommit ? "Зафиксировать раунд" : `Заполните всех игроков: ${readyCount}/${PLAYER_KEYS.length}`;
  }


function renderHistory(rounds, computed, rulesObj) {
    historyList.innerHTML = "";
    if (!rounds.length) {
      historyList.innerHTML = `<div class="muted">Пока пусто. Добавьте первый кон.</div>`;
      return;
    }

    // Summary (current state)
    if (computed && computed.scores) {
      const scores = computed.scores;
      const bolts = computed.bolts || {};
      const bc = computed.barrel_count || {};
      const bon = computed.barrel_on || {};
      const parts = PLAYERS.map(p2 => {
        const btxt = (rulesObj && rulesObj.variants_on && rulesObj.bolts_on) ? `🔩 ${bolts[p2.key] || 0}` : "";
        const bartxt = (rulesObj && rulesObj.variants_on && rulesObj.barrel_880_on) ? `🛢 ${(bc[p2.key] || 0)}/3${bon[p2.key] ? "" : ""}` : "";
        return `<div class="hsRow"><div class="hsName">${p2.label}</div><div class="hsVal">${scores[p2.key] ?? 0}</div><div class="hsMeta">${[btxt,bartxt].filter(Boolean).join(" • ") || "—"}</div></div>`;
      }).join("");
      const goldenLine = (rulesObj && rulesObj.variants_on && rulesObj.golden_on)
        ? (computed.golden_kon_completed
            ? `✨ Золотой кон завершён (попытка #${computed.golden_kon_completed_at?.attempt || "?"})`
            : `✨ Золотой кон: попытка #${computed.golden_kon_attempts || 0}`)
        : "";
      const sum = document.createElement("div");
      sum.className = "hSummary";
      sum.innerHTML = `<div class="hsTitle">Текущее состояние</div>${parts}${goldenLine ? `<div class="hsFoot">${goldenLine}</div>` : ""}`;
      historyList.appendChild(sum);
    }

    rounds.slice().reverse().forEach(r => {
      const p = r.payload || {};
      if (p.type === "new_match") {
        const item = document.createElement("div");
        item.className = "hItem";
        const time = fmtTime(r.created_at);
        item.innerHTML = `
          <div class="hTop">
            <div>
              <div class="hWho">${playerLabel(p.by || p.created_by || "—")}</div>
              <div class="hTime">${time}</div>
            </div>
            <div class="badge">Новая игра</div>
          </div>
          <div class="hMain">${p.note || "Новая партия"}</div>
          <div class="hDetails">—</div>
        `;
        historyList.appendChild(item);
        return;
      }
      const who = playerLabel(p.created_by || "—");
      const time = fmtTime(r.created_at);
      const bidder = playerLabel(p.bidder || "—");
      const bid = Number(p.bid || 0);
      const made = p.made === true ? "Сыграл" : "Не сыграл";
      const pts = p.points || {};
      const bolts = p.bolts || {};
      const boltStr = Object.entries(bolts).filter(([,v])=>v).map(([k])=>playerLabel(k)).join(", ");

      const evKey = (r.id || r.created_at);
      const ev = (computed && computed.events_by_row) ? computed.events_by_row[evKey] : null;
      const roundNo = ev && ev.round_no ? ev.round_no : null;

      const badges = [];
      if (ev) {
        if (ev.golden_complete) {
          badges.push(`✨ Золотой кон завершён (раунд #${roundNo || "?"})`);
        }
        (ev.samoval || []).forEach(k => badges.push(`🚛 555→0: ${playerLabel(k)}`));
        (ev.bolts_three || []).forEach(x => badges.push(`🔩 3 болта: ${playerLabel(x.key)} −${x.pen}`));
        (ev.barrel_three || []).forEach(k => badges.push(`💥 3 бочки: ${playerLabel(k)} −120`));
        (ev.barrel_plus || []).forEach(x => badges.push(`🛢 Бочка ${x.count}/3: ${playerLabel(x.key)}`));
      }

      const item = document.createElement("div");
      item.className = "hItem";
      item.innerHTML = `
        <div class="hTop">
          <div>
            <div class="hWho">${who}</div>
            <div class="hTime">${time}</div>
          </div>
          <div class="badge">${roundNo ? ("Раунд #" + roundNo + " • ") : ""}${bidder} • ${bid} • ${made}</div>
        </div>
        <div class="hMain">Очки: Банкир ${Number(pts.banker||0)}, Рисковый ${Number(pts.risk||0)}, Невозмутимый ${Number(pts.calm||0)}</div>
        <div class="hDetails">
          ${[boltStr ? ("0 взяток: " + boltStr) : "", badges.length ? badges.join(" • ") : ""].filter(Boolean).join("<br>") || "—"}
        </div>
      `;
      historyList.appendChild(item);
    });
  }

  function drawGraph(series) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (!series || series.length < 2) {
      ctx.fillStyle = "rgba(232,238,252,.7)";
      ctx.font = "16px system-ui";
      ctx.fillText("Пока нет данных. Добавьте первый кон.", 20, 40);
      return;
    }

    // Bounds for "1000" game: always top at 1000, allow negatives
    const maxY = 1000;
    const vals = [];
    for (const p of series) { vals.push(p.banker||0, p.risk||0, p.calm||0); }
    const minVal = Math.min.apply(null, vals);
    const minY = (minVal < 0) ? (Math.floor(minVal / 100) * 100) : 0;

    const x0 = 40, y0 = 20, x1 = W - 20, y1 = H - 30;
    const n = series.length - 1;

    const sx = (i) => x0 + (x1 - x0) * (n === 0 ? 0 : i / n);
    const sy = (v) => y1 - (y1 - y0) * ((v - minY) / (maxY - minY));

    // Grid lines every 100
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.fillStyle = "rgba(159,177,208,.85)";
    ctx.font = "11px system-ui";
    ctx.setLineDash([]);
    for (let y = 0; y <= 1000; y += 100) {
      const yy = sy(y);
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
      if (y % 200 === 0) ctx.fillText(String(y), 8, yy + 4);
    }

    // Reference line at 880 (barrel)
    const yBarrel = sy(880);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(232,238,252,.25)";
    ctx.beginPath();
    ctx.moveTo(x0, yBarrel);
    ctx.lineTo(x1, yBarrel);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(232,238,252,.75)";
    ctx.font = "11px system-ui";
    ctx.fillText("🛢 880", 8, yBarrel + 4);

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    const colors = {
      banker: "rgba(122,162,255,.95)",
      risk: "rgba(45,212,191,.95)",
      calm: "rgba(255,107,107,.9)"
    };

    // New match markers (vertical dashed lines)
    for (let i = 0; i < series.length; i++) {
      if (series[i].marker === "new_match") {
        const x = sx(i);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(232,238,252,.35)";
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const k of ["banker", "risk", "calm"]) {
      ctx.strokeStyle = colors[k];
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < series.length; i++) {
        const v = Number(series[i][k] ?? 0);
        const x = sx(i);
        const y = sy(Math.max(minY, Math.min(maxY, v)));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = colors[k];
      for (let i = 0; i < series.length; i++) {
        const v = Number(series[i][k] ?? 0);
        const x = sx(i);
        const y = sy(Math.max(minY, Math.min(maxY, v)));
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Barrel event markers (emoji) — helps explain “why score dropped / moved”
    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(232,238,252,.9)";
    for (let i = 0; i < series.length; i++) {
      const all = series[i].events || {};
      const evBar = all.barrel;
      const evBol = all.bolts;
      const evSam = all.samoval;
      const evGold = all.golden;
      if (!evBar && !evBol && !evSam && !evGold) continue;

      // draw marker near the affected player's point
      const drawAt = (playerKey, text) => {
        const v = Number(series[i][playerKey] ?? 0);
        const x = sx(i);
        const y = sy(Math.max(minY, Math.min(maxY, v)));
        ctx.fillText(text, x + 6, y - 6);
      };

      if (evBar) {
        (evBar.enter || []).forEach(e => drawAt(e.key, "🛢1"));
        (evBar.plus || []).forEach(x => drawAt(x.key, "🛢" + x.count));
        (evBar.three || []).forEach(pk => drawAt(pk, "💥"));
      }

      if (evBol) {
        // show bolt penalty
        (evBol.three || []).forEach(x => drawAt(x.key, "🔩"));
      }

      if (evSam) {
        (evSam.hit || []).forEach(k => drawAt(k, "🚛"));
      }

      if (evGold) {
        if (evGold.completed) drawAt(evGold.completed.bidderKey, "✨");
      }
    }

    // Legend (small)
    const lx = x1 - 165, ly = y0 + 6, lw = 150, lh = 52;
    ctx.fillStyle = "rgba(15,23,42,.55)";
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.rect(lx, ly, lw, lh);
    ctx.fill();
    ctx.stroke();

    const items = [
      ["banker", PLAYER_NAMES.banker],
      ["risk", PLAYER_NAMES.risk],
      ["calm", PLAYER_NAMES.calm]
    ];
    ctx.font = "12px system-ui";
    items.forEach((it, idx) => {
      const key = it[0], label = it[1];
      const yy = ly + 18 + idx * 16;
      ctx.strokeStyle = colors[key];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lx + 10, yy);
      ctx.lineTo(lx + 26, yy);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(232,238,252,.9)";
      ctx.fillText(label, lx + 34, yy + 4);
    });

    graphHint.textContent = `Конов: ${n}. Шкала: 0…1000.`;
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
    optBoltsOn.checked = !!rulesObj.bolts_on;
    optBoltsPenalty.value = Number(rulesObj.bolts_penalty || 120);
    opt555On.checked = !!rulesObj.samoval_555_on;
    if (optBarrelOn) optBarrelOn.checked = !!rulesObj.barrel_880_on;
    if (optRospisOn) optRospisOn.checked = !!rulesObj.rospis_on;
    if (optGoldenOn) optGoldenOn.checked = !!rulesObj.golden_on;

    variantsBody.style.display = optVariantsOn.checked ? "" : "none";
    const innerEnabled = !!optVariantsOn.checked;
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
      bolts_on: !!optBoltsOn.checked,
      bolts_penalty: Number(optBoltsPenalty.value || 120),
      samoval_555_on: !!opt555On.checked,
      barrel_880_on: !!(optBarrelOn && optBarrelOn.checked),
      rospis_on: !!(optRospisOn && optRospisOn.checked),
      golden_on: !!(optGoldenOn && optGoldenOn.checked),
      match_id: oldObj.match_id || "default",
    };

    const keys = ["variants_on","bolts_on","bolts_penalty","samoval_555_on","barrel_880_on","rospis_on","golden_on"];
    const changed = keys.some(k => JSON.stringify(oldObj[k]) !== JSON.stringify(newObj[k]));

    const roundsInMatch = (state.rounds || []).filter(r => (r.payload?.match_id || "default") === (oldObj.match_id || "default") && r.payload?.type !== "new_match");
    if (changed && roundsInMatch.length > 0) {
      const ok = confirm("Изменение вариантов начнёт новую партию (счёт пойдёт с нуля, старая история сохранится). Продолжить?");
      if (!ok) return;

      const newMatchId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      newObj.match_id = newMatchId;
      await sb.from("rounds").insert({
        room_id: room.id,
        payload: { type: "new_match", match_id: newMatchId, by: playerLabel(me), note: "Новая партия: изменены варианты", at: new Date().toISOString() } });
    }

    const payloads = [
      ["variants_on", newObj.variants_on],
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

    showToast("Варианты сохранены ✅");
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
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const state = await fetchState(room.id);
      // ensure totals correct (in case another device added round)
      const { rulesObj, computed } = await recomputeAndPersist(state);
      // Make latest rules available to addRound() (match_id + enabled variants).
      currentRulesObj = rulesObj;

      // UI
      roomCodeLabel.textContent = state.room.code;
      meLabel.textContent = playerLabel(me);
      const agreedSet = getAgreeSet(state.rounds, rulesObj.match_id || "default");
      const agreedCount = agreedSet.size;
      lockLabel.textContent = `Согласие: ${agreedCount}/3`;
      renderAgree(state, rulesObj);
      renderOptions(rulesObj);
      renderScoreCards(computed, rulesObj);
      // Auto-rotate bidder per round (resets to Banker on new match)
      try {
        const defBidder = bidderOverride || getDefaultBidderKey(state.rounds, rulesObj.match_id || "default");
        if (!bidderOverride) bidderOverride = null; // keep null so it follows rotation
        setBidderUI(defBidder);
      } catch (e) { /* noop */ }

      // Golden kon status (match-level)
      if (goldenHint) {
        if (rulesObj.variants_on) {
          if (!computed.golden_kon_completed) {
            goldenHint.textContent = `✨ Золотой кон: попытка #${computed.golden_kon_attempts} — ждём 120+ от заказчика`;
          } else {
            const g = computed.golden_kon_completed_at;
            const who = g && g.bidderKey ? playerLabel(g.bidderKey) : "";
            const bidv = g && g.bid ? g.bid : "";
            const at = g && g.attempt ? g.attempt : "";
            goldenHint.textContent = `✨ Золотой кон: завершён (кон #${at}) ${who} ${bidv}`;
          }
        } else {
          goldenHint.textContent = "";
        }
      }

      renderHistory(state.rounds, computed, rulesObj);
      drawGraph(computed.series);

      // Lock game when someone reaches 1000 (hard cap)
      const winnerKey = computed && computed.winner ? computed.winner : null;
      gameLocked = !!winnerKey;
      updateDraftStatus();

      const canPlay = !gameLocked;
      [btnAddRound, btnUndo].forEach(b => b.disabled = !canPlay);

      [fBidder, fBid, fMade, fRospis, fGolden].forEach(el => { if (el) el.disabled = !canPlay; });
      for (const p of ["banker","risk","calm"]) {
        const pt = $("pt_" + p);
        const bl = $("bolt_" + p);
        if (pt) pt.disabled = !canPlay;
        if (bl) bl.disabled = !canPlay;
      }

      if (gameLocked && (winShownMatchId !== rulesObj.match_id)) {
        winShownMatchId = rulesObj.match_id;
        if (winTitle) winTitle.textContent = "🏆 Игра окончена";
        if (winBody) winBody.textContent = `Победил: ${playerLabel(winnerKey)} — 1000`;
        openWin(true);
      }

      // Barrel event popups (only show once per event id)
      const ev = computed && computed.last_events ? computed.last_events : null;
      if (ev && ev.id) {
        const key = `tt_lastEvent_${room.id}_${rulesObj.match_id}`;
        const already = localStorage.getItem(key);
        if (already !== ev.id && lastEventShownId !== ev.id) {
          lastEventShownId = ev.id;
          localStorage.setItem(key, ev.id);
          if (eventTitle) eventTitle.textContent = ev.title || "События";
          if (eventBody) eventBody.innerHTML = (ev.items || []).map(x => `<div>${escapeHtml(x)}</div>`).join("");
          openEvent(true);
        }
      }

      // keep variants body visible
      variantsBody.style.display = optVariantsOn.checked ? "" : "none";
      setLiveHint();
    } catch (e) {
      console.error(e);
      setStatus("error");
    } finally {
      isRefreshing = false;
    }
  }

  function startPolling() {
    stopPolling();
    // "Tonight-safe" refresh: works even if realtime drops (incognito, mobile, etc.)
    pollTimer = setInterval(() => {
      if (!room) return;
      refresh();
    }, 2500);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
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
      startPolling();
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
      if (gameLocked) { showToast("Игра окончена — начните новую"); return; }
      // Require all 3 players entered (points OR 0 tricks)
      const ready = PLAYER_KEYS.filter(isPlayerEntered);
      if (ready.length !== PLAYER_KEYS.length) {
        updateDraftStatus();
        alert(`Заполните всех игроков: ${ready.length}/${PLAYER_KEYS.length}`);
        return;
      }
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
        $("pt_" + p).value = "";
        $("bolt_" + p).checked = false;
      }
      bidderOverride = null;
      updateDraftStatus();
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
  async function resetGame(reason = "Сброс игры") {
    bidderOverride = null;
    if (!room) return;
    const newMatchId = (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));

    // Update match_id rule
    await sb.from("rules").upsert(
      { room_id: room.id, rule_key: "match_id", value: newMatchId },
      { onConflict: "room_id,rule_key" }
    );

    // Insert marker round (for history + graph)
    await sb.from("rounds").insert({
      room_id: room.id,
      payload: { type: "new_match", match_id: newMatchId, by: playerLabel(me), note: reason, at: new Date().toISOString() }
    });

    // Reset local win modal state
    winShownMatchId = null;
    gameLocked = false;
    openWin(false);
    showToast("Новая игра ✅");
    refresh();
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

  btnResetGame && (btnResetGame.onclick = async () => {
    if (!room) return;
    const ok = confirm("Сбросить текущую игру и начать новую партию? (История сохранится.)");
    if (!ok) return;
    try {
      await resetGame("Сброс игры вручную");
    } catch (e) {
      console.error(e);
      alert("Не удалось сбросить игру. Проверь Supabase/RLS.");
    }
  });

  btnWinClose && (btnWinClose.onclick = () => openWin(false));
  btnWinNew && (btnWinNew.onclick = async () => {
    try { await resetGame("Новая игра (после победы)"); } catch (e) { console.error(e); }
  });
  modalWin && (modalWin.onclick = (e) => { if (e.target === modalWin) openWin(false); });

  btnEventClose && (btnEventClose.onclick = () => openEvent(false));
  modalEvent && (modalEvent.onclick = (e) => { if (e.target === modalEvent) openEvent(false); });

  btnExit.onclick = () => {
    clearSubs();
    stopPolling();
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
