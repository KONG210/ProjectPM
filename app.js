// DATA มาจาก data.js: [เวลา, ระดับ, ชื่อ, อำเภอ, lat, lon, ตอนนี้, เฉลี่ย7วัน, สูงสุด7วัน, ระดับอากาศ]
// หลักการ: เก็บ "ตัวกรอง" ไว้ใน state แล้ววาดตารางใหม่จากข้อมูล (render) ทุกครั้งที่ตัวกรองเปลี่ยน

const LEVELS = ["ดีมาก", "ดี", "ปานกลาง", "เริ่มมีผลต่อสุขภาพ", "มีผลต่อสุขภาพ"];

// แปลง array ดิบให้เป็น object อ่านง่าย
const rows = DATA.map(([time, kind, name, district, lat, lon, now, avg, max, level]) => ({
  time, kind, name, district, lat, lon, now, avg, max, level,
}));

const times = [...new Set(rows.map((r) => r.time))].sort();

const state = {
  time: times[times.length - 1], // เริ่มที่ข้อมูลล่าสุด
  search: "",
  kind: "",
  district: "",
  level: "", // ระดับที่กดจากการ์ด
  sortKey: "now",
  sortDesc: true,
};

const $ = (id) => document.getElementById(id);

// ===== เติมตัวเลือกใน dropdown =====
function fillSelect(select, values) {
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
}
fillSelect($("snapshot"), times);
$("snapshot").value = state.time;
fillSelect($("district"), [...new Set(rows.filter((r) => r.district).map((r) => r.district))].sort());

// ===== กรอง + เรียง =====
// การ์ดนับจากข้อมูลที่ผ่านตัวกรองอื่นทั้งหมด "ยกเว้น" ตัวกรองระดับ เพื่อให้เห็นตัวเลขของทุกระดับเสมอ
function baseFilter() {
  const q = state.search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      r.time === state.time &&
      (!state.kind || r.kind === state.kind) &&
      (!state.district || r.district === state.district || r.name === state.district) &&
      (!q || r.name.toLowerCase().includes(q) || r.district.toLowerCase().includes(q))
  );
}

function sortRows(list) {
  const k = state.sortKey;
  const dir = state.sortDesc ? -1 : 1;
  return [...list].sort((a, b) =>
    typeof a[k] === "number" ? (a[k] - b[k]) * dir : a[k].localeCompare(b[k], "th") * dir
  );
}

// ===== วาดหน้าจอ =====
function levelClass(level) {
  return "lv" + (LEVELS.indexOf(level) + 1);
}

function renderCards(base) {
  $("cards").replaceChildren(
    ...LEVELS.map((level) => {
      const btn = document.createElement("button");
      btn.className = "card" + (state.level === level ? " active" : "");
      btn.setAttribute("aria-pressed", state.level === level);

      const n = document.createElement("span");
      n.className = "n";
      n.textContent = base.filter((r) => r.level === level).length;

      const l = document.createElement("span");
      l.className = "l badge " + levelClass(level);
      l.textContent = level;

      btn.append(n, l);
      // กดซ้ำที่ใบเดิม = ยกเลิกตัวกรอง
      btn.addEventListener("click", () => {
        state.level = state.level === level ? "" : level;
        render();
      });
      return btn;
    })
  );
}

function renderTable(list) {
  const tbody = $("rows");
  if (!list.length) {
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "empty";
    td.textContent = "ไม่พบข้อมูลที่ตรงกับตัวกรอง";
    tbody.replaceChildren(document.createElement("tr"));
    tbody.firstChild.appendChild(td);
    return;
  }

  tbody.replaceChildren(
    ...list.map((r) => {
      const tr = document.createElement("tr");
      const cell = (text, cls) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (cls) td.className = cls;
        return td;
      };
      const badgeTd = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + levelClass(r.level);
      badge.textContent = r.level;
      badgeTd.appendChild(badge);

      tr.append(
        cell(r.name),
        cell(r.district || "—"),
        cell(r.now.toFixed(1), "num"),
        cell(r.avg.toFixed(1), "num"),
        cell(r.max.toFixed(1), "num"),
        badgeTd
      );
      return tr;
    })
  );
}

// ===== แผนที่ (Leaflet) =====
// สีจุดต้องเป็นรหัสสีตรง ๆ เพราะ Leaflet ไม่อ่านตัวแปร CSS (ใช้โทนเดียวกับป้ายระดับ)
const LEVEL_COLORS = ["#0284c7", "#16a34a", "#eab308", "#ea580c", "#dc2626"];
const hasMap = typeof L !== "undefined"; // ออฟไลน์/โหลดไลบรารีไม่ได้ ก็ยังใช้ตารางต่อได้
let map, markerLayer;

if (hasMap) {
  map = L.map("map").setView([18.79, 98.98], 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap",
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
} else {
  $("map").hidden = true;
}

function renderMap(list) {
  if (!hasMap) return;
  markerLayer.clearLayers();
  list.forEach((r) => {
    const i = LEVELS.indexOf(r.level);
    const popup = document.createElement("div"); // ใช้ textContent กัน XSS
    popup.textContent = `${r.name}${r.district ? " (" + r.district + ")" : ""}: ${r.now.toFixed(1)} µg/m³ · ${r.level}`;
    L.circleMarker([r.lat, r.lon], {
      radius: r.kind === "อำเภอ/เขต" ? 9 : 5,
      color: "#fff",
      weight: 1,
      fillColor: LEVEL_COLORS[i],
      fillOpacity: 0.9,
    }).bindPopup(popup).addTo(markerLayer);
  });
  // ซูมให้พอดีกับจุดที่แสดงทุกครั้งที่ตัวกรองเปลี่ยน
  if (list.length) map.fitBounds(list.map((r) => [r.lat, r.lon]), { padding: [30, 30], maxZoom: 12 });
}

function render() {
  const base = baseFilter();
  const list = sortRows(state.level ? base.filter((r) => r.level === state.level) : base);

  renderCards(base);
  renderMap(list);
  renderTable(list);
  $("result-count").textContent = `แสดง ${list.length} จาก ${base.length} พื้นที่`;

  document.querySelectorAll("th").forEach((th) => {
    const active = th.dataset.key === state.sortKey;
    th.classList.toggle("sorted", active);
    th.classList.toggle("desc", active && state.sortDesc);
  });
}

// ===== ผูก Event =====
$("search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
$("snapshot").addEventListener("change", (e) => { state.time = e.target.value; render(); });
$("kind").addEventListener("change", (e) => { state.kind = e.target.value; render(); });
$("district").addEventListener("change", (e) => { state.district = e.target.value; render(); });

document.querySelectorAll("th").forEach((th) => {
  th.tabIndex = 0; // ให้กด Tab แล้วเรียงด้วยคีย์บอร์ดได้
  const sort = () => {
    const key = th.dataset.key;
    // กดคอลัมน์เดิม = สลับทิศ, กดคอลัมน์ใหม่ = ตัวเลขเรียงมากไปน้อย ข้อความเรียง ก-ฮ
    state.sortDesc = state.sortKey === key ? !state.sortDesc : typeof rows[0][key] === "number";
    state.sortKey = key;
    render();
  };
  th.addEventListener("click", sort);
  th.addEventListener("keydown", (e) => { if (e.key === "Enter") sort(); });
});

render();
