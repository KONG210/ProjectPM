// ต้องโหลด config.js และ admin.js ก่อน (ใช้ levels, regionNames, levelLabels, ADMIN)
const $ = id => document.getElementById(id);
const levelOf = v => levels.find(l => v <= l[0]);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const cell = v => `<td><span class="chip" style="background:${levelOf(v)[1]}">${v.toFixed(1)}</span></td>`;

const state = { prov: "", dist: "", sub: "", metric: "now", asc: false }; // asc = อันดับเรียงจากฝุ่นน้อยสุด
let geoInfo = null; // ตำแหน่งล่าสุดจากปุ่ม "ใช้ตำแหน่งของฉัน" + ตำบลใกล้เคียง
const cache = new Map();
let seq = 0; // กันผลลัพธ์เก่าเขียนทับผลใหม่เมื่อเปลี่ยนตัวกรองเร็ว ๆ

// ---------- แผนที่ ----------
const map = L.map("map").setView([13.0, 101.0], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  { attribution: "© OpenStreetMap", maxZoom: 12 }).addTo(map); // โทนจางทำใน CSS (.leaflet-tile-pane)

if (typeof Chart !== "undefined") {
  Chart.defaults.color = "#4a5b6b";
  Chart.defaults.borderColor = "rgba(16,32,47,.1)";
  Chart.defaults.font.family = "Anuphan, sans-serif";
}
const layer = L.layerGroup().addTo(map);
const youLayer = L.layerGroup().addTo(map); // ตำแหน่งที่เบราว์เซอร์ระบุ + วงความแม่นยำ

$("legend").innerHTML = levels.map(l => `<span class="chip" style="background:${l[1]}">${l[2]}</span>`).join("");

// ---------- ตัวกรอง ----------
// แสดงชื่อที่เลือกอยู่ในช่องพิมพ์ทั้ง 3 ช่อง
function syncInputs() {
  const { prov: p, dist: d, sub: s } = state;
  $("prov").value = p === "" ? "" : ADMIN[p][0];
  $("dist").value = d === "" ? "" : ADMIN[p][4][d][0];
  $("sub").value = s === "" ? "" : ADMIN[p][4][d][3][s][0];
  $("dist").disabled = p === ""; $("sub").disabled = d === "";
}

// ตั้งตัวกรองทั้ง 3 ระดับพร้อมกัน แล้วโหลดครั้งเดียว (ค่าว่าง "" = ทั้งหมด)
function go(p, d, s, geo = false) {
  Object.assign(state, { prov: p, dist: d, sub: s, geo }); // geo = มาจากปุ่ม "ใช้ตำแหน่งของฉัน"
  writeHash();
  syncInputs();
  load();
}
// ลิงก์แชร์: เก็บพื้นที่ที่เลือกไว้ใน #hash เช่น #p=เชียงใหม่&d=เมืองเชียงใหม่
function writeHash() {
  const q = new URLSearchParams(), { prov: p, dist: d, sub: s } = state;
  if (p !== "") { q.set("p", ADMIN[p][0]); if (d !== "") { q.set("d", ADMIN[p][4][d][0]); if (s !== "") q.set("s", ADMIN[p][4][d][3][s][0]); } }
  try { history.replaceState(null, "", q.toString() ? "#" + q : location.href.split("#")[0]); } catch (e) { /* บางเบราว์เซอร์บล็อกบน file:// ไม่กระทบการใช้งาน */ }
}
function fromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const i = ADMIN.findIndex(p => p[0] === q.get("p"));
  if (i < 0) return go("", "", "");
  const j = ADMIN[i][4].findIndex(a => a[0] === q.get("d"));
  if (j < 0) return go(String(i), "", "");
  const k = ADMIN[i][4][j][3].findIndex(x => x[0] === q.get("s"));
  go(String(i), String(j), k < 0 ? "" : String(k));
}
window.onhashchange = fromHash; // วางลิงก์ใหม่ในแท็บเดิม
$("copy").onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); }
  catch (e) { const t = document.createElement("textarea"); t.value = location.href; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  const b = $("copy"); b.textContent = "คัดลอกแล้ว ✓"; setTimeout(() => b.textContent = "คัดลอกลิงก์", 1500);
};
const setProv = v => go(v, "", "");
const setDist = v => go(state.prov, v, "");

// ---------- ใช้ตำแหน่งของฉัน: หาตำบลที่ใกล้ที่สุดแล้วไปที่ตำบลนั้น ----------
$("locate").onclick = () => {
  const msg = t => { $("here").hidden = false; $("here").textContent = t; };
  if (!navigator.geolocation) return msg("เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง ลองพิมพ์ค้นหาชื่อตำบลแทน");
  msg("กำลังหาตำแหน่งของคุณ...");
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: la, longitude: lo } = pos.coords, cos = Math.cos(la * Math.PI / 180);
    const list = [];
    ADMIN.forEach((p, i) => p[4].forEach((a, j) => a[3].forEach((s, k) =>
      list.push([((s[2] - lo) * cos) ** 2 + (s[1] - la) ** 2, i, j, k]))));  // ระยะแบบประมาณ พอสำหรับเรียงตำบลใกล้สุด
    list.sort((x, y) => x[0] - y[0]);
    const near = list.slice(0, 4).map(([d, i, j, k]) => ({ km: Math.sqrt(d) * 111, at: [String(i), String(j), String(k)] }));
    if (near[0].km > 40) return msg(`ตำแหน่งของคุณห่างจากตำบลที่ใกล้ที่สุดในข้อมูลราว ${Math.round(near[0].km)} กม. (อาจอยู่นอกประเทศไทย)`);
    geoInfo = { la, lo, acc: pos.coords.accuracy, near };
    go(...near[0].at, true);
  }, err => msg(err.code === 1
    ? "เบราว์เซอร์ไม่อนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งของหน้านี้ในการตั้งค่าเบราว์เซอร์ หรือพิมพ์ค้นหาชื่อตำบลแทน"
    : "หาตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง หรือพิมพ์ค้นหาชื่อตำบลแทน"), { timeout: 10000, maximumAge: 300000 });
};

// ช่องพิมพ์ + รายการแนะนำ: คลิกเห็นทั้งหมด พิมพ์เพื่อกรอง ลบจนว่างเท่ากับเลือก "ทั้งหมด"
function combo(id, items, pick, clear) {
  const input = $(id), ul = $(id + "-list");
  let list = [];
  const show = all => {
    const q = all ? "" : input.value.trim();
    list = items().map((n, i) => [n, i]).filter(x => x[0].includes(q));
    ul.innerHTML = list.map(x => `<li data-i="${x[1]}">${x[0]}</li>`).join("");
    ul.hidden = !list.length;
  };
  const choose = i => { ul.hidden = true; input.blur(); pick(String(i)); };
  input.onfocus = () => { input.select(); show(true); };
  input.oninput = () => { if (input.value === "") clear(); show(false); };
  input.onkeydown = e => {
    if (e.key === "Enter" && list.length) choose(list[0][1]);
    if (e.key === "Escape") input.blur();
  };
  input.onblur = () => { ul.hidden = true; syncInputs(); }; // พิมพ์ค้างแต่ไม่ได้เลือก -> คืนค่าเดิม
  ul.onmousedown = e => { const li = e.target.closest("li"); if (li) choose(li.dataset.i); }; // ก่อน blur
}
combo("prov", () => ADMIN.map(p => p[0]), v => go(v, "", ""), () => go("", "", ""));
combo("dist", () => state.prov === "" ? [] : ADMIN[state.prov][4].map(a => a[0]),
  v => go(state.prov, v, ""), () => go(state.prov, "", ""));
combo("sub", () => state.dist === "" ? [] : ADMIN[state.prov][4][state.dist][3].map(s => s[0]),
  v => go(state.prov, state.dist, v), () => go(state.prov, state.dist, ""));

// ---------- ค้นหา ----------
// รายการค้นหาทั้งหมด (~8,000 รายการ สร้างครั้งเดียว)
const searchIndex = [];
ADMIN.forEach((p, i) => {
  searchIndex.push({ name: p[0], path: "จังหวัด", at: [String(i), "", ""] });
  p[4].forEach((a, j) => {
    searchIndex.push({ name: a[0], path: `อำเภอ/เขต · ${p[0]}`, at: [String(i), String(j), ""] });
    a[3].forEach((s, k) => searchIndex.push({ name: s[0], path: `ตำบล/แขวง · ${a[0]} · ${p[0]}`, at: [String(i), String(j), String(k)] }));
  });
});

function search(q) {
  q = q.trim();
  if (!q) return [];
  const starts = [], has = [];
  for (const e of searchIndex) {
    const k = e.name.indexOf(q);
    if (k === 0) starts.push(e); else if (k > 0) has.push(e);
    if (starts.length >= 10) break;
  }
  return starts.concat(has).slice(0, 10);
}

let hits = [];
function showHits() {
  hits = search($("q").value);
  $("hits").innerHTML = hits.map((h, i) => `<li data-i="${i}"><b>${h.name}</b><small>${h.path}</small></li>`).join("");
  $("hits").hidden = !hits.length;
}
function pick(i) {
  go(...hits[i].at);
  $("q").value = hits[i].name;
  $("hits").hidden = true;
}
$("q").oninput = showHits;
$("q").onfocus = showHits;
$("q").onkeydown = e => {
  if (e.key === "Enter" && hits.length) pick(0);
  if (e.key === "Escape") $("hits").hidden = true;
};
$("hits").onmousedown = e => { const li = e.target.closest("li"); if (li) pick(+li.dataset.i); }; // mousedown ก่อน blur
$("q").onblur = () => $("hits").hidden = true;
$("reset").onclick = () => { $("q").value = ""; setProv(""); };
document.querySelectorAll("#rankdir button").forEach(b => b.onclick = () => {
  state.asc = b.dataset.d === "asc";
  document.querySelectorAll("#rankdir button").forEach(x => x.classList.toggle("on", x === b));
  if (rows.length) { render(); }
});
document.querySelectorAll("#metric button").forEach(b => b.onclick = () => {
  state.metric = b.dataset.m;
  document.querySelectorAll("#metric button").forEach(x => x.classList.toggle("on", x === b));
  if (rows.length) render();
});

// จุดที่ต้องแสดงตามตัวกรองปัจจุบัน -> {name, lat, lon, region?, drill}
function currentPoints() {
  const { prov, dist, sub } = state;
  if (prov === "") return { level: 0, pts: ADMIN.map((p, i) => ({ name: p[0], region: p[1], lat: p[2], lon: p[3], drill: () => setProv(String(i)) })) };
  const P = ADMIN[prov];
  if (dist === "") return { level: 1, pts: P[4].map((a, i) => ({ name: a[0], lat: a[1], lon: a[2], drill: () => setDist(String(i)) })) };
  const D = P[4][dist];
  const subs = sub === "" ? D[3] : [D[3][sub]];
  return { level: 2, pts: subs.map((s, i) => ({ name: s[0], lat: s[1], lon: s[2],
    drill: () => go(prov, dist, String(sub === "" ? i : sub)) })) };
}

// ---------- ดึงข้อมูล + คำนวณ ----------
let rows = [], levelNow = 0;

// ปัดพิกัดเป็นกริด 0.1° (กริดเดิมของ Open-Meteo) แล้วยิงเฉพาะช่องที่ไม่ซ้ำ ลดโควตา API
// จุดที่อยู่ช่องเดียวกันได้ผลชุดเดียวกัน แล้วแจกกลับตามลำดับเดิม
async function fetchRows(pts) {
  const snap = x => (Math.round(x * 10) / 10).toFixed(1);
  const keys = pts.map(p => snap(p.lat) + "," + snap(p.lon));
  const uniq = [...new Set(keys)], ck = uniq.join(";");
  if (!cache.has(ck)) {
    const [la, lo] = [0, 1].map(i => uniq.map(k => k.split(",")[i]).join(","));
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality"
      + `?latitude=${la}&longitude=${lo}`
      + "&current=pm2_5&hourly=pm2_5&past_days=7&forecast_days=4&timezone=Asia%2FBangkok";
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    cache.set(ck, Array.isArray(data) ? data : [data]); // จุดเดียวได้ object ไม่ใช่ array
  }
  const data = cache.get(ck), at = new Map(uniq.map((k, i) => [k, i]));
  return keys.map(k => data[at.get(k)]);
}

function stat(d) {
  const T = d.hourly.time, V = d.hourly.pm2_5;
  const n = T.filter(t => t <= d.current.time).length; // ก่อนหน้า n = ค่าจริงถึงตอนนี้ หลังจากนั้น = พยากรณ์
  const v = V.slice(0, n), past = v.filter(x => x != null);
  return { now: d.current.pm2_5, mean7: avg(past), max7: Math.max(...past),
    series: { t: T.slice(0, n), v, ft: T.slice(n), fv: V.slice(n) } };
}

// ---------- ค่าเฉลี่ยรายชั่วโมงของทุกจุดที่แสดงอยู่ (จุดเดียว = ของจุดนั้น) ----------
// คืน t,v = ค่าจริงถึงตอนนี้ และ ft,fv = พยากรณ์ล่วงหน้า
function pmSeries() {
  const s0 = rows[0].series;
  const mean = (k, i) => { const x = rows.map(r => r.series[k][i]).filter(x => x != null); return x.length ? avg(x) : null; };
  return { t: s0.t, v: s0.t.map((_, i) => mean("v", i)), ft: s0.ft, fv: s0.ft.map((_, i) => mean("fv", i)) };
}

let chart;
function drawTrend() {
  if (typeof Chart === "undefined") return; // โหลด Chart.js ไม่ได้ (ออฟไลน์) ก็ข้ามกราฟ
  const { t, v, ft, fv } = pmSeries();
  const all = t.concat(ft), nulls = n => Array(n).fill(null), flat = y => all.map(() => y);
  $("trend-title").textContent = "แนวโน้ม PM2.5 7 วันล่าสุด + พยากรณ์ 3 วัน — " +
    (rows.length === 1 ? rows[0].name : `ค่าเฉลี่ยของ ${rows.length} ${levelLabels[levelNow]}`);
  const labels = all.map(s => s.slice(8, 10) + "/" + s.slice(5, 7) + " " + s.slice(11));
  const ds = [
    { label: "PM2.5", data: v.concat(nulls(ft.length)), borderColor: "#10202f", borderWidth: 2, pointRadius: 0, tension: .3 },
    // เส้นพยากรณ์เริ่มจากจุดสุดท้ายของค่าจริง เพื่อให้เส้นต่อกัน
    { label: "พยากรณ์", data: [...nulls(t.length - 1), v.at(-1), ...fv], borderColor: "#10202f", borderDash: [2, 4], borderWidth: 2, pointRadius: 0, tension: .3 },
    { label: "เกณฑ์ไทย (37.5)", data: flat(37.5), borderColor: "#e57373", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
    { label: "WHO (15)", data: flat(15), borderColor: "#4fc3f7", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
  ];
  if (chart) { chart.data.labels = labels; chart.data.datasets = ds; chart.update(); return; }
  chart = new Chart($("trend"), { type: "line", data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: "µg/m³" }, beginAtZero: true } } } });
}

// เทียบกับเมื่อวานเวลาเดียวกัน (เฉพาะโหมด "ตอนนี้")
function compareLine() {
  const { v } = pmSeries(), i = v.length - 1;
  if (state.metric !== "now" || i < 24 || v[i] == null || v[i - 24] == null) return "";
  const d = v[i] - v[i - 24];
  if (Math.abs(d) < 1) return "ใกล้เคียงกับเมื่อวานเวลาเดียวกัน";
  return `${d > 0 ? "สูงกว่า" : "ต่ำกว่า"}เมื่อวานเวลาเดียวกัน ${Math.abs(d).toFixed(1)}` + (v[i - 24] >= 3 ? ` (${Math.round(Math.abs(d) / v[i - 24] * 100)}%)` : "");
}

// บันทึกกราฟเป็น PNG พื้นขาว (กราฟปกติพื้นโปร่งใส เอาไปวางในรายงานแล้วอ่านยาก)
function saveChart(ch, name) {
  if (!ch) return;
  const o = document.createElement("canvas"); o.width = ch.canvas.width; o.height = ch.canvas.height;
  const x = o.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(ch.canvas, 0, 0);
  const a = document.createElement("a");
  a.href = o.toDataURL("image/png");
  a.download = `pm25-${$("hero-area").textContent}-${name}-${new Date().toLocaleDateString("sv-SE")}.png`;
  a.click();
}
$("save-trend").onclick = () => saveChart(chart, "แนวโน้ม");
$("save-wx").onclick = () => saveChart(wxChart, "อากาศ");

// พรุ่งนี้คาดว่าเป็นอย่างไร (ค่าเฉลี่ยทั้งวัน + ชั่วโมงที่สูงสุด)
function forecastLine() {
  const { t, ft, fv } = pmSeries();
  const day = ft.find(s => s.slice(0, 10) !== t.at(-1).slice(0, 10))?.slice(0, 10);
  const hrs = ft.map((s, i) => [s, fv[i]]).filter(x => x[0].startsWith(day) && x[1] != null);
  if (!hrs.length) return "";
  const m = avg(hrs.map(x => x[1])), peak = hrs.reduce((a, b) => (b[1] > a[1] ? b : a));
  return `พรุ่งนี้คาดว่าเฉลี่ย ${m.toFixed(1)} (${levelOf(m)[2]}) · สูงสุดช่วง ${peak[0].slice(11)} น. ราว ${peak[1].toFixed(1)}`;
}

// ---------- ฝุ่นช่วงไหนของวัน: เฉลี่ยรายช่วง 6 ชั่วโมง จากค่าจริง 7 วันที่ผ่านมา ----------
const periods = [["ดึก", 0], ["เช้า", 6], ["บ่าย", 12], ["เย็น-ค่ำ", 18]];
const hh = h => String(h).padStart(2, "0") + ":00";
function drawHeat() {
  const { t, v } = pmSeries();
  const by = periods.map(() => []);
  t.forEach((s, i) => { if (v[i] != null) by[Math.floor(+s.slice(11, 13) / 6)].push(v[i]); });
  const m = by.map(a => (a.length ? avg(a) : null)), ok = m.filter(x => x != null);
  if (ok.length < 2) { $("heat").innerHTML = ""; $("heat-say").textContent = ""; return; }
  const lo = Math.min(...ok), hi = Math.max(...ok), flat = hi - lo < 2; // ต่างกันไม่ถึง 2 ถือว่าใกล้เคียง
  $("heat").innerHTML = periods.map(([name, h], i) => m[i] == null ? "" : `
    <div class="per" style="background:${levelOf(m[i])[1]}">
      <span class="pn">${name}</span><small>${hh(h)}–${hh(h + 6)}</small>
      <b>${m[i].toFixed(1)}</b><span class="pl">${levelOf(m[i])[2]}</span>
      ${flat ? "" : m[i] === lo ? "<em>ต่ำที่สุด</em>" : m[i] === hi ? '<em class="hi">สูงที่สุด</em>' : ""}
    </div>`).join("");
  $("heat-say").textContent = flat ? "ทั้งวันฝุ่นใกล้เคียงกัน ต่างกันไม่ถึง 2 µg/m³"
    : `ช่วง${periods[m.indexOf(lo)][0]}ฝุ่นน้อยที่สุด ส่วนช่วง${periods[m.indexOf(hi)][0]}ฝุ่นมากที่สุด`;
}

// ---------- ฝุ่น vs สภาพอากาศ (สหสัมพันธ์เพียร์สัน รายชั่วโมง 7 วัน) ----------
const wxVars = { wind_speed_10m: "ลม (กม./ชม.)", precipitation: "ฝน (มม.)",
  temperature_2m: "อุณหภูมิ (°C)", relative_humidity_2m: "ความชื้น (%)" };
const wxCache = new Map();
let wx = null, wxVar = "wind_speed_10m", wxChart;

// คืน {r, slope, mx, my, p} หรือ null ถ้าข้อมูลน้อย/ค่าไม่แปรผัน (เช่น ไม่มีฝนเลย)
function pearson(x, y) {
  const p = x.map((a, i) => [a, y[i]]).filter(q => q[0] != null && q[1] != null);
  if (p.length < 10) return null;
  const mx = avg(p.map(q => q[0])), my = avg(p.map(q => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  p.forEach(([a, b]) => { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; });
  return sxx && syy ? { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, mx, my, p } : null;
}
function meaning(r) {
  const a = Math.abs(r);
  if (a < .2) return "แทบไม่สัมพันธ์";
  return (a < .4 ? "อ่อน" : a < .7 ? "ปานกลาง" : "แรง") + (r < 0 ? " · ตรงข้าม (ปัจจัยเพิ่ม ฝุ่นลด)" : " · ไปทางเดียวกัน");
}

// อากาศดึงที่จุดกึ่งกลางของพื้นที่ที่แสดง (shortcut: ทั้งประเทศจะหยาบ, ถ้าจะละเอียดต้องดึงทุกจังหวัด)
async function loadWeather(my) {
  try {
    const lat = avg(rows.map(r => r.lat)).toFixed(1), lon = avg(rows.map(r => r.lon)).toFixed(1), key = lat + "," + lon;
    if (!wxCache.has(key)) {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
        + `&hourly=${Object.keys(wxVars).join(",")}&past_days=7&forecast_days=1&timezone=Asia%2FBangkok`);
      if (!r.ok) throw new Error(r.status);
      wxCache.set(key, (await r.json()).hourly);
    }
    if (my !== seq) return;
    wx = wxCache.get(key);
    $("wx-sub").textContent = "ใช้อากาศที่จุดกึ่งกลางของพื้นที่ที่เลือก" + (state.prov === "" ? " · ทั้งประเทศใช้จุดเดียว จึงเป็นภาพคร่าว ๆ" : "");
    renderWeather();
  } catch (e) {
    if (my === seq) $("wx-box").hidden = true; // อากาศเป็นส่วนเสริม พังก็ซ่อนไป ไม่กระทบส่วนอื่น
  }
}

const wxShort = { wind_speed_10m: "ลม", precipitation: "ฝน", temperature_2m: "อุณหภูมิ", relative_humidity_2m: "ความชื้น" };
const wxInc = { wind_speed_10m: "ลมแรงขึ้น", precipitation: "ฝนตกมากขึ้น", temperature_2m: "อุณหภูมิสูงขึ้น", relative_humidity_2m: "ความชื้นสูงขึ้น" };
const wxUnit = { wind_speed_10m: "กม./ชม.", precipitation: "มม.", temperature_2m: "°C", relative_humidity_2m: "%" };

function renderWeather() {
  if (!wx || typeof Chart === "undefined") return;
  const { t, v: pm } = pmSeries();
  const at = new Map(wx.time.map((s, i) => [s, i]));
  const col = k => t.map(s => wx[k][at.get(s)] ?? null); // จัดแถวตามเวลาเดียวกับฝุ่น
  const c = pearson(col(wxVar), pm), name = wxShort[wxVar];

  $("wx-pills").innerHTML = Object.keys(wxVars).map(k => `<button data-k="${k}" class="${k === wxVar ? "on" : ""}">${wxShort[k]}</button>`).join("");
  $("wx-pills").querySelectorAll("button").forEach(b => b.onclick = () => { wxVar = b.dataset.k; renderWeather(); });

  const a = c ? Math.abs(c.r) : 0;
  $("wx-say").textContent = !c ? `${name}ไม่เปลี่ยนแปลงพอจะเทียบกับฝุ่นในช่วงนี้`
    : a < .2 ? `${name}แทบไม่เกี่ยวกับระดับฝุ่นในช่วง 7 วันที่ผ่านมา`
    : `เมื่อ${wxInc[wxVar]} ฝุ่นมัก${c.r < 0 ? "ลดลง" : "เพิ่มขึ้น"} (ความสัมพันธ์${a < .4 ? "อ่อน" : a < .7 ? "ปานกลาง" : "แรง"})`;

  const notes = [];
  if (wxVar === "precipitation") {
    const rain = col("precipitation"), wet = [], dry = [];
    pm.forEach((v, i) => { if (v != null && rain[i] != null) (rain[i] > 0.1 ? wet : dry).push(v); });
    notes.push(wet.length ? `ชั่วโมงที่ฝนตก ฝุ่นเฉลี่ย ${avg(wet).toFixed(1)} (${wet.length} ชม.) ส่วนชั่วโมงที่ไม่ตก ${avg(dry).toFixed(1)} (${dry.length} ชม.)`
      : "ไม่มีชั่วโมงที่ฝนตกในช่วง 7 วันนี้");
  }
  if (wxVar === "temperature_2m" || wxVar === "relative_humidity_2m")
    notes.push("อุณหภูมิและความชื้นเปลี่ยนตามเวลาของวัน ฝุ่นก็มีรอบวันเช่นกัน ผลนี้จึงอาจสะท้อนช่วงเวลา ไม่ใช่อากาศโดยตรง");
  notes.push((c ? `ค่าสหสัมพันธ์ r = ${c.r.toFixed(2)} · ` : "") + "ความสัมพันธ์ไม่ได้แปลว่าเป็นสาเหตุ และข้อมูลมีแค่ 7 วัน");
  $("wx-note").innerHTML = notes.join("<br>");

  const labels = t.map(s => s.slice(8, 10) + "/" + s.slice(5, 7) + " " + s.slice(11));
  const ds = [
    { label: "PM2.5 (µg/m³)", data: pm, yAxisID: "y", borderColor: "#10202f", borderWidth: 2, pointRadius: 0, tension: .3, order: 1 },
    { type: wxVar === "precipitation" ? "bar" : "line", label: `${name} (${wxUnit[wxVar]})`, data: col(wxVar), yAxisID: "y2",
      borderColor: "#2b7bb9", backgroundColor: "rgba(43,123,185,.4)", borderWidth: 2, pointRadius: 0, tension: .3, order: 2 },
  ];
  const scales = { x: { ticks: { maxTicksLimit: 8 } }, y: { beginAtZero: true, title: { display: true, text: "PM2.5" } },
    y2: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: `${name} (${wxUnit[wxVar]})` } } };
  if (wxChart) { wxChart.data.labels = labels; wxChart.data.datasets = ds; wxChart.options.scales = scales; wxChart.update(); }
  else wxChart = new Chart($("wxchart"), { type: "line", data: { labels, datasets: ds },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales } });
  $("wx-box").hidden = false;
}

// ---------- ดาวน์โหลด CSV (ข้อมูลที่เห็นอยู่ + ตำบลทั้งจังหวัดถ้ามี) ----------
$("csv").onclick = () => {
  if (!rows.length) return;
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  const line = (lv, r) => [lv, r.name, r.area || "", r.lat, r.lon, r.now.toFixed(2), r.mean7.toFixed(2), r.max7.toFixed(2)].map(esc).join(",");
  const out = ["ระดับ,ชื่อ,สังกัด,lat,lon,PM2.5 ตอนนี้,เฉลี่ย 7 วัน,สูงสุด 7 วัน",
    ...rows.map(r => line(levelLabels[levelNow], r)), ...subRows.map(r => line(levelLabels[2], r))];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + out.join("\n")], { type: "text/csv;charset=utf-8" })); // BOM ให้ Excel อ่านไทยออก
  a.download = `pm25_${new Date().toLocaleDateString("sv-SE")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ตำบล/แขวงทุกแห่งในจังหวัดที่เลือก (มากสุด ~285 จุด ยิง API ครั้งเดียว)
let subRows = [];
async function loadSubs(my) {
  const p = state.prov;
  const pts = ADMIN[p][4].flatMap((a, j) => a[3].map((s, k) =>
    ({ name: s[0], area: a[0], lat: s[1], lon: s[2], drill: () => go(p, String(j), String(k)) })));
  const data = await fetchRows(pts);
  if (my !== seq) return;
  subRows = data.map((d, i) => ({ ...pts[i], ...stat(d) }));
  renderSubs();
}
function renderSubs() {
  $("sub-box").hidden = !subRows.length;
  if (!subRows.length) return;
  const m = state.metric, dir = state.asc ? -1 : 1, maxS = Math.max(...subRows.map(r => r[m]));
  const top = [...subRows].sort((a, b) => dir * (b[m] - a[m])).slice(0, 10);
  $("sub-title").textContent = `ตำบล/แขวงที่ฝุ่น${state.asc ? "น้อยสุด" : "สูงสุด"}ใน${ADMIN[state.prov][0]} (10 จาก ${subRows.length})`;
  $("subrank").innerHTML = top.map((r, i) => `
    <li class="click" data-i="${i}"><span class="nm" title="${r.name} · ${r.area}">${r.name} <small>${r.area}</small></span>
      <span class="track"><span class="fillbar" style="width:${(r[m] / maxS) * 100}%;background:${levelOf(r[m])[1]}"></span></span>
      <b>${r[m].toFixed(1)}</b></li>`).join("");
  $("subrank").querySelectorAll("li").forEach(li => li.onclick = () => top[li.dataset.i].drill());
}

async function load() {
  const my = ++seq;
  const { level, pts } = currentPoints();
  $("status").textContent = "กำลังโหลด...";
  document.body.classList.add("busy");
  try {
    const data = await fetchRows(pts);
    if (my !== seq) return;
    rows = data.map((d, i) => ({ ...pts[i], ...stat(d) }));
    levelNow = level;
    subRows = [];
    $("status").textContent = "อัปเดตล่าสุด " + data[0].current.time.replace("T", " ");
    render();
    loadWeather(my); // ไม่ await: ทำงานคู่กับอันดับตำบล และมี try/catch ของตัวเอง
    if (level === 1) await loadSubs(my); // เลือกจังหวัดแล้ว: ดึงตำบลทั้งจังหวัดมาจัดอันดับด้วย
  } catch (e) {
    if (my === seq) $("status").textContent = e.message === "HTTP 429"
      ? "เรียกข้อมูลถี่เกินไป (Open-Meteo จำกัดจำนวนครั้ง) รอสัก 1 นาทีแล้วลองใหม่"
      : "โหลดข้อมูลไม่สำเร็จ: " + e.message;
  } finally {
    if (my === seq) document.body.classList.remove("busy");
  }
}

// ---------- แสดงผล ----------
// ตัวเลขใหญ่นับจากค่าเดิมไปค่าใหม่ (ปิดอัตโนมัติถ้าผู้ใช้ตั้งค่าลดการเคลื่อนไหว)
let shown = 0, raf, target = 0;
function countTo(v) {
  cancelAnimationFrame(raf);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { shown = v; $("hero-num").textContent = v.toFixed(1); return; }
  const from = shown, t0 = performance.now();
  const step = t => {
    const k = Math.min((t - t0) / 700, 1);
    shown = from + (v - from) * (1 - (1 - k) ** 3);
    $("hero-num").textContent = shown.toFixed(1);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  // สำรอง: แท็บที่อยู่เบื้องหลังจะหยุด requestAnimationFrame ให้ตัวเลขจบที่ค่าจริงเสมอ
  target = v;
  setTimeout(() => { if (target === v && shown !== v) { cancelAnimationFrame(raf); shown = v; $("hero-num").textContent = v.toFixed(1); } }, 900);
}

function render() {
  const m = state.metric, n = rows.length;
  const sorted = [...rows].sort((a, b) => b[m] - a[m]);
  const label = levelLabels[levelNow];

  // ส่วนบนสุด: ค่าของพื้นที่ที่เลือก + พื้นหน้าทั้งหน้าเปลี่ยนสีตามระดับอากาศ
  const mean = avg(rows.map(r => r[m])), top = sorted[0], lv = levelOf(mean);
  const over = rows.filter(r => r[m] > 37.5).length;
  const { prov: p, dist: d, sub: s } = state;
  let area = s !== "" ? ADMIN[p][4][d][3][s][0] : d !== "" ? ADMIN[p][4][d][0] : p !== "" ? ADMIN[p][0] : "ทั้งประเทศ";
  if (area === "ทั้งจังหวัด") area = ADMIN[p][0]; // กรุงเทพฯ ไม่มีพิกัดรายเขต ใช้จุดเดียว

  // แถบ "แถวคุณ" (แสดงเฉพาะเมื่อมาจากปุ่มตำแหน่ง)
  $("here").hidden = !(state.geo && n === 1);
  if (!$("here").hidden) {
    const lab = at => { const [i, j, k] = at, sn = ADMIN[i][4][j][3][k][0]; return sn === "ทั้งจังหวัด" ? ADMIN[i][0] : `${sn} (${ADMIN[i][4][j][0]})`; };
    const alts = geoInfo.near.filter(x => x.at.join() !== [p, d, s].join()).slice(0, 3), acc = geoInfo.acc;
    $("here").innerHTML = `<b>แถวคุณ:</b> ${area === ADMIN[p][0] ? area : [ADMIN[p][4][d][3][s][0], ADMIN[p][4][d][0], ADMIN[p][0]].join(" · ")}<br>`
      + `ตอนนี้ <b>${rows[0].now.toFixed(1)}</b> µg/m³ (${levelOf(rows[0].now)[2]}) · เฉลี่ย 7 วัน ${rows[0].mean7.toFixed(1)} · ${levelOf(rows[0].now)[4]}<br>`
      + `<small>ใช้ตำบลที่จุดกลางอยู่ใกล้ตำแหน่งของคุณที่สุด (ตำบลใหญ่อาจคลาดได้) · ตำแหน่งจากเบราว์เซอร์แม่นยำราว ±${acc >= 1000 ? (acc / 1000).toFixed(1) + " กม." : Math.round(acc) + " ม."}`
      + (acc > 2000 ? " ซึ่งค่อนข้างหยาบ (คอมพิวเตอร์มักใช้ IP/Wi-Fi ไม่มี GPS)" : "") + "</small><br>"
      + `<small>ไม่ใช่ที่นี่? ใกล้เคียง:</small> ` + alts.map((x, i) => `<button class="chipbtn" data-i="${i}">${lab(x.at)}</button>`).join(" ");
    $("here").querySelectorAll(".chipbtn").forEach(b => b.onclick = () => go(...alts[b.dataset.i].at, true));
  }
  const other = m === "now" ? ["เฉลี่ย 7 วัน", avg(rows.map(r => r.mean7))] : ["ตอนนี้", avg(rows.map(r => r.now))];
  document.documentElement.style.setProperty("--tint", lv[3]);
  $("hero-area").textContent = area;
  $("hero-sub").textContent = (n > 1 ? `เฉลี่ยจาก ${n} ${label}` : label) + " · " + (m === "now" ? "ค่าปัจจุบัน" : "เฉลี่ย 7 วัน");
  countTo(mean);
  $("hero-level").textContent = "อากาศ" + lv[2];
  $("hero-advice").textContent = lv[4];
  $("hero-cmp").textContent = compareLine();
  $("hero-fc").textContent = forecastLine();
  $("facts").innerHTML = [
    [top[m].toFixed(1), n > 1 ? `สูงสุด ที่${top.name}` : "ค่าสูงสุดของจุดนี้"],
    [other[1].toFixed(1), other[0]],
    [n > 1 ? `${over}/${n}` : (over ? "เกิน" : "ไม่เกิน"), "เกินเกณฑ์ 37.5"],
  ].map(f => `<div><b>${f[0]}</b><span>${f[1]}</span></div>`).join("");

  // แผนที่
  layer.clearLayers();
  const pinOf = new Map(); // แถวข้อมูล -> marker (ไว้เน้นจุดเมื่อชี้อันดับ)
  rows.forEach(r => {
    const txt = n <= 40 ? r[m].toFixed(0) : "";
    const size = n <= 40 ? 32 : 16;
    const mk = L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "", iconSize: [size, size],
      html: `<div class="pin ${r[m] > 37.5 ? "hot" : ""}" style="background:${levelOf(r[m])[1]};width:${size}px;height:${size}px">${txt}</div>` }) })
      .bindTooltip(`<b>${r.name}</b><br>ตอนนี้ ${r.now.toFixed(1)} · เฉลี่ย 7 วัน ${r.mean7.toFixed(1)} · สูงสุด ${r.max7.toFixed(1)}`)
      .on("click", r.drill)
      .addTo(layer);
    pinOf.set(r, mk);
  });
  youLayer.clearLayers();
  const pts = rows.map(r => [r.lat, r.lon]);
  if (state.geo && geoInfo) {
    L.circle([geoInfo.la, geoInfo.lo], { radius: Math.min(geoInfo.acc, 30000), color: "#2b7bb9", weight: 1, fillOpacity: .08 }).addTo(youLayer);
    L.circleMarker([geoInfo.la, geoInfo.lo], { radius: 6, color: "#fff", weight: 2, fillColor: "#2b7bb9", fillOpacity: 1 })
      .bindTooltip("ตำแหน่งที่เบราว์เซอร์ระบุ").addTo(youLayer);
    pts.push([geoInfo.la, geoInfo.lo]);
  }
  map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 11 });

  // อันดับ (15 แรก)
  const max = top[m], ranked = state.asc ? [...sorted].reverse() : sorted; // top = ค่าสูงสุดเสมอ ใช้เป็นสเกลแท่ง
  $("rank-title").textContent = `อันดับ${label}ที่ฝุ่น${state.asc ? "น้อยสุด" : "สูงสุด"}` + (n > 15 ? ` (15 จาก ${n})` : "");
  $("rank").innerHTML = ranked.slice(0, 15).map((r, i) => `
    <li data-i="${i}" ${levelNow < 2 || n > 1 ? 'class="click"' : ""}>
      <span class="nm">${r.name}</span>
      <span class="track"><span class="fillbar" style="width:${(r[m] / max) * 100}%;background:${levelOf(r[m])[1]}"></span></span>
      <b>${r[m].toFixed(1)}</b>
    </li>`).join("");
  $("rank").querySelectorAll("li").forEach(li => {
    const r = ranked[li.dataset.i], mk = pinOf.get(r);
    li.onclick = () => r.drill();
    const pin = on => { const el = mk.getElement(); if (el) el.firstChild.classList.toggle("focus", on); on ? mk.openTooltip() : mk.closeTooltip(); };
    li.onmouseenter = () => pin(true);
    li.onmouseleave = () => pin(false);
  });

  renderSubs();
  drawTrend();
  drawHeat();

  // สรุปรายภาค (เฉพาะมุมมองทั้งประเทศ)
  $("region-box").hidden = levelNow !== 0;
  if (levelNow === 0) {
    const regs = Object.keys(regionNames).map(id => {
      const g = rows.filter(r => r.region == id);
      return { name: regionNames[id], now: avg(g.map(r => r.now)), mean7: avg(g.map(r => r.mean7)),
               worst: g.reduce((a, b) => (b.mean7 > a.mean7 ? b : a)).name };
    }).sort((a, b) => b.mean7 - a.mean7);
    $("regions").innerHTML = "<tr><th>ภาค</th><th>ตอนนี้</th><th>เฉลี่ย 7 วัน</th><th>จังหวัดสูงสุด</th></tr>"
      + regs.map(g => `<tr><td>${g.name}</td>${cell(g.now)}${cell(g.mean7)}<td>${g.worst}</td></tr>`).join("");
  }
}

fromHash(); // เริ่มต้น: ถ้าลิงก์มี #p=... ก็เปิดพื้นที่นั้นเลย
