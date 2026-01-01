// app.js
/* global supabaseClient */

const RU = {
  offline: "offline",
  online: "online",
};

const PLAYERS = ["player_1","player_2","player_3"];

let state = {
  roomCode: null,
  roomId: null,
  myPlayer: "player_1",
  locked: false,
  rules: {
    rounding: "none",       // none | to5 | to10_5up
    samoval555: false,
    boltsEnabled: true,
    boltsPenalty: 120
  },
  totals: {
    player_1: { score: 0, bolts: 0 },
    player_2: { score: 0, bolts: 0 },
    player_3: { score: 0, bolts: 0 }
  },
  players: {
    player_1: false,
    player_2: false,
    player_3: false
  }
};

const el = (id) => document.getElementById(id);

function setStatus(ok, text){
  const pill = el("pillStatus");
  pill.textContent = text || (ok ? RU.online : RU.offline);
  pill.classList.toggle("ok", !!ok);
  pill.classList.toggle("bad", !ok);
}

function sanitizeCode(code){
  return (code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,32);
}

function roundingApply(val, mode){
  const x = Number(val) || 0;
  if (mode === "none") return x;
  if (mode === "to5"){
    // Round to nearest 5 (0-2 down, 3-4 up)
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const r = a % 5;
    const base = a - r;
    const out = (r <= 2) ? base : (base + 5);
    return out * sign;
  }
  if (mode === "to10_5up"){
    // Round to nearest 10 with 5 up
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const r = a % 10;
    const base = a - r;
    const out = (r < 5) ? base : (base + 10);
    return out * sign;
  }
  return x;
}

function applySamoval555(score, enabled){
  if (!enabled) return score;
  return (score === 555) ? 0 : score;
}

function fmtPlayer(p){
  return p === "player_1" ? "Игрок 1" : p === "player_2" ? "Игрок 2" : "Игрок 3";
}

async function ensureRoom(code){
  const { data: found, error: e1 } = await supabaseClient
    .from("rooms")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (e1) throw e1;
  if (found) return found;

  const { data: created, error: e2 } = await supabaseClient
    .from("rooms")
    .insert({ code })
    .select("*")
    .single();
  if (e2) throw e2;
  return created;
}

async function ensurePlayersAndTotals(room_id){
  // players
  const { data: existingPlayers, error: ep } = await supabaseClient
    .from("players")
    .select("name,agreed")
    .eq("room_id", room_id);
  if (ep) throw ep;

  const existing = new Set((existingPlayers||[]).map(x => x.name));
  const toInsert = PLAYERS.filter(p => !existing.has(p)).map(p => ({ room_id, name: p, agreed: false }));
  if (toInsert.length){
    const { error } = await supabaseClient.from("players").insert(toInsert);
    if (error) throw error;
  }

  // totals
  const { data: existingTotals, error: et } = await supabaseClient
    .from("totals")
    .select("player_name")
    .eq("room_id", room_id);
  if (et) throw et;

  const exT = new Set((existingTotals||[]).map(x => x.player_name));
  const toInsertT = PLAYERS.filter(p => !exT.has(p)).map(p => ({ room_id, player_name: p, score: 0, bolts: 0, barrel: false }));
  if (toInsertT.length){
    const { error } = await supabaseClient.from("totals").insert(toInsertT);
    if (error) throw error;
  }
}

async function ensureRules(room_id){
  const defaults = {
    rounding: state.rules.rounding,
    samoval555: state.rules.samoval555,
    boltsEnabled: state.rules.boltsEnabled,
    boltsPenalty: state.rules.boltsPenalty
  };

  const { data, error } = await supabaseClient
    .from("rules")
    .select("rule_key,value")
    .eq("room_id", room_id);
  if (error) throw error;

  const map = new Map((data||[]).map(r => [r.rule_key, r.value]));
  for (const [k,v] of Object.entries(defaults)){
    if (!map.has(k)){
      const { error: ei } = await supabaseClient.from("rules").insert({ room_id, rule_key: k, value: v });
      if (ei) throw ei;
    }
  }
}

async function loadAll(){
  // rooms
  const { data: room, error: er } = await supabaseClient
    .from("rooms")
    .select("*")
    .eq("id", state.roomId)
    .single();
  if (er) throw er;
  state.locked = !!room.locked;

  // players agree
  const { data: players, error: ep } = await supabaseClient
    .from("players")
    .select("name,agreed")
    .eq("room_id", state.roomId);
  if (ep) throw ep;
  for (const p of PLAYERS){
    const row = (players||[]).find(x => x.name === p);
    state.players[p] = row ? !!row.agreed : false;
  }

  // rules
  const { data: rules, error: erl } = await supabaseClient
    .from("rules")
    .select("rule_key,value")
    .eq("room_id", state.roomId);
  if (erl) throw erl;
  for (const r of (rules||[])){
    state.rules[r.rule_key] = r.value;
  }

  // totals
  const { data: totals, error: et } = await supabaseClient
    .from("totals")
    .select("player_name,score,bolts")
    .eq("room_id", state.roomId);
  if (et) throw et;
  for (const t of (totals||[])){
    state.totals[t.player_name] = { score: t.score, bolts: t.bolts };
  }

  await renderAll();
  await renderHistory();
}

function allAgreed(){
  return PLAYERS.every(p => state.players[p]);
}

async function renderAll(){
  el("roomMeta").textContent = "Комната: " + state.roomCode + " • Вы: " + fmtPlayer(state.myPlayer);

  // Rules UI
  el("ruleRounding").value = state.rules.rounding || "none";
  el("rule555").checked = !!state.rules.samoval555;
  el("ruleBolts").checked = (state.rules.boltsEnabled !== false);
  el("ruleBoltsPenalty").value = String(state.rules.boltsPenalty ?? 120);

  // Agree status
  el("agreeStatus").textContent =
    `Игрок 1: ${state.players.player_1 ? "✅" : "—"}  ` +
    `Игрок 2: ${state.players.player_2 ? "✅" : "—"}  ` +
    `Игрок 3: ${state.players.player_3 ? "✅" : "—"}`;

  // Lock
  el("lockStatus").textContent = state.locked ? "🔒 Закреплено" : "Открыто";

  // Disable editing when locked
  const lock = state.locked;
  el("ruleRounding").disabled = lock;
  el("rule555").disabled = lock;
  el("ruleBolts").disabled = lock;
  el("ruleBoltsPenalty").disabled = lock;
  el("btnSaveRules").disabled = lock;

  // Agree button
  el("btnAgree").disabled = state.players[state.myPlayer] || state.locked && !state.players[state.myPlayer];

  // Score
  el("s1").textContent = state.totals.player_1.score;
  el("s2").textContent = state.totals.player_2.score;
  el("s3").textContent = state.totals.player_3.score;

  el("b1").textContent = state.totals.player_1.bolts;
  el("b2").textContent = state.totals.player_2.bolts;
  el("b3").textContent = state.totals.player_3.bolts;

  // Enable add-round only when locked (so no mid-game rule changes)
  el("btnAddRound").disabled = !state.locked;
  el("btnUndo").disabled = !state.locked;
}

async function saveRules(){
  if (state.locked) return;

  const rounding = el("ruleRounding").value;
  const samoval555 = el("rule555").checked;
  const boltsEnabled = el("ruleBolts").checked;
  const boltsPenalty = Number(el("ruleBoltsPenalty").value || 120);

  const updates = [
    { rule_key: "rounding", value: rounding },
    { rule_key: "samoval555", value: samoval555 },
    { rule_key: "boltsEnabled", value: boltsEnabled },
    { rule_key: "boltsPenalty", value: boltsPenalty }
  ];

  for (const u of updates){
    const { error } = await supabaseClient
      .from("rules")
      .upsert({ room_id: state.roomId, rule_key: u.rule_key, value: u.value }, { onConflict: "room_id,rule_key" });
    if (error) throw error;
  }
}

async function setAgree(){
  const { error } = await supabaseClient
    .from("players")
    .update({ agreed: true })
    .eq("room_id", state.roomId)
    .eq("name", state.myPlayer);
  if (error) throw error;

  // lock if all agreed
  await loadAll();
  if (allAgreed() && !state.locked){
    const { error: e2 } = await supabaseClient
      .from("rooms")
      .update({ locked: true })
      .eq("id", state.roomId);
    if (e2) throw e2;
  }
}

function readRoundForm(){
  const bidder = el("bidder").value;
  const bid = Number(el("bid").value || 0);
  const made = el("made").value === "made";

  const points = {
    player_1: Number(el("p1").value || 0),
    player_2: Number(el("p2").value || 0),
    player_3: Number(el("p3").value || 0),
  };

  const bolts = {
    player_1: el("bolt1").checked,
    player_2: el("bolt2").checked,
    player_3: el("bolt3").checked,
  };

  return { bidder, bid, made, points, bolts };
}

function validateRound(r){
  if (!PLAYERS.includes(r.bidder)) return "Неверный заказчик";
  if (!Number.isFinite(r.bid) || r.bid <= 0) return "Заказ должен быть числом";
  if (r.bid % 5 !== 0) return "Заказ должен быть кратен 5";
  return null;
}

function computeDeltas(round, rules){
  // MVP: bidder gets +bid if made else -bid; others get their entered points (rounded if enabled)
  const deltas = { player_1: 0, player_2: 0, player_3: 0 };
  for (const p of PLAYERS){
    if (p === round.bidder){
      deltas[p] = round.made ? round.bid : -round.bid;
    } else {
      deltas[p] = roundingApply(round.points[p], rules.rounding || "none");
    }
  }
  return deltas;
}

function computeBoltUpdate(currentBolts, gotBolt, rules){
  if (!rules.boltsEnabled) return { bolts: currentBolts, penalty: 0 };
  let b = currentBolts + (gotBolt ? 1 : 0);
  let penalty = 0;
  const penaltyVal = Number(rules.boltsPenalty || 120);
  if (b >= 3){
    penalty = -penaltyVal;
    b = 0;
  }
  return { bolts: b, penalty };
}

async function addRound(){
  if (!state.locked) return;

  const round = readRoundForm();
  const err = validateRound(round);
  if (err) return alert(err);

  const payload = {
    v: 1,
    created_by: state.myPlayer,
    ts: new Date().toISOString(),
    bidder: round.bidder,
    bid: round.bid,
    made: round.made,
    points: round.points,
    bolts: round.bolts
  };

  const { error } = await supabaseClient.from("rounds").insert({ room_id: state.roomId, payload });
  if (error) throw error;

  // recompute totals from scratch (safe)
  await recomputeTotalsFromScratch();
  await renderHistory();
}

async function undoLastRound(){
  if (!state.locked) return;

  const { data, error } = await supabaseClient
    .from("rounds")
    .select("id,created_at")
    .eq("room_id", state.roomId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (!data || !data.length) return alert("История пуста.");

  const lastId = data[0].id;
  const { error: delErr } = await supabaseClient.from("rounds").delete().eq("id", lastId);
  if (delErr) throw delErr;

  await recomputeTotalsFromScratch();
  await renderHistory();
}

async function recomputeTotalsFromScratch(){
  // reset
  const resetRows = PLAYERS.map(p => ({ room_id: state.roomId, player_name: p, score: 0, bolts: 0, barrel: false }));
  const { error: e0 } = await supabaseClient.from("totals")
    .upsert(resetRows, { onConflict: "room_id,player_name" });
  if (e0) throw e0;

  // fetch rounds
  const { data: rounds, error: er } = await supabaseClient
    .from("rounds")
    .select("payload,created_at")
    .eq("room_id", state.roomId)
    .order("created_at", { ascending: true });
  if (er) throw er;

  // local totals
  let t = {
    player_1: { score: 0, bolts: 0 },
    player_2: { score: 0, bolts: 0 },
    player_3: { score: 0, bolts: 0 },
  };

  for (const row of (rounds||[])){
    const p = row.payload || {};
    const deltas = computeDeltas(p, state.rules);

    for (const pl of PLAYERS){
      // bolts
      const boltRes = computeBoltUpdate(t[pl].bolts, !!(p.bolts && p.bolts[pl]), state.rules);
      t[pl].bolts = boltRes.bolts;

      // score
      t[pl].score += (deltas[pl] || 0) + (boltRes.penalty || 0);
      t[pl].score = applySamoval555(t[pl].score, !!state.rules.samoval555);
    }
  }

  // write totals
  const up = PLAYERS.map(pl => ({
    room_id: state.roomId,
    player_name: pl,
    score: t[pl].score,
    bolts: t[pl].bolts,
    barrel: false
  }));

  const { error: e1 } = await supabaseClient.from("totals")
    .upsert(up, { onConflict: "room_id,player_name" });
  if (e1) throw e1;

  // refresh UI state
  await loadAll();
}

async function renderHistory(){
  const box = el("history");
  if (!box) return;

  const { data, error } = await supabaseClient
    .from("rounds")
    .select("created_at,payload")
    .eq("room_id", state.roomId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;

  box.innerHTML = "";
  for (const r of (data||[])){
    const p = r.payload;
    const when = new Date(r.created_at).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const txt = [
      `⏱ ${when}`,
      `Заказчик: ${fmtPlayer(p.bidder)} • Заказ: ${p.bid} • ${p.made ? "Сыграл ✅" : "Не сыграл ❌"}`,
      `Очки: 1=${p.points.player_1}, 2=${p.points.player_2}, 3=${p.points.player_3}`,
      `Болты: ${p.bolts.player_1 ? "1" : "-"} ${p.bolts.player_2 ? "2" : "-"} ${p.bolts.player_3 ? "3" : "-"}`
    ].join("<br/>");
    const div = document.createElement("div");
    div.className = "histItem";
    div.innerHTML = txt;
    box.appendChild(div);
  }
}

function getUrlParams(){
  const u = new URL(window.location.href);
  const code = u.searchParams.get("room") || "";
  const me = u.searchParams.get("me") || "";
  return { code, me };
}

function setUrlParams(code, me){
  const u = new URL(window.location.href);
  u.searchParams.set("room", code);
  u.searchParams.set("me", me);
  window.history.replaceState({}, "", u.toString());
}

async function subscribeRealtime(){
  // rooms lock
  supabaseClient
    .channel("room-watch-" + state.roomId)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "id=eq." + state.roomId }, async () => {
      await loadAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: "room_id=eq." + state.roomId }, async () => {
      await loadAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "rules", filter: "room_id=eq." + state.roomId }, async () => {
      await loadAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "totals", filter: "room_id=eq." + state.roomId }, async () => {
      await loadAll();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter: "room_id=eq." + state.roomId }, async () => {
      // totals recompute is done by writer; just refresh history
      await loadAll();
      await renderHistory();
    })
    .subscribe((status) => {
      setStatus(status === "SUBSCRIBED", status === "SUBSCRIBED" ? RU.online : String(status || RU.offline));
    });
}

async function joinRoomFlow(code, me){
  if (!window.supabaseClient) {
    alert("Supabase не инициализирован. Проверь supabase.js");
    return;
  }
  const room = await ensureRoom(code);
  state.roomCode = code;
  state.roomId = room.id;
  state.locked = !!room.locked;

  await ensurePlayersAndTotals(state.roomId);
  await ensureRules(state.roomId);

  // prefill UI
  el("viewRoom").style.display = "none";
  el("viewMain").style.display = "grid";

  await loadAll();
  await subscribeRealtime();

  // update URL
  setUrlParams(code, me);
}

function copyLink(){
  const u = new URL(window.location.href);
  navigator.clipboard.writeText(u.toString()).then(
    () => alert("Ссылка скопирована ✅"),
    () => alert("Не удалось скопировать. Скопируй из адресной строки.")
  );
}

function wireUI(){
  el("btnJoin").addEventListener("click", async () => {
    try {
      const code = sanitizeCode(el("roomCode").value);
      const me = el("playerSelect").value;
      if (!code) return alert("Введите код комнаты (латиница/цифры).");
      state.myPlayer = me;
      await joinRoomFlow(code, me);
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });

  el("btnCopy").addEventListener("click", () => {
    const code = sanitizeCode(el("roomCode").value) || state.roomCode;
    const me = el("playerSelect").value || state.myPlayer;
    if (code) setUrlParams(code, me);
    copyLink();
  });

  el("btnSaveRules").addEventListener("click", async () => {
    try {
      await saveRules();
      await loadAll();
      alert("Правила сохранены ✅");
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });

  el("btnAgree").addEventListener("click", async () => {
    try {
      await saveRules(); // optional: save before agree
      await setAgree();
      await loadAll();
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });

  el("btnAddRound").addEventListener("click", async () => {
    try {
      await addRound();
      // reset bolt checkboxes for convenience
      el("bolt1").checked = false;
      el("bolt2").checked = false;
      el("bolt3").checked = false;
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });

  el("btnUndo").addEventListener("click", async () => {
    try {
      if (!confirm("Отменить последний кон?")) return;
      await undoLastRound();
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });
}

async function boot(){
  wireUI();

  // URL auto-join
  const { code, me } = getUrlParams();
  if (code){
    el("roomCode").value = code;
  }
  if (me && PLAYERS.includes(me)){
    state.myPlayer = me;
    el("playerSelect").value = me;
  }

  // if URL has code, auto join
  if (code){
    try {
      await joinRoomFlow(code, state.myPlayer);
    } catch (e){
      console.error(e);
      // stay in room screen; show error softly
      setStatus(false, "config?");
    }
  } else {
    setStatus(false, RU.offline);
  }
}

window.addEventListener("DOMContentLoaded", boot);
