
// marriages state
let marriages = { spades:0, clubs:0, diamonds:0, hearts:0 };

function initMarriages(){
  document.querySelectorAll(".marriage").forEach(btn => {
    btn.addEventListener("click", () => {
      const suit = btn.dataset.suit;
      const val = parseInt(btn.dataset.value,10);
      if (marriages[suit]) {
        marriages[suit] = 0;
        btn.classList.remove("active");
      } else {
        marriages[suit] = val;
        btn.classList.add("active");
      }
    });
  });
}

function sumMarriages(){
  return Object.values(marriages).reduce((a,b)=>a+b,0);
}


// rangeLiveInit
function initRangeLive(){
  [["p1","v1"],["p2","v2"],["p3","v3"]].forEach(([pid,vid])=>{
    const r=document.getElementById(pid);
    const v=document.getElementById(vid);
    if(r && v){
      v.textContent = r.value;
      r.addEventListener("input", ()=> v.textContent = r.value);
    }
  });
}

// app.js
/* global supabaseClient */

const PLAYERS = ["player_1","player_2","player_3"];
const SOURCES = {
  mail: "https://minigames.mail.ru/info/article/pravila_tysjacha",
  pagat: "https://www.pagat.com/marriage/1000.html",
  wiki: "https://ru.wikipedia.org/wiki/%D0%A2%D1%8B%D1%81%D1%8F%D1%87%D0%B0_(%D0%BA%D0%B0%D1%80%D1%82%D0%BE%D1%87%D0%BD%D0%B0%D1%8F_%D0%B8%D0%B3%D1%80%D0%B0)"
};

let state = {
  roomCode: null,
  roomId: null,
  myPlayer: "player_1",
  locked: false,
  rules: {
    rounding: "none",
    samoval555: false,
    boltsEnabled: true,
    boltsPenalty: 120
  },
  players: { player_1: false, player_2: false, player_3: false },
  totals: {
    player_1: { score: 0, bolts: 0 },
    player_2: { score: 0, bolts: 0 },
    player_3: { score: 0, bolts: 0 }
  }
};

const el = (id) => document.getElementById(id);

function setStatus(ok, text){
  const pill = el("pillStatus");
  pill.textContent = text || (ok ? "online" : "offline");
  pill.classList.toggle("ok", !!ok);
  pill.classList.toggle("bad", !ok);
}

function sanitizeCode(code){
  return (code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g,"").slice(0,32);
}

function fmtPlayer(p){
  return p === "player_1" ? "Банкир" : p === "player_2" ? "Рисковый" : "Невозмутимый";
}

function setUrlParams(code, me){
  const u = new URL(window.location.href);
  u.searchParams.set("room", code);
  u.searchParams.set("me", me);
  window.history.replaceState({}, "", u.toString());
}

function getUrlParams(){
  const u = new URL(window.location.href);
  return { code: u.searchParams.get("room") || "", me: u.searchParams.get("me") || "" ,
  marriages: sumMarriages()
};
}

function copyLink(){
  navigator.clipboard.writeText(window.location.href).then(
    () => alert("Ссылка скопирована ✅"),
    () => alert("Не удалось скопировать. Скопируй из адресной строки.")
  );
}

function allAgreed(){ return PLAYERS.every(p => state.players[p]); }

function roundingApply(val, mode){
  const x = Number(val) || 0;
  if (mode === "none") return x;
  if (mode === "to5"){
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const r = a % 5;
    const base = a - r;
    const out = (r <= 2) ? base : (base + 5);
    return out * sign;
  }
  if (mode === "to10_5up"){
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
  const { data: room, error: er } = await supabaseClient
    .from("rooms")
    .select("*")
    .eq("id", state.roomId)
    .single();
  if (er) throw er;
  state.locked = !!room.locked;

  const { data: players, error: ep } = await supabaseClient
    .from("players")
    .select("name,agreed")
    .eq("room_id", state.roomId);
  if (ep) throw ep;
  for (const p of PLAYERS){
    const row = (players||[]).find(x => x.name === p);
    state.players[p] = row ? !!row.agreed : false;
  }

  const { data: rules, error: erl } = await supabaseClient
    .from("rules")
    .select("rule_key,value")
    .eq("room_id", state.roomId);
  if (erl) throw erl;
  for (const r of (rules||[])){
    state.rules[r.rule_key] = r.value;
  }

  const { data: totals, error: et } = await supabaseClient
    .from("totals")
    .select("player_name,score,bolts")
    .eq("room_id", state.roomId);
  if (et) throw et;
  for (const t of (totals||[])){
    state.totals[t.player_name] = { score: t.score, bolts: t.bolts };
  }

  renderAll();
}

function renderAll(){
  el("roomBadge").textContent = state.roomCode ? ("#" + state.roomCode) : "—";
  el("roomMeta").textContent = `Комната: ${state.roomCode} • Вы: ${fmtPlayer(state.myPlayer)}`;

  // rules UI
  el("ruleRounding").value = state.rules.rounding || "none";
  el("rule555").checked = !!state.rules.samoval555;
  el("ruleBolts").checked = (state.rules.boltsEnabled !== false);
  el("ruleBoltsPenalty").value = String(state.rules.boltsPenalty ?? 120);

  // agreement + lock
  el("agreeStatus").textContent =
    `Банкир: ${state.players.player_1 ? "✅" : "—"}  ` +
    `Рисковый: ${state.players.player_2 ? "✅" : "—"}  ` +
    `Невозмутимый: ${state.players.player_3 ? "✅" : "—"}`;

  el("lockStatus").textContent = state.locked ? "🔒 Закреплено" : "🔓 Открыто";

  // lock editing
  const lock = state.locked;
  el("ruleRounding").disabled = lock;
  el("rule555").disabled = lock;
  el("ruleBolts").disabled = lock;
  el("ruleBoltsPenalty").disabled = lock;
  el("btnSaveRules").disabled = lock;

  el("btnAgree").disabled = state.players[state.myPlayer] || (lock && !state.players[state.myPlayer]);

  // score
  el("s1").textContent = state.totals.player_1.score;
  el("s2").textContent = state.totals.player_2.score;
  el("s3").textContent = state.totals.player_3.score;

  el("b1").textContent = state.totals.player_1.bolts;
  el("b2").textContent = state.totals.player_2.bolts;
  el("b3").textContent = state.totals.player_3.bolts;

  // enable scoring only when locked
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

  await loadAll();
  if (allAgreed() && !state.locked){
    const { error: e2 } = await supabaseClient
      .from("rooms")
      .update({ locked: true })
      .eq("id", state.roomId);
    if (e2) throw e2;
    await loadAll();
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

  await recomputeTotalsFromScratch();
  await renderHistory();
  await renderChart();
  // reset bolt checkboxes for convenience
  el("bolt1").checked = false; el("bolt2").checked = false; el("bolt3").checked = false;
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
  await renderChart();
}

async function recomputeTotalsFromScratch(){
  const resetRows = PLAYERS.map(p => ({ room_id: state.roomId, player_name: p, score: 0, bolts: 0, barrel: false }));
  const { error: e0 } = await supabaseClient.from("totals")
    .upsert(resetRows, { onConflict: "room_id,player_name" });
  if (e0) throw e0;

  const { data: rounds, error: er } = await supabaseClient
    .from("rounds")
    .select("payload,created_at")
    .eq("room_id", state.roomId)
    .order("created_at", { ascending: true });
  if (er) throw er;

  let t = {
    player_1: { score: 0, bolts: 0 },
    player_2: { score: 0, bolts: 0 },
    player_3: { score: 0, bolts: 0 },
  };

  for (const row of (rounds||[])){
    const p = row.payload || {};
    const deltas = computeDeltas(p, state.rules);

    for (const pl of PLAYERS){
      const boltRes = computeBoltUpdate(t[pl].bolts, !!(p.bolts && p.bolts[pl]), state.rules);
      t[pl].bolts = boltRes.bolts;
      t[pl].score += (deltas[pl] || 0) + (boltRes.penalty || 0);
      t[pl].score = applySamoval555(t[pl].score, !!state.rules.samoval555);
    }
  }

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
    .limit(50);
  if (error) throw error;

  box.innerHTML = "";
  for (const r of (data||[])){
    const p = r.payload;
    const when = new Date(r.created_at).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day:"2-digit", month:"2-digit" });
    const div = document.createElement("div");
    div.className = "histItem";
    div.innerHTML = `
      <div class="histRow">
        <div class="kpi">⏱ ${when}</div>
        <div class="tag">Заказчик: ${fmtPlayer(p.bidder)} • ${p.made ? "Сыграл ✅" : "Не сыграл ❌"} • заказ ${p.bid}</div>
      </div>
      <div class="muted" style="margin-top:8px;">
        Очки: 1=${p.points.player_1}, 2=${p.points.player_2}, 3=${p.points.player_3} •
        Болты: ${p.bolts.player_1 ? "1" : "-"} ${p.bolts.player_2 ? "2" : "-"} ${p.bolts.player_3 ? "3" : "-"}
      </div>
    `;
    box.appendChild(div);
  }
}

function svgEl(name){ return document.createElementNS("http://www.w3.org/2000/svg", name); }

async function renderChart(){
  const svg = el("chart");
  if (!svg) return;
  svg.innerHTML = "";

  const { data: rounds, error } = await supabaseClient
    .from("rounds")
    .select("payload,created_at")
    .eq("room_id", state.roomId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const points = [{ p1:0,p2:0,p3:0 }];
  let s1=0,s2=0,s3=0, b1=0,b2=0,b3=0;

  for (const row of (rounds||[])){
    const p = row.payload;
    const deltas = computeDeltas(p, state.rules);

    const br1 = computeBoltUpdate(b1, !!p.bolts.player_1, state.rules); b1 = br1.bolts; s1 += deltas.player_1 + br1.penalty; s1 = applySamoval555(s1, !!state.rules.samoval555);
    const br2 = computeBoltUpdate(b2, !!p.bolts.player_2, state.rules); b2 = br2.bolts; s2 += deltas.player_2 + br2.penalty; s2 = applySamoval555(s2, !!state.rules.samoval555);
    const br3 = computeBoltUpdate(b3, !!p.bolts.player_3, state.rules); b3 = br3.bolts; s3 += deltas.player_3 + br3.penalty; s3 = applySamoval555(s3, !!state.rules.samoval555);

    points.push({ p1:s1, p2:s2, p3:s3 });
  }

  const W = 900, H = 320, pad = 30;
  const maxV = Math.max(1000, ...points.flatMap(p=>[p.p1,p.p2,p.p3]));
  const minV = Math.min(0, ...points.flatMap(p=>[p.p1,p.p2,p.p3]));
  const range = (maxV - minV) || 1;

  const x = (i)=> pad + (W-2*pad) * (i/(points.length-1 || 1));
  const y = (v)=> pad + (H-2*pad) * (1 - ((v - minV)/range));

  // grid lines
  for (let i=0;i<=4;i++){
    const v = minV + (range * (i/4));
    const line = svgEl("line");
    line.setAttribute("x1", pad);
    line.setAttribute("x2", W-pad);
    line.setAttribute("y1", y(v));
    line.setAttribute("y2", y(v));
    line.setAttribute("stroke", "#243447");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);

    const t = svgEl("text");
    t.textContent = String(Math.round(v));
    t.setAttribute("x", 6);
    t.setAttribute("y", y(v)+4);
    t.setAttribute("fill", "#a9b6c6");
    t.setAttribute("font-size", "10");
    svg.appendChild(t);
  }

  function makePath(key, stroke){
    const path = svgEl("path");
    let d = "";
    for (let i=0;i<points.length;i++){
      const v = points[i][key];
      d += (i===0 ? "M" : "L") + x(i) + " " + y(v) + " ";
    }
    path.setAttribute("d", d.trim());
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "3");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
  }

  makePath("p1", "#4f83ff");
  makePath("p2", "#22c55e");
  makePath("p3", "#f59e0b");

  // last points
  const last = points.length-1;
  [["p1","#4f83ff"],["p2","#22c55e"],["p3","#f59e0b"]].forEach(([k,c])=>{
    const dot = svgEl("circle");
    dot.setAttribute("cx", x(last));
    dot.setAttribute("cy", y(points[last][k]));
    dot.setAttribute("r", "4.5");
    dot.setAttribute("fill", c);
    svg.appendChild(dot);
  });
}

function showHome(){
  el("viewHome").style.display = "flex";
  el("viewApp").style.display = "none";
  el("roomBadge").textContent = "—";
}

function showApp(){
  el("viewHome").style.display = "none";
  el("viewApp").style.display = "flex";
}

function switchTab(name){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
}

function recentKey(){ return "tt_1000_recent_rooms_v1"; }

function loadRecent(){
  try { return JSON.parse(localStorage.getItem(recentKey()) || "[]"); } catch { return []; }
}
function saveRecent(list){
  localStorage.setItem(recentKey(), JSON.stringify(list.slice(0,10)));
}
function addRecent(code){
  const list = loadRecent().filter(x => x.code !== code);
  list.unshift({ code, ts: new Date().toISOString() });
  saveRecent(list);
  renderRecent();
}
function renderRecent(){
  const box = el("recentRooms");
  if (!box) return;
  const list = loadRecent();
  box.innerHTML = "";
  if (!list.length){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Пока пусто. Создай комнату — она появится здесь.";
    box.appendChild(empty);
    return;
  }
  for (const item of list){
    const row = document.createElement("div");
    row.className = "recentItem";
    const dt = new Date(item.ts);
    const when = dt.toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
    row.innerHTML = `
      <div class="left">
        <div class="recentCode">#${item.code}</div>
        <div class="recentMeta">${when}</div>
      </div>
      <div class="recentActions">
        <button class="btn tiny" data-open="${item.code}">Открыть</button>
      </div>
    `;
    row.querySelector("[data-open]").addEventListener("click", async () => {
      el("roomCode").value = item.code;
      const me = el("playerSelect").value;
      await joinFlow(item.code, me);
    });
    box.appendChild(row);
  }
}

async function subscribeRealtime(){
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
      await loadAll();
      await renderHistory();
      await renderChart();
    })
    .subscribe((status) => {
      setStatus(status === "SUBSCRIBED", status === "SUBSCRIBED" ? "online" : String(status || "offline"));
    });
}

async function joinFlow(code, me){
  if (!window.supabaseClient){
    alert("Supabase не инициализирован. Проверь supabase.js");
    return;
  }
  const clean = sanitizeCode(code);
  if (!clean) return alert("Введите код комнаты (латиница/цифры).");

  state.myPlayer = me;
  const room = await ensureRoom(clean);
  state.roomCode = clean;
  state.roomId = room.id;

  await ensurePlayersAndTotals(state.roomId);
  await ensureRules(state.roomId);

  addRecent(clean);

  showApp();
  switchTab("rules");

  await loadAll();
  await renderHistory();
  await renderChart();
  await subscribeRealtime();

  setUrlParams(clean, me);
}

function modal(show){
  const m = el("modalSources");
  m.classList.toggle("show", !!show);
  m.setAttribute("aria-hidden", show ? "false" : "true");
}

function wireUI(){
  // tabs
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // home actions
  el("btnJoin").addEventListener("click", async () => {
    try {
      const code = el("roomCode").value;
      const me = el("playerSelect").value;
      await joinFlow(code, me);
    } catch (e){
      console.error(e);
      alert("Ошибка: " + (e.message || e));
    }
  });

  el("btnCopy").addEventListener("click", () => {
    const code = sanitizeCode(el("roomCode").value);
    const me = el("playerSelect").value;
    if (code) setUrlParams(code, me);
    copyLink();
  });

  el("btnClearRecent").addEventListener("click", () => {
    localStorage.removeItem(recentKey());
    renderRecent();
  });

  // rules actions
  el("btnSaveRules").addEventListener("click", async () => {
    try {
      await saveRules();
      await loadAll();
      alert("Правила сохранены ✅");
    } catch (e){ console.error(e); alert("Ошибка: " + (e.message || e)); }
  });

  el("btnAgree").addEventListener("click", async () => {
    try {
      await saveRules();
      await setAgree();
      await loadAll();
    } catch (e){ console.error(e); alert("Ошибка: " + (e.message || e)); }
  });

  el("btnShare").addEventListener("click", () => copyLink());

  
let previewDeltas = null;

function showPreview(d){
  previewDeltas = d;
  const _pv1=document.getElementById("pv1"); if(_pv1) _pv1.textContent = d.player_1;
  const _pv2=document.getElementById("pv2"); if(_pv2) _pv2.textContent = d.player_2;
  const _pv3=document.getElementById("pv3"); if(_pv3) _pv3.textContent = d.player_3;
  const _p=document.getElementById("preview"); if(_p){ _p.style.display="block"; } else { alert("Не найден блок предпросмотра. Обновите страницу (Ctrl+Shift+R) и проверьте, что файлы обновлены."); }
}

function hidePreview(){
  previewDeltas = null;
  const _p=document.getElementById("preview"); if(_p) _p.style.display="none";
}

async function countRound(){
  const round = readRoundForm();
  const err = validateRound(round);
  if (err) return alert(err);
  const deltas = computeDeltas(round, state.rules);
  showPreview(deltas);
}

// scoring actions
  el("btnCount").addEventListener("click", async () => {
    try { await countRound(); } catch (e){ console.error(e); alert("Ошибка: " + (e.message || e)); }
  });

  el("btnUndo").addEventListener("click", async () => {
    try {
      if (!confirm("Отменить последний кон?")) return;
      await undoLastRound();
    } catch (e){ console.error(e); alert("Ошибка: " + (e.message || e)); }
  });

  // sources modal
  el("srcMail").href = SOURCES.mail;
  el("srcPagat").href = SOURCES.pagat;
  el("srcWiki").href = SOURCES.wiki;

  el("btnSources").addEventListener("click", () => modal(true));
  el("btnCloseSources").addEventListener("click", () => modal(false));
  el("modalBackdrop").addEventListener("click", () => modal(false));
}

async function boot(){
  wireUI();
  renderRecent();

  const { code, me } = getUrlParams();
  if (me && PLAYERS.includes(me)){
    state.myPlayer = me;
    el("playerSelect").value = me;
  }
  if (code){
    el("roomCode").value = code;
    try {
      await joinFlow(code, state.myPlayer);
    } catch (e){
      console.error(e);
      setStatus(false, "config?");
      showHome();
    }
  } else {
    setStatus(false, "offline");
    showHome();
  }
}


["p1","p2","p3"].forEach((id, i) => {
  const r = document.getElementById(id);
  const v = document.getElementById("v" + (i+1));
  if (r && v) {
    v.textContent = r.value;
    r.addEventListener("input", () => v.textContent = r.value);
  }
});


el("btnConfirm")?.addEventListener("click", async () => {
  try {
    await addRound();
    hidePreview();
  } catch (e){ console.error(e); alert("Ошибка: " + (e.message || e)); }
});

el("btnBack")?.addEventListener("click", () => hidePreview());

window.addEventListener("DOMContentLoaded", () => { initRangeLive(); initMarriages(); boot(); });
