import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, updateDoc, query, getDocs, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCatvZdoiio60Is3QKVFzTANAvK_ybkl_g",
  authDomain: "rafly-45dc4.firebaseapp.com",
  projectId: "rafly-45dc4",
  storageBucket: "rafly-45dc4.firebasestorage.app",
  messagingSenderId: "556160858793",
  appId: "1:556160858793:web:1cf6085488902b10f0c7b8"
};

const USERNAME_EMAIL_MAP = { grading: "grading@dura.local", staff: "staff@dura.local" };
const DEFAULT_SUPPLIERS = ["CV Lembah Hijau Perkasa","Koperasi Karya Mandiri","Tani Rampah Jaya","PT Putra Utama Lestari","PT Manunggal Adi Jaya"];
const SUPPLIER_COLLECTION_CANDIDATES = ["suppliers","supplier"];
const LOCAL_KEYS = { suppliers:"dt_quick_suppliers", drivers:"dt_quick_drivers", plates:"dt_quick_plates", exportLog:"dt_export_log" };
const PAGE_TITLES = {
  dashboardPage:"Dashboard", inputPage:"Input Transaksi", transactionsPage:"Data Transaksi", dailyPage:"Rekap Harian",
  weeklyPage:"Rekap Mingguan", monthlyPage:"Rekap Bulanan", spreadsheetPage:"Spreadsheet", waPage:"Laporan WA", suppliersPage:"Supplier"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentRole = "grading";
let transactionsCache = [];
let todayCache = [];
let suppliersCollectionName = null;
let suppliersCache = [];
let unsubscribeTransactions = null;
let txPage = 1;
let txPageSize = 12;
let spreadsheetPage = 1;
let spreadsheetPageSize = 20;
let pendingDeleteId = null;
let currentPageId = "dashboardPage";
let editingTransactionId = null;
let supplierEditing = null;

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  setTodayInputs();
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      currentRole = (user.email || "").toLowerCase().includes("staff") ? "staff" : "grading";
      showApp();
      await initData();
    } else {
      currentUser = null;
      currentRole = "grading";
      showLogin();
    }
  });
});

function bindUI() {
  window.handleLogin = handleLogin;
  window.handleLogout = handleLogout;
  window.toggleSidebar = toggleSidebar;
  window.showPage = showPage;
  window.refreshCurrentPage = refreshCurrentPage;
  window.saveTransaction = saveTransaction;
  window.resetForm = resetForm;
  window.cancelEdit = cancelEdit;
  window.changeTransactionPage = (d) => { txPage += d; renderTransactionsTable(); };
  window.resetTransactionFilters = resetTransactionFilters;
  window.changeSpreadsheetPage = (d) => { spreadsheetPage += d; renderSpreadsheetTable(); };
  window.resetSpreadsheetFilters = resetSpreadsheetFilters;
  window.generateWA = generateWA;
  window.copyWA = copyWA;
  window.sendWA = sendWA;
  window.deleteTransaction = deleteTransaction;
  window.closeConfirmModal = closeConfirmModal;
  window.exportReportExcel = exportReportExcel;
  window.exportSpreadsheetExcel = exportSpreadsheetExcel;
  window.saveSupplier = saveSupplier;
  window.resetSupplierForm = resetSupplierForm;
  window.enterEditMode = enterEditMode;
  window.editSupplier = editSupplier;
  window.deleteSupplier = deleteSupplier;

  document.querySelectorAll(".nav-link").forEach(btn => btn.addEventListener("click", () => showPage(btn.dataset.page)));
  ["tenera","dura","tanggal","sopir","plat","supplierInput","supplierSelect"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", updateValidationPreview);
      el.addEventListener("change", updateValidationPreview);
    }
  });
  ["txSearch","txDate","txStart","txEnd","txSupplierFilter","txDriverFilter","txSort"].forEach(id => addChange(id, renderTransactionsTable));
  ["sheetSearch","sheetSupplierFilter","sheetDriverFilter","sheetStart","sheetEnd"].forEach(id => addChange(id, renderSpreadsheetTable));
  ["waTemplate","waDate","waStart","waEnd","waSupplierFilter","waDriverFilter"].forEach(id => addChange(id, generateWA));
  ["dailyDate","weeklyStart","weeklyEnd","monthlyStart","monthlyEnd"].forEach(id => addChange(id, () => {
    if (id.startsWith("daily")) renderReportPage("daily");
    if (id.startsWith("weekly")) renderReportPage("weekly");
    if (id.startsWith("monthly")) renderReportPage("monthly");
  }));
  addChange("supplierSearch", renderSuppliersPage);
  document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
    if (pendingDeleteId) { await performDeleteTransaction(pendingDeleteId); closeConfirmModal(); }
  });
}
function addChange(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", fn);
  el.addEventListener("change", fn);
}

function setTodayInputs() {
  const today = new Date().toISOString().split("T")[0];
  ["tanggal","waDate","dailyDate","weeklyStart","weeklyEnd","monthlyStart","monthlyEnd","sheetStart","sheetEnd"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
}

function showLogin() {
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
}
function showApp() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("userEmail").textContent = currentUser?.email || "-";
  document.getElementById("userRoleBadge").textContent = currentRole === "staff" ? "STAFF" : "GRADING";
  document.getElementById("gradingSupplierWrap").classList.toggle("hidden", currentRole === "staff");
  document.getElementById("staffSupplierWrap").classList.toggle("hidden", currentRole !== "staff");
  const supNav = document.querySelector('[data-page="suppliersPage"]');
  if (supNav) supNav.classList.toggle("hidden", currentRole !== "staff");
}

async function initData() {
  showLoading("Memuat data realtime...");
  await detectSuppliersCollection();
  await loadSuppliersBestEffort();
  subscribeTransactions();
  restoreExportLogs();
  refreshQuickLists();
}

async function handleLogin() {
  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value;
  const email = USERNAME_EMAIL_MAP[username];
  const btn = document.getElementById("loginBtn");
  const msg = document.getElementById("loginMessage");
  msg.textContent = "";
  if (!email || !password) { msg.textContent = "Username dan password wajib diisi."; return; }
  btn.disabled = true; btn.textContent = "Memproses...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toast("Login berhasil.");
  } catch (e) {
    console.error(e);
    msg.textContent = "Login gagal. Periksa akun Firebase Auth.";
  } finally {
    btn.disabled = false; btn.textContent = "Login";
  }
}
async function handleLogout() {
  await signOut(auth);
  if (unsubscribeTransactions) unsubscribeTransactions();
  toast("Logout berhasil.");
}
function toggleSidebar(force) {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  const open = typeof force === "boolean" ? force : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", open);
  backdrop.classList.toggle("open", open);
}
function showPage(pageId) {
  currentPageId = pageId;
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  document.getElementById(pageId).classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageId));
  document.getElementById("topbarTitle").textContent = PAGE_TITLES[pageId] || "Dashboard";
  toggleSidebar(false);
  refreshCurrentPage();
}
function refreshCurrentPage() {
  if (currentPageId === "dashboardPage") renderDashboard(todayCache);
  if (currentPageId === "transactionsPage") renderTransactionsTable();
  if (currentPageId === "dailyPage") renderReportPage("daily");
  if (currentPageId === "weeklyPage") renderReportPage("weekly");
  if (currentPageId === "monthlyPage") renderReportPage("monthly");
  if (currentPageId === "spreadsheetPage") renderSpreadsheetTable();
  if (currentPageId === "waPage") generateWA();
  if (currentPageId === "suppliersPage") renderSuppliersPage();
}

function showLoading(text){ document.getElementById("loadingText").textContent = text; document.getElementById("loadingOverlay").classList.remove("hidden"); }
function hideLoading(){ document.getElementById("loadingOverlay").classList.add("hidden"); }
function toast(message, type="ok") {
  const wrap = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type==="error" ? "error" : type==="warn" ? "warn" : ""}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function setSyncStatus(text){ document.getElementById("syncStatus").textContent = text; }
function parseDate(v){ return v ? new Date(v + "T00:00:00") : null; }
function formatDateId(d){ return new Date(d).toISOString().split("T")[0]; }
function inRangeByTanggal(item, start, end) {
  const value = parseDate(item.tanggal);
  return !!value && value >= start && value <= end;
}
function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safeText(v){ return (v ?? "").toString(); }
function escapeHtml(v){ return safeText(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }

function saveRecentValue(key, value) {
  if (!value) return;
  const items = JSON.parse(localStorage.getItem(key) || "[]");
  const next = [value, ...items.filter(x => x !== value)].slice(0, 12);
  localStorage.setItem(key, JSON.stringify(next));
}
function getRecentValues(key){ return JSON.parse(localStorage.getItem(key) || "[]"); }

function getSupplierValue() {
  return currentRole === "staff" ? document.getElementById("supplierInput").value.trim() : document.getElementById("supplierSelect").value.trim();
}
function setSupplierValue(value) {
  if (currentRole === "staff") document.getElementById("supplierInput").value = value || "";
  else document.getElementById("supplierSelect").value = value || "";
}

async function detectSuppliersCollection() {
  for (const name of SUPPLIER_COLLECTION_CANDIDATES) {
    try { await getDocs(query(collection(db, name), limit(1))); suppliersCollectionName = name; return; } catch(e) {}
  }
  suppliersCollectionName = null;
}
async function loadSuppliersBestEffort() {
  if (!suppliersCollectionName) {
    suppliersCache = DEFAULT_SUPPLIERS.map(name => ({ id:name, name, status:"aktif", source:"default" }));
    return;
  }
  try {
    const snap = await getDocs(collection(db, suppliersCollectionName));
    suppliersCache = snap.docs.map(d => {
      const data = d.data();
      const name = data.name || data.nama || data.nama_supplier || data.supplier || data.title || d.id;
      const statusRaw = data.status ?? data.aktif ?? data.active ?? "aktif";
      const status = typeof statusRaw === "boolean" ? (statusRaw ? "aktif" : "nonaktif") : safeText(statusRaw);
      return { id:d.id, name, status, source:"firebase", deleted:!!data.deleted };
    }).filter(x => x.name && !x.deleted);
  } catch(e) {
    suppliersCache = DEFAULT_SUPPLIERS.map(name => ({ id:name, name, status:"aktif", source:"default" }));
  }
}
function subscribeTransactions() {
  if (unsubscribeTransactions) unsubscribeTransactions();
  setSyncStatus("Menyambung realtime...");
  unsubscribeTransactions = onSnapshot(collection(db, "transactions"), (snap) => {
    transactionsCache = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .filter(x => !x.deleted)
      .sort((a,b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
    todayCache = transactionsCache.filter(x => x.tanggal === formatDateId(new Date()));
    refreshQuickLists();
    refreshCurrentPage();
    setSyncStatus(`Realtime aktif • ${transactionsCache.length} data`);
    hideLoading();
  }, (err) => {
    console.error(err);
    hideLoading();
    setSyncStatus("Gagal sinkron");
    toast("Gagal sinkron realtime. Cek rules/auth Firebase.", "error");
  });
}

function refreshQuickLists() {
  const suppliers = Array.from(new Set([...DEFAULT_SUPPLIERS, ...suppliersCache.map(x => x.name), ...transactionsCache.map(x => x.supplier), ...getRecentValues(LOCAL_KEYS.suppliers)])).filter(Boolean);
  const drivers = Array.from(new Set([...transactionsCache.map(x => x.sopir), ...getRecentValues(LOCAL_KEYS.drivers)])).filter(Boolean);
  const plates = Array.from(new Set([...transactionsCache.map(x => x.plat), ...getRecentValues(LOCAL_KEYS.plates)])).filter(Boolean);

  populateDatalist("supplierQuickList", suppliers);
  populateDatalist("driverQuickList", drivers);
  populateDatalist("plateQuickList", plates);

  const supplierSelect = document.getElementById("supplierSelect");
  const selected = supplierSelect.value;
  supplierSelect.innerHTML = '<option value="">Pilih supplier</option>' + suppliers.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if ([...supplierSelect.options].some(o => o.value === selected)) supplierSelect.value = selected;

  renderChips("quickSuppliers", suppliers.slice(0,10), "supplier");
  renderChips("quickDrivers", drivers.slice(0,10), "sopir");
  renderChips("quickPlates", plates.slice(0,10), "plat");

  const supplierOptions = ["Semua Supplier", ...suppliers];
  const driverOptions = ["Semua Sopir", ...drivers];
  ["txSupplierFilter","sheetSupplierFilter","waSupplierFilter"].forEach(id => fillSelect(id, supplierOptions));
  ["txDriverFilter","sheetDriverFilter","waDriverFilter"].forEach(id => fillSelect(id, driverOptions));
}
function populateDatalist(id, values) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join("");
}
function renderChips(id, values, fieldId) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.innerHTML = values.map(v => `<button class="chip" type="button" data-field="${fieldId}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join("") || '<span class="muted">Belum ada data.</span>';
  wrap.querySelectorAll(".chip").forEach(chip => chip.addEventListener("click", () => {
    if (chip.dataset.field === "supplier") setSupplierValue(chip.dataset.value);
    else document.getElementById(chip.dataset.field).value = chip.dataset.value;
    updateValidationPreview();
  }));
}
function fillSelect(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  el.innerHTML = values.map((v,i) => `<option value="${i===0 ? "" : escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if ([...el.options].some(x => x.value === current)) el.value = current;
}

function computeSummary(data) {
  const totalTransaksi = data.length;
  const totalSampel = data.reduce((a,b) => a + toNumber(b.total), 0);
  const totalTenera = data.reduce((a,b) => a + toNumber(b.tenera), 0);
  const totalDura = data.reduce((a,b) => a + toNumber(b.dura), 0);
  const persenTenera = totalSampel ? (totalTenera / totalSampel) * 100 : 0;
  const persenDura = totalSampel ? (totalDura / totalSampel) * 100 : 0;
  const dominan = totalTenera >= totalDura ? "Tenera" : "Dura";
  const bySupplier = aggregateBy(data, "supplier");
  const byDriver = aggregateBy(data, "sopir");
  const supplierTertinggi = bySupplier[0]?.name || "-";
  const sopirTertinggi = byDriver[0]?.name || "-";
  return { totalTransaksi, totalSampel, totalTenera, totalDura, persenTenera, persenDura, dominan, supplierTertinggi, sopirTertinggi, bySupplier, byDriver };
}
function aggregateBy(rows, key) {
  const map = new Map();
  rows.forEach(r => {
    const name = safeText(r[key] || "-");
    const item = map.get(name) || { name, jumlahTransaksi:0, totalSampel:0, totalTenera:0, totalDura:0 };
    item.jumlahTransaksi += 1;
    item.totalSampel += toNumber(r.total);
    item.totalTenera += toNumber(r.tenera);
    item.totalDura += toNumber(r.dura);
    map.set(name, item);
  });
  return Array.from(map.values()).map(x => ({
    ...x,
    persenTenera: x.totalSampel ? (x.totalTenera / x.totalSampel) * 100 : 0,
    persenDura: x.totalSampel ? (x.totalDura / x.totalSampel) * 100 : 0
  })).sort((a,b) => b.totalSampel - a.totalSampel || b.jumlahTransaksi - a.jumlahTransaksi);
}
function renderAggregateTable(id, rows) {
  const body = document.getElementById(id);
  body.innerHTML = rows.length ? rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.jumlahTransaksi}</td><td>${r.totalSampel}</td><td>${r.totalTenera}</td><td>${r.totalDura}</td><td>${r.persenTenera.toFixed(2)}%</td><td>${r.persenDura.toFixed(2)}%</td></tr>`).join("") : '<tr><td colspan="7">Belum ada data.</td></tr>';
}
function summaryCardsHTML(summary) {
  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h4>1. Total</h4></div>
        <div class="metric-grid">
          <div class="metric-card"><div class="label">Total transaksi</div><div class="value">${summary.totalTransaksi}</div></div>
          <div class="metric-card"><div class="label">Total sampel</div><div class="value">${summary.totalSampel}</div></div>
          <div class="metric-card"><div class="label">Total Tenera</div><div class="value">${summary.totalTenera}</div></div>
          <div class="metric-card"><div class="label">Total Dura</div><div class="value">${summary.totalDura}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h4>2. Persentase</h4></div>
        <div class="metric-grid">
          <div class="metric-card"><div class="label">% Tenera</div><div class="value">${summary.persenTenera.toFixed(2)}%</div></div>
          <div class="metric-card"><div class="label">% Dura</div><div class="value">${summary.persenDura.toFixed(2)}%</div></div>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-head"><h4>3. Kesimpulan</h4></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="label">Dominan</div><div class="value">${summary.dominan}</div></div>
        <div class="metric-card"><div class="label">Supplier tertinggi</div><div class="value">${escapeHtml(summary.supplierTertinggi)}</div></div>
        <div class="metric-card"><div class="label">Sopir tertinggi</div><div class="value">${escapeHtml(summary.sopirTertinggi)}</div></div>
      </div>
    </div>`;
}
function renderDashboard(rows) {
  const summary = computeSummary(rows);
  document.getElementById("dashboardSummary").innerHTML = summaryCardsHTML(summary);
  renderAggregateTable("dashboardSupplierBody", summary.bySupplier);
  renderAggregateTable("dashboardDriverBody", summary.byDriver);
}

function findDuplicateSameDay(payload) {
  return transactionsCache.find(x => x.id !== editingTransactionId &&
    x.tanggal === payload.tanggal &&
    safeText(x.supplier).toLowerCase() === safeText(payload.supplier).toLowerCase() &&
    safeText(x.sopir).toLowerCase() === safeText(payload.sopir).toLowerCase() &&
    safeText(x.plat).toLowerCase() === safeText(payload.plat).toLowerCase());
}
function updateValidationPreview() {
  const payload = getInputPayload();
  const duplicate = payload.tanggal && payload.supplier && payload.sopir && payload.plat ? findDuplicateSameDay(payload) : null;
  const total = payload.total;
  document.getElementById("previewTotal").textContent = total;
  document.getElementById("previewTenera").textContent = `${payload.persen_tenera.toFixed(2)}%`;
  document.getElementById("previewDura").textContent = `${payload.persen_dura.toFixed(2)}%`;
  document.getElementById("duplicateWarning").textContent = duplicate ? `Peringatan: data mirip di tanggal yang sama sudah ada (${duplicate.trx_id}).` : "";
  const indicator = document.getElementById("validationIndicator");
  let valid = true;
  let text = "Siap disimpan.";
  let cls = "valid";
  if (!payload.tanggal || !payload.supplier || !payload.sopir || !payload.plat) { valid = false; text = "Lengkapi tanggal, supplier, sopir, dan plat."; cls = "invalid"; }
  else if (total <= 0) { valid = false; text = "Total sampel harus lebih dari 0."; cls = "invalid"; }
  indicator.className = `validation ${cls}`;
  indicator.textContent = text;
  document.getElementById("saveBtn").disabled = !valid;
  document.getElementById("saveNewBtn").disabled = !valid || !!editingTransactionId;
}
function getInputPayload() {
  const tanggal = document.getElementById("tanggal").value;
  const supplier = getSupplierValue();
  const sopir = document.getElementById("sopir").value.trim();
  const plat = document.getElementById("plat").value.trim();
  const tenera = toNumber(document.getElementById("tenera").value);
  const dura = toNumber(document.getElementById("dura").value);
  const total = tenera + dura;
  return { tanggal, supplier, sopir, plat, tenera, dura, total, persen_tenera: total ? (tenera / total) * 100 : 0, persen_dura: total ? (dura / total) * 100 : 0 };
}
async function getDaySequence(dateStr) {
  return transactionsCache.filter(x => x.tanggal === dateStr && !x.deleted).length + 1;
}
function generateTrxId(dateStr, count) {
  return `TRX-${dateStr.replaceAll("-","")}-${String(count).padStart(3,"0")}`;
}
function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
async function saveTransaction(andNew=false) {
  const payload = getInputPayload();
  const msg = document.getElementById("saveMessage");
  if (!payload.tanggal || !payload.supplier || !payload.sopir || !payload.plat) { msg.textContent = "Semua field wajib diisi."; return; }
  if (payload.total <= 0) { msg.textContent = "Total sampel harus lebih dari 0."; return; }
  const duplicate = findDuplicateSameDay(payload);
  if (duplicate && !confirm(`Data mirip pada hari yang sama sudah ada (${duplicate.trx_id}). Tetap lanjutkan?`)) return;

  document.getElementById("saveBtn").disabled = true;
  document.getElementById("saveNewBtn").disabled = true;
  msg.textContent = editingTransactionId ? "Memperbarui..." : "Menyimpan...";
  try {
    const now = new Date().toISOString();
    if (editingTransactionId) {
      await updateDoc(doc(db, "transactions", editingTransactionId), { ...payload, jam: formatTime(now), updated_at: now, updated_by: currentUser?.email || null });
      toast("Data berhasil diperbarui.");
    } else {
      const seq = await getDaySequence(payload.tanggal);
      await addDoc(collection(db, "transactions"), { trx_id: generateTrxId(payload.tanggal, seq), ...payload, jam: formatTime(now), created_by: currentUser?.email || null, created_at: now, deleted: false });
      toast("Data berhasil disimpan.");
    }
    saveRecentValue(LOCAL_KEYS.suppliers, payload.supplier);
    saveRecentValue(LOCAL_KEYS.drivers, payload.sopir);
    saveRecentValue(LOCAL_KEYS.plates, payload.plat);
    if (andNew && !editingTransactionId) resetForm(true);
    else { cancelEdit(false); showPage("transactionsPage"); }
  } catch (e) {
    console.error(e);
    msg.textContent = `Gagal simpan: ${e.message}`;
    toast("Gagal simpan data.", "error");
  } finally {
    updateValidationPreview();
  }
}
function resetForm(keepDate=false) {
  const dateVal = document.getElementById("tanggal").value;
  setSupplierValue("");
  ["sopir","plat","tenera","dura"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("duplicateWarning").textContent = "";
  document.getElementById("saveMessage").textContent = "";
  document.getElementById("tanggal").value = keepDate ? dateVal : formatDateId(new Date());
  updateValidationPreview();
}
function cancelEdit(goDashboard=true) {
  editingTransactionId = null;
  document.getElementById("saveBtn").textContent = "Simpan";
  document.getElementById("saveNewBtn").classList.remove("hidden");
  resetForm();
  if (goDashboard) showPage("dashboardPage");
}
function enterEditMode(id) {
  if (currentRole !== "staff") return;
  const row = transactionsCache.find(x => x.id === id);
  if (!row) return;
  editingTransactionId = id;
  document.getElementById("tanggal").value = row.tanggal || formatDateId(new Date());
  setSupplierValue(row.supplier || "");
  document.getElementById("sopir").value = row.sopir || "";
  document.getElementById("plat").value = row.plat || "";
  document.getElementById("tenera").value = row.tenera ?? "";
  document.getElementById("dura").value = row.dura ?? "";
  document.getElementById("saveBtn").textContent = "Update";
  document.getElementById("saveNewBtn").classList.add("hidden");
  document.getElementById("saveMessage").textContent = `Mode edit: ${row.trx_id}`;
  showPage("inputPage");
  updateValidationPreview();
}

function getTransactionFilteredRows() {
  let rows = [...transactionsCache];
  const search = document.getElementById("txSearch").value.trim().toLowerCase();
  const d = document.getElementById("txDate").value;
  const start = document.getElementById("txStart").value;
  const end = document.getElementById("txEnd").value;
  const supplier = document.getElementById("txSupplierFilter").value;
  const driver = document.getElementById("txDriverFilter").value;
  const sort = document.getElementById("txSort").value;
  if (search) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(search));
  if (d) rows = rows.filter(r => r.tanggal === d);
  if (start && end) rows = rows.filter(r => inRangeByTanggal(r, parseDate(start), parseDate(end)));
  if (supplier) rows = rows.filter(r => r.supplier === supplier);
  if (driver) rows = rows.filter(r => r.sopir === driver);
  rows.sort((a,b) => sort === "oldest" ? new Date(a.created_at || a.updated_at || 0) - new Date(b.created_at || b.updated_at || 0) : new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
  return rows;
}
function renderActions(row) {
  if (currentRole !== "staff") return '<span class="muted">Lihat</span>';
  return `<button class="action-link" onclick="enterEditMode('${row.id}')">Edit</button> <button class="action-link" onclick="deleteTransaction('${row.id}')">Hapus</button>`;
}
function renderTransactionsTable() {
  const rows = getTransactionFilteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / txPageSize));
  txPage = Math.max(1, Math.min(txPage, totalPages));
  const start = (txPage - 1) * txPageSize;
  const pageRows = rows.slice(start, start + txPageSize);
  document.getElementById("txCountInfo").textContent = `${rows.length} data`;
  document.getElementById("txPageInfo").textContent = `Hal. ${txPage} / ${totalPages}`;
  document.getElementById("transactionsBody").innerHTML = pageRows.length ? pageRows.map((r,i) => `<tr><td>${start+i+1}</td><td>${escapeHtml(r.trx_id)}</td><td>${escapeHtml(r.tanggal)}</td><td>${escapeHtml(r.jam)}</td><td>${escapeHtml(r.supplier)}</td><td>${escapeHtml(r.sopir)}</td><td>${escapeHtml(r.plat)}</td><td>${toNumber(r.tenera)}</td><td>${toNumber(r.dura)}</td><td>${toNumber(r.total)}</td><td>${toNumber(r.persen_tenera).toFixed(2)}%</td><td>${toNumber(r.persen_dura).toFixed(2)}%</td><td>${renderActions(r)}</td></tr>`).join("") : '<tr><td colspan="13">Tidak ada data.</td></tr>';
}
function resetTransactionFilters() {
  ["txSearch","txDate","txStart","txEnd"].forEach(id => document.getElementById(id).value = "");
  ["txSupplierFilter","txDriverFilter"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("txSort").value = "newest";
  txPage = 1;
  renderTransactionsTable();
}

function getDateRangeForMode(mode) {
  if (mode === "daily") {
    const d = document.getElementById("dailyDate").value || formatDateId(new Date());
    return { start: d, end: d, label: d };
  }
  if (mode === "weekly") {
    const start = document.getElementById("weeklyStart").value || formatDateId(new Date());
    const end = document.getElementById("weeklyEnd").value || start;
    return { start, end, label: `${start} s/d ${end}` };
  }
  const start = document.getElementById("monthlyStart").value || formatDateId(new Date());
  const end = document.getElementById("monthlyEnd").value || start;
  return { start, end, label: `${start} s/d ${end}` };
}
function getRowsByMode(mode) {
  const range = getDateRangeForMode(mode);
  return transactionsCache.filter(r => inRangeByTanggal(r, parseDate(range.start), parseDate(range.end)));
}
function reportDetailTableHTML(title, rows, kind) {
  if (kind === "transactions") {
    return `<div class="card" style="margin-top:16px"><div class="card-head"><h4>${title}</h4></div><div class="table-wrap"><table class="data-table"><thead><tr><th>ID transaksi</th><th>Tanggal</th><th>Jam</th><th>Supplier</th><th>Sopir</th><th>Plat</th><th>Tenera</th><th>Dura</th><th>Total</th><th>% T</th><th>% D</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td>${escapeHtml(r.trx_id)}</td><td>${escapeHtml(r.tanggal)}</td><td>${escapeHtml(r.jam)}</td><td>${escapeHtml(r.supplier)}</td><td>${escapeHtml(r.sopir)}</td><td>${escapeHtml(r.plat)}</td><td>${toNumber(r.tenera)}</td><td>${toNumber(r.dura)}</td><td>${toNumber(r.total)}</td><td>${toNumber(r.persen_tenera).toFixed(2)}%</td><td>${toNumber(r.persen_dura).toFixed(2)}%</td></tr>`).join("") : '<tr><td colspan="11">Tidak ada data.</td></tr>'}</tbody></table></div></div>`;
  }
  return `<div class="card" style="margin-top:16px"><div class="card-head"><h4>${title}</h4></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Nama</th><th>Jumlah transaksi</th><th>Total sampel</th><th>Total tenera</th><th>Total dura</th><th>% tenera</th><th>% dura</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.jumlahTransaksi}</td><td>${r.totalSampel}</td><td>${r.totalTenera}</td><td>${r.totalDura}</td><td>${r.persenTenera.toFixed(2)}%</td><td>${r.persenDura.toFixed(2)}%</td></tr>`).join("") : '<tr><td colspan="7">Tidak ada data.</td></tr>'}</tbody></table></div></div>`;
}
function renderReportPage(mode) {
  const rows = getRowsByMode(mode);
  const sum = computeSummary(rows);
  const range = getDateRangeForMode(mode);
  const target = document.getElementById(mode + "Report");
  target.innerHTML = `<div class="inline-message export-text">Periode aktif: ${range.label}</div>${summaryCardsHTML(sum)}${reportDetailTableHTML("4. Detail Per Supplier", sum.bySupplier, "agg")}${reportDetailTableHTML("Detail Per Sopir", sum.byDriver, "agg")}${reportDetailTableHTML("Detail Transaksi", rows, "transactions")}`;
}

function getSpreadsheetRows() {
  let rows = [...transactionsCache];
  const search = document.getElementById("sheetSearch").value.trim().toLowerCase();
  const supplier = document.getElementById("sheetSupplierFilter").value;
  const driver = document.getElementById("sheetDriverFilter").value;
  const start = document.getElementById("sheetStart").value;
  const end = document.getElementById("sheetEnd").value;
  if (start && end) rows = rows.filter(r => inRangeByTanggal(r, parseDate(start), parseDate(end)));
  if (search) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(search));
  if (supplier) rows = rows.filter(r => r.supplier === supplier);
  if (driver) rows = rows.filter(r => r.sopir === driver);
  return rows;
}
function renderSpreadsheetStats(rows) {
  const sum = computeSummary(rows);
  document.getElementById("spreadsheetStats").innerHTML = `<div class="metric-card"><div class="label">Jumlah data</div><div class="value">${rows.length}</div></div><div class="metric-card"><div class="label">Total sampel</div><div class="value">${sum.totalSampel}</div></div><div class="metric-card"><div class="label">Total Tenera</div><div class="value">${sum.totalTenera}</div></div><div class="metric-card"><div class="label">Total Dura</div><div class="value">${sum.totalDura}</div></div>`;
}
function renderSpreadsheetTable() {
  const rows = getSpreadsheetRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / spreadsheetPageSize));
  spreadsheetPage = Math.max(1, Math.min(spreadsheetPage, totalPages));
  const start = (spreadsheetPage - 1) * spreadsheetPageSize;
  const pageRows = rows.slice(start, start + spreadsheetPageSize);
  document.getElementById("sheetCountInfo").textContent = `${rows.length} data tampil`;
  document.getElementById("sheetPageInfo").textContent = `Hal. ${spreadsheetPage} / ${totalPages}`;
  renderSpreadsheetStats(rows);
  document.getElementById("spreadsheetBody").innerHTML = pageRows.length ? pageRows.map((r,i) => `<tr><td>${start+i+1}</td><td>${escapeHtml(r.trx_id)}</td><td>${escapeHtml(r.tanggal)}</td><td>${escapeHtml(r.jam)}</td><td>${escapeHtml(r.supplier)}</td><td>${escapeHtml(r.sopir)}</td><td>${escapeHtml(r.plat)}</td><td>${toNumber(r.tenera)}</td><td>${toNumber(r.dura)}</td><td>${toNumber(r.total)}</td><td>${toNumber(r.persen_tenera).toFixed(2)}%</td><td>${toNumber(r.persen_dura).toFixed(2)}%</td><td>${renderActions(r)}</td></tr>`).join("") : '<tr><td colspan="13">Tidak ada data.</td></tr>';
}
function resetSpreadsheetFilters() {
  document.getElementById("sheetSearch").value = "";
  document.getElementById("sheetSupplierFilter").value = "";
  document.getElementById("sheetDriverFilter").value = "";
  spreadsheetPage = 1;
  renderSpreadsheetTable();
}

function getWAFilters() {
  return {
    template: document.getElementById("waTemplate").value,
    date: document.getElementById("waDate").value,
    start: document.getElementById("waStart").value,
    end: document.getElementById("waEnd").value,
    supplier: document.getElementById("waSupplierFilter").value,
    driver: document.getElementById("waDriverFilter").value
  };
}
function getRowsForWA() {
  const f = getWAFilters();
  let rows = [...transactionsCache];
  if (f.date) rows = rows.filter(r => r.tanggal === f.date);
  if (f.start && f.end) rows = rows.filter(r => inRangeByTanggal(r, parseDate(f.start), parseDate(f.end)));
  if (f.supplier) rows = rows.filter(r => r.supplier === f.supplier);
  if (f.driver) rows = rows.filter(r => r.sopir === f.driver);
  return rows;
}
function generateWA() {
  const rows = getRowsForWA();
  const out = document.getElementById("waText");
  if (!rows.length) { out.value = "Belum ada data untuk laporan sesuai filter."; return; }
  const f = getWAFilters();
  const sum = computeSummary(rows);
  const period = f.start && f.end ? `${f.start} s/d ${f.end}` : f.date || "Semua Data";
  const generated = new Date().toLocaleString("id-ID");
  let text = "";
  text += "LAPORAN TENERA DURA\nPT KEDAP SAYAAQ DUA\n\n";
  text += `Periode: ${period}\n`;
  text += `Generated: ${generated}\n\n`;
  text += "====================================\n\n";
  text += "TOTAL\n";
  text += `- Total transaksi : ${sum.totalTransaksi}\n`;
  text += `- Total sampel    : ${sum.totalSampel}\n`;
  text += `- Total Tenera    : ${sum.totalTenera}\n`;
  text += `- Total Dura      : ${sum.totalDura}\n\n`;
  text += "PERSENTASE\n";
  text += `- % Tenera : ${sum.persenTenera.toFixed(2)}%\n`;
  text += `- % Dura   : ${sum.persenDura.toFixed(2)}%\n\n`;
  text += "KESIMPULAN\n";
  text += `- Dominan            : ${sum.dominan}\n`;
  text += `- Supplier tertinggi : ${sum.supplierTertinggi}\n`;
  text += `- Sopir tertinggi    : ${sum.sopirTertinggi}\n\n`;

  const addSupplier = () => {
    text += "====================================\n\nREKAP PER SUPPLIER\n\n";
    sum.bySupplier.forEach((x,i) => {
      text += `${i+1}. ${x.name}\n`;
      text += `   - Transaksi : ${x.jumlahTransaksi}\n`;
      text += `   - Sampel    : ${x.totalSampel}\n`;
      text += `   - Tenera    : ${x.totalTenera}\n`;
      text += `   - Dura      : ${x.totalDura}\n`;
      text += `   - % Tenera  : ${x.persenTenera.toFixed(2)}%\n`;
      text += `   - % Dura    : ${x.persenDura.toFixed(2)}%\n\n`;
    });
  };
  const addDriver = () => {
    text += "====================================\n\nREKAP PER SOPIR\n\n";
    sum.byDriver.forEach((x,i) => {
      text += `${i+1}. ${x.name}\n`;
      text += `   - Transaksi : ${x.jumlahTransaksi}\n`;
      text += `   - Sampel    : ${x.totalSampel}\n`;
      text += `   - Tenera    : ${x.totalTenera}\n`;
      text += `   - Dura      : ${x.totalDura}\n`;
      text += `   - % Tenera  : ${x.persenTenera.toFixed(2)}%\n`;
      text += `   - % Dura    : ${x.persenDura.toFixed(2)}%\n\n`;
    });
  };
  if (f.template === "supplier") addSupplier();
  else if (f.template === "sopir") addDriver();
  else { addSupplier(); addDriver(); }

  text += "====================================\n\nLaporan dibuat otomatis oleh sistem\nPT Kedap Sayaaq Dua";
  out.value = text;
}
async function copyWA() {
  const text = document.getElementById("waText").value;
  if (!text) return toast("Narasi kosong.", "warn");
  await navigator.clipboard.writeText(text);
  toast("Narasi berhasil disalin.");
}
function sendWA() {
  const text = document.getElementById("waText").value;
  if (!text) return toast("Generate narasi dulu.", "warn");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function buildWorkbook(title, rows, periodText) {
  const sum = computeSummary(rows);
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString("id-ID");
  const summaryRows = [
    ["Judul Laporan", title], ["Perusahaan", "PT Kedap Sayaaq Dua"], ["Periode", periodText], ["Tanggal Generate", generated], [],
    ["Total transaksi", sum.totalTransaksi], ["Total sampel", sum.totalSampel], ["Total tenera", sum.totalTenera], ["Total dura", sum.totalDura],
    ["% tenera", `${sum.persenTenera.toFixed(2)}%`], ["% dura", `${sum.persenDura.toFixed(2)}%`], ["Dominan", sum.dominan],
    ["Supplier tertinggi", sum.supplierTertinggi], ["Sopir tertinggi", sum.sopirTertinggi]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Ringkasan");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum.bySupplier.map(x => ({ Nama:x.name, "Jumlah Transaksi":x.jumlahTransaksi, "Total Sampel":x.totalSampel, "Total Tenera":x.totalTenera, "Total Dura":x.totalDura, "% Tenera":`${x.persenTenera.toFixed(2)}%`, "% Dura":`${x.persenDura.toFixed(2)}%` }))), "Per Supplier");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum.byDriver.map(x => ({ Nama:x.name, "Jumlah Transaksi":x.jumlahTransaksi, "Total Sampel":x.totalSampel, "Total Tenera":x.totalTenera, "Total Dura":x.totalDura, "% Tenera":`${x.persenTenera.toFixed(2)}%`, "% Dura":`${x.persenDura.toFixed(2)}%` }))), "Per Sopir");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(x => ({ "ID transaksi":x.trx_id||"", Tanggal:x.tanggal||"", Jam:x.jam||"", Supplier:x.supplier||"", Sopir:x.sopir||"", Plat:x.plat||"", Tenera:toNumber(x.tenera), Dura:toNumber(x.dura), Total:toNumber(x.total), "% Tenera":`${toNumber(x.persen_tenera).toFixed(2)}%`, "% Dura":`${toNumber(x.persen_dura).toFixed(2)}%` }))), "Detail Transaksi");
  return wb;
}
function setExportLog(id, text) {
  const logs = JSON.parse(localStorage.getItem(LOCAL_KEYS.exportLog) || "{}");
  logs[id] = text;
  localStorage.setItem(LOCAL_KEYS.exportLog, JSON.stringify(logs));
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function restoreExportLogs() {
  const logs = JSON.parse(localStorage.getItem(LOCAL_KEYS.exportLog) || "{}");
  ["dailyExportInfo","weeklyExportInfo","monthlyExportInfo","spreadsheetExportInfo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = logs[id] || "";
  });
}
function exportReportExcel(mode) {
  const rows = getRowsByMode(mode);
  const range = getDateRangeForMode(mode);
  const title = mode === "daily" ? "Rekap Harian" : mode === "weekly" ? "Rekap Mingguan" : "Rekap Bulanan";
  if (!rows.length) return toast("Tidak ada data untuk export.", "warn");
  XLSX.writeFile(buildWorkbook(title, rows, range.label), `${title.toLowerCase().replaceAll(" ","-")}-${range.start}-${range.end}.xlsx`);
  setExportLog(`${mode}ExportInfo`, `Tanggal ${range.label} berhasil diekspor.`);
}
function exportSpreadsheetExcel() {
  const rows = getSpreadsheetRows();
  const start = document.getElementById("sheetStart").value || "awal";
  const end = document.getElementById("sheetEnd").value || "akhir";
  if (!rows.length) return toast("Tidak ada data spreadsheet untuk export.", "warn");
  XLSX.writeFile(buildWorkbook("Spreadsheet Master Data", rows, `${start} s/d ${end}`), `spreadsheet-master-data-${start}-${end}.xlsx`);
  setExportLog("spreadsheetExportInfo", `Tanggal ${start} s/d ${end} berhasil diekspor.`);
}

function renderSuppliersPage() {
  const search = document.getElementById("supplierSearch").value.trim().toLowerCase();
  const rows = suppliersCache.filter(x => safeText(x.name).toLowerCase().includes(search));
  document.getElementById("supplierBody").innerHTML = rows.length ? rows.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.status || "-")}</td><td>${currentRole === "staff" && x.source === "firebase" && suppliersCollectionName ? `<button class="action-link" onclick="editSupplier('${x.id}')">Edit</button> <button class="action-link" onclick="deleteSupplier('${x.id}')">Hapus</button>` : '<span class="muted">Lihat</span>'}</td></tr>`).join("") : '<tr><td colspan="3">Supplier tidak ditemukan.</td></tr>';
}
function editSupplier(id) {
  if (currentRole !== "staff") return;
  const item = suppliersCache.find(x => x.id === id);
  if (!item) return;
  supplierEditing = id;
  document.getElementById("supplierFormTitle").textContent = "Edit Supplier";
  document.getElementById("supplierNameInput").value = item.name || "";
  document.getElementById("supplierStatusInput").value = (item.status || "aktif").toLowerCase().includes("non") ? "nonaktif" : "aktif";
}
async function deleteSupplier(id) {
  if (currentRole !== "staff" || !suppliersCollectionName) return;
  const item = suppliersCache.find(x => x.id === id);
  if (!item || !confirm(`Hapus supplier ${item.name}?`)) return;
  try {
    await updateDoc(doc(db, suppliersCollectionName, id), { deleted: true });
    toast("Supplier dihapus.");
    await loadSuppliersBestEffort();
    refreshQuickLists();
    renderSuppliersPage();
  } catch (e) {
    console.error(e);
    toast("Gagal hapus supplier.", "error");
  }
}
async function saveSupplier() {
  if (currentRole !== "staff" || !suppliersCollectionName) return toast("Akses supplier hanya untuk staff.", "warn");
  const name = document.getElementById("supplierNameInput").value.trim();
  const status = document.getElementById("supplierStatusInput").value;
  if (!name) return toast("Nama supplier wajib diisi.", "warn");
  try {
    if (supplierEditing) {
      await updateDoc(doc(db, suppliersCollectionName, supplierEditing), { name, status });
      toast("Supplier diperbarui.");
    } else {
      await addDoc(collection(db, suppliersCollectionName), { name, status });
      toast("Supplier ditambahkan.");
    }
    resetSupplierForm();
    await loadSuppliersBestEffort();
    refreshQuickLists();
    renderSuppliersPage();
  } catch (e) {
    console.error(e);
    toast("Gagal simpan supplier.", "error");
  }
}
function resetSupplierForm() {
  supplierEditing = null;
  document.getElementById("supplierFormTitle").textContent = "Kelola Supplier";
  document.getElementById("supplierNameInput").value = "";
  document.getElementById("supplierStatusInput").value = "aktif";
}

function deleteTransaction(id) {
  if (currentRole !== "staff") return toast("Hanya staff yang dapat menghapus.", "warn");
  const item = transactionsCache.find(x => x.id === id);
  if (!item) return;
  pendingDeleteId = id;
  document.getElementById("confirmModalContent").innerHTML = `<p>ID: <strong>${escapeHtml(item.trx_id)}</strong></p><p>Tanggal: <strong>${escapeHtml(item.tanggal)}</strong></p><p>Supplier: <strong>${escapeHtml(item.supplier)}</strong></p><p>Sopir: <strong>${escapeHtml(item.sopir)}</strong></p><p>Total: <strong>${toNumber(item.total)}</strong></p>`;
  document.getElementById("confirmModal").classList.remove("hidden");
}
function closeConfirmModal() {
  pendingDeleteId = null;
  document.getElementById("confirmModal").classList.add("hidden");
}
async function performDeleteTransaction(id) {
  try {
    await updateDoc(doc(db, "transactions", id), { deleted: true, updated_at: new Date().toISOString(), updated_by: currentUser?.email || null });
    toast("Data berhasil dihapus.");
  } catch (e) {
    console.error(e);
    toast("Gagal menghapus data.", "error");
  }
}
