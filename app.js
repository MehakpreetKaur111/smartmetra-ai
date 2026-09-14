/* SmartMetra AI — evidence-first packaged commodity compliance.
   Never invents product data. Missing fields stay NOT DETECTED. */

const KEYS = {
  session: "smartmetra_session",
  inspections: "smartmetra_inspections",
  complaints: "smartmetra_complaints",
  audit: "smartmetra_audit",
  notifications: "smartmetra_notifications",
  theme: "smartmetra_theme",
  rules: "smartmetra_rules_cache",
};

const SIDES = ["Front", "Back", "Left", "Right", "Top", "Bottom"];
const PIPELINE = ["UPLOADED", "QUALITY", "OCR_PROCESSING", "IDENTIFYING", "CLASSIFYING", "CHECKING_COMPLIANCE", "REVIEW_REQUIRED", "VERIFIED", "COMPLETED", "FAILED"];

let selectedRole = null;
let currentPage = "dashboard";
let draftImages = [];
let currentInspection = null;
let evidenceContext = null;
let rulesDb = null;
let chartObjs = [];

const ROLE_META = {
  consumer: { name: "Consumer", full: "Priya Sharma", initials: "PS" },
  company: { name: "Company", full: "Compliance Officer", initials: "CO" },
  government: { name: "Government", full: "Legal Metrology Inspector", initials: "LM" },
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`.toUpperCase();
}
function nowIso() {
  return new Date().toISOString();
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function session() {
  return load(KEYS.session, null);
}
function inspections() {
  return load(KEYS.inspections, []);
}
function complaints() {
  return load(KEYS.complaints, []);
}
function auditLogs() {
  return load(KEYS.audit, []);
}
function audit(action, extra) {
  const s = session();
  const logs = auditLogs();
  logs.unshift({
    id: uid("AUD"),
    user: s?.fullName || "Guest",
    role: s?.role || "unknown",
    action,
    timestamp: nowIso(),
    ...extra,
  });
  save(KEYS.audit, logs.slice(0, 500));
}
function notifications() {
  return load(KEYS.notifications, []);
}

function pushNotification(title, message, type = "info") {
  const list = notifications();
  const item = {
    id: uid("NT"),
    title,
    message,
    type,
    timestamp: nowIso(),
  };
  list.unshift(item);
  save(KEYS.notifications, list.slice(0, 30));
  renderNotifications();
}

function renderNotifications() {
  const panel = document.getElementById("notificationList");
  const badge = document.getElementById("notificationCount");
  const items = notifications();
  const count = items.length;

  if (badge) {
    badge.textContent = count ? String(count) : "0";
    badge.classList.toggle("visible", count > 0);
  }

  if (!panel) return;
  if (!items.length) {
    panel.innerHTML = `<div class="notification-empty">No new notifications.</div>`;
    return;
  }

  panel.innerHTML = items.map((n) => `
    <div class="notification-item ${escapeHtml(n.type || "info")}">
      <strong>${escapeHtml(n.title || "Update")}</strong>
      <p>${escapeHtml(n.message || "")}</p>
    </div>
  `).join("");
}

function clearNotifications() {
  save(KEYS.notifications, []);
  renderNotifications();
}

function toggleNotifications(forceState) {
  const panel = document.getElementById("notificationPanel");
  if (!panel) return;
  const nextState = typeof forceState === "boolean" ? forceState : !panel.classList.contains("open");
  panel.classList.toggle("open", nextState);
  if (nextState) {
    document.getElementById("chatPanel")?.classList.remove("open");
  }
}

function syncChatWidgetPosition() {
  const fab = document.getElementById("chatFab");
  const panel = document.getElementById("chatPanel");
  if (!fab || !panel) return;
  fab.style.bottom = "20px";
  fab.style.right = "20px";
  fab.style.top = "auto";
  fab.style.left = "auto";
  panel.style.bottom = "84px";
  panel.style.right = "20px";
  panel.style.top = "auto";
  panel.style.left = "auto";
}

function toast(title, message, type = "info") {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="text-muted">${escapeHtml(message || "")}</div>`;
  stack.appendChild(el);
  pushNotification(title, message, type);
  setTimeout(() => el.remove(), 3800);
}

async function loadRules() {
  if (rulesDb) return rulesDb;
  try {
    const res = await fetch("legal_metrology_rules.json");
    if (!res.ok) throw new Error("rules missing");
    rulesDb = await res.json();
    save(KEYS.rules, rulesDb);
  } catch {
    rulesDb = load(KEYS.rules, null);
  }
  return rulesDb;
}

function conditionMet(expr, ctx) {
  if (!expr) return true;
  try {
    if (expr.includes("is_imported == true")) return !!ctx.is_imported;
    if (expr.includes("commodity_sold_loose_or_by_standard_unit == true")) return !!ctx.commodity_sold_loose_or_by_standard_unit;
    const cat = expr.match(/category in \[(.+)\]/);
    if (cat) {
      const list = cat[1].split(",").map((x) => x.trim().replace(/['"]/g, ""));
      return list.includes(ctx.category);
    }
  } catch {
    return false;
  }
  return false;
}

function parseMonthYear(value) {
  if (!value) return null;
  const v = String(value).trim();
  const m1 = v.match(/^(0[1-9]|1[0-2])[/-](\d{4})$/);
  if (m1) return new Date(Number(m1[2]), Number(m1[1]) - 1, 1);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : new Date(d);
}

function validateField(rule, value) {
  const validation = rule.validation || {};
  if (value == null || String(value).trim() === "") return { ok: false, reason: "missing" };
  const str = String(value);
  if (validation.regex && !new RegExp(validation.regex, "i").test(str)) return { ok: false, reason: "format_invalid" };
  if (validation.min_length && str.trim().length < validation.min_length) return { ok: false, reason: "too_short" };
  if (validation.must_contain_pincode && !new RegExp(validation.regex_pincode || "\\d{6}").test(str)) {
    return { ok: false, reason: "missing_pincode" };
  }
  if (validation.must_contain_one_of) {
    const phone = new RegExp(validation.regex_phone || "\\d{10}").test(str);
    const email = new RegExp(validation.regex_email || "[\\w.-]+@[\\w.-]+").test(str);
    if (!phone && !email) return { ok: false, reason: "no_contact_method" };
  }
  if (validation.not_in_future) {
    const parsed = parseMonthYear(str);
    if (parsed && parsed > new Date()) return { ok: false, reason: "date_in_future" };
  }
  if (rule.field_id === "retail_sale_price" && validation.must_state_inclusive_of_taxes) {
    if (!/incl(usive)?(\s+of)?(\s+all)?\s+taxes/i.test(str)) return { ok: false, reason: "missing_inclusive_taxes" };
  }
  return { ok: true, reason: "ok" };
}

function evaluateCompliance(extracted, context, rules) {
  const weights = rules.risk_scoring;
  const results = [];
  let score = 100;
  for (const rule of rules.mandatory_declarations) {
    if (rule.applies_when && !conditionMet(rule.applies_when, context)) continue;
    const value = extracted[rule.field_id];
    const { ok, reason } = validateField(rule, value);
    const required = !!rule.required || (!!rule.applies_when && !!rule.required_if_applicable);
    if (!ok && required) {
      const severity = rule.severity_if_missing || "medium";
      score -= weights[severity] || 10;
      results.push({
        field_id: rule.field_id,
        label: rule.label,
        status: reason === "missing" ? "MISSING" : "POTENTIALLY INCORRECT",
        engineStatus: "FAIL",
        reason,
        severity,
        rule_reference: rule.rule_reference,
        message: rule.error_message,
        source: "Legal Metrology (Packaged Commodities) Rules, 2011",
      });
    } else if (!ok) {
      results.push({
        field_id: rule.field_id,
        label: rule.label,
        status: "UNCERTAIN",
        engineStatus: "WARN",
        reason,
        severity: rule.severity_if_missing || "low",
        rule_reference: rule.rule_reference,
        message: rule.error_message,
        source: "Legal Metrology (Packaged Commodities) Rules, 2011",
      });
    } else {
      results.push({
        field_id: rule.field_id,
        label: rule.label,
        status: "PASS",
        engineStatus: "PASS",
        reason: "ok",
        severity: "low",
        rule_reference: rule.rule_reference,
      });
    }
  }
  score = Math.max(0, score);
  const review = score < (weights.compliant_threshold || 90);
  let risk = "LOW";
  if (score < 50) risk = "CRITICAL";
  else if (score < 70) risk = "HIGH";
  else if (score < 90) risk = "MEDIUM";
  return { compliance_score: score, review_required: review, risk_level: risk, field_results: results };
}

function confidenceLevel(c) {
  if (c == null) return "UNKNOWN";
  if (c >= 0.85) return "HIGH";
  if (c >= 0.65) return "MEDIUM";
  return "LOW";
}

function classifyProduct(text) {
  const t = (text || "").toLowerCase();
  const tests = [
    { keys: ["shampoo", "hair care", "conditioner"], category: "Personal Care", subcategory: "Shampoo", commodity: "Hair care" },
    { keys: ["soap", "bathing bar"], category: "Personal Care", subcategory: "Soap", commodity: "Soap" },
    { keys: ["biscuit", "cookie", "cookies"], category: "Food", subcategory: "Biscuits", commodity: "Biscuits" },
    { keys: ["rice", "basmati"], category: "Food", subcategory: "Rice", commodity: "Rice" },
    { keys: ["cola", "soda", "soft drink", "fizz"], category: "Beverage", subcategory: "Soft Drink", commodity: "Carbonated beverage" },
    { keys: ["juice", "nectar"], category: "Beverage", subcategory: "Fruit Juice", commodity: "Fruit juice" },
    { keys: ["water", "mineral water"], category: "Beverage", subcategory: "Packaged Water", commodity: "Packaged drinking water" },
    { keys: ["oil", "sunflower", "mustard oil"], category: "Food", subcategory: "Edible Oil", commodity: "Edible oil" },
    { keys: ["cream", "lotion", "cosmetic"], category: "Personal Care", subcategory: "Cosmetic", commodity: "Cosmetic" },
  ];
  for (const row of tests) {
    if (row.keys.some((k) => t.includes(k))) {
      return { ...row, confidence: 0.8, unknown: false };
    }
  }
  const hasWords = (t.match(/[a-z]{3,}/g) || []).length > 4;
  return {
    category: "UNKNOWN",
    subcategory: "UNKNOWN",
    commodity: "UNKNOWN PRODUCT — REVIEW REQUIRED",
    confidence: hasWords ? 0.35 : 0.1,
    unknown: true,
  };
}

function extractFields(ocrBlocks) {
  const combined = ocrBlocks.map((b) => b.text).join("\n");
  const text = combined;
  const pick = (re, group = 1) => {
    const m = text.match(re);
    if (!m) return null;
    const src = ocrBlocks.find((b) => re.test(b.text));
    return {
      raw: m[0],
      value: (m[group] || m[0]).trim(),
      confidence: src ? src.confidence : 0.5,
      sourceImage: src ? src.side : "combined",
      imageId: src ? src.imageId : null,
    };
  };

  const mrp = pick(/(?:M\.?\s*R\.?\s*P\.?|MRP)[^\d₹Rs]{0,12}(?:Rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
  const qty = pick(/(\d+(?:\.\d+)?)\s*(kg|g|gm|ml|l|ltr|litre|mg)\b/i);
  const mfg = pick(/(?:mfd|mfg|pkd|packed|manufactur(?:ed|ing)|packed on)[^\d]{0,12}((?:0[1-9]|1[0-2])[/-]\d{4}|[A-Za-z]{3,9}\s+\d{4})/i);
  const exp = pick(/(?:exp|expiry|best before|use by)[^\d]{0,12}((?:0[1-9]|[12]\d|3[01])[/-](?:0[1-9]|1[0-2])[/-]\d{2,4}|(?:0[1-9]|1[0-2])[/-]\d{4}|[A-Za-z]{3,9}\s+\d{4})/i);
  const batch = pick(/(?:batch|lot|b\.?\s*no\.?)[:\s-]*([A-Z0-9-]{3,})/i);
  const email = pick(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const phone = pick(/(\+?91[-\s]?)?([6-9]\d{9})\b/);
  const pin = pick(/\b(\d{6})\b/);
  const brandLine = text.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 48)[0] || null;

  const careParts = [email?.value, phone?.value].filter(Boolean).join(" ");
  const addressHint = pin
    ? text.split(/\n/).filter((l) => l.includes(pin.value) || /pvt|ltd|plot|road|india/i.test(l)).slice(0, 4).join(", ")
    : null;

  const hasLatin = /[A-Za-z]{3,}/.test(text);
  const hasHindi = /[\u0900-\u097F]{3,}/.test(text);

  const field = (id, hit, extra) => {
    if (!hit) {
      return {
        id,
        raw: "NOT DETECTED",
        value: null,
        normalized: "NOT DETECTED",
        confidence: null,
        level: "UNKNOWN",
        sourceImage: "NOT DETECTED",
        review: true,
      };
    }
    const level = confidenceLevel(hit.confidence);
    return {
      id,
      raw: hit.raw,
      value: hit.value,
      normalized: extra?.normalized || hit.value,
      confidence: hit.confidence,
      level,
      sourceImage: hit.sourceImage,
      imageId: hit.imageId,
      review: level === "LOW",
    };
  };

  const qtyNorm = qty ? `${qty.value.replace(/gm/i, "g").replace(/ltr|litre/i, "l")}`.toLowerCase().replace(/\s+/g, " ") : null;
  const mrpNorm = mrp ? `MRP = ${mrp.value} INR` : null;

  return {
    combinedText: text.trim() || "",
    fields: {
      product_name: field("product_name", brandLine ? { raw: brandLine, value: brandLine, confidence: 0.55, sourceImage: ocrBlocks[0]?.side } : null),
      brand: field("brand", brandLine ? { raw: brandLine, value: brandLine.split(/\s+/).slice(0, 2).join(" "), confidence: 0.5, sourceImage: ocrBlocks[0]?.side } : null),
      common_generic_name: field("common_generic_name", brandLine ? { raw: brandLine, value: brandLine, confidence: 0.45, sourceImage: ocrBlocks[0]?.side } : null),
      manufacturer_packer_importer: field("manufacturer_packer_importer", addressHint ? { raw: addressHint, value: addressHint, confidence: pin ? 0.7 : 0.4, sourceImage: pin?.sourceImage } : null),
      net_quantity: field("net_quantity", qty, { normalized: qtyNorm }),
      retail_sale_price: field("retail_sale_price", mrp ? { ...mrp, raw: mrp.raw } : null, { normalized: mrpNorm }),
      month_year_of_manufacture: field("month_year_of_manufacture", mfg),
      best_before_or_expiry: field("best_before_or_expiry", exp),
      batch_number: field("batch_number", batch),
      consumer_care_details: field("consumer_care_details", careParts ? { raw: careParts, value: careParts, confidence: 0.75, sourceImage: email?.sourceImage || phone?.sourceImage } : null),
      country_of_origin: field("country_of_origin", /made in\s+([A-Za-z ]+)/i.test(text) ? pick(/made in\s+([A-Za-z ]+)/i) : null),
      declaration_language: field("declaration_language", hasLatin || hasHindi ? { raw: hasHindi && hasLatin ? "en+hi" : hasHindi ? "hi" : "en", value: hasHindi && hasLatin ? "en" : hasHindi ? "hi" : "en", confidence: 0.9, sourceImage: "combined" } : null),
    },
  };
}

function findInconsistencies(ocrBlocks, fields) {
  const findings = [];
  const mrps = [];
  const qtys = [];
  for (const b of ocrBlocks) {
    const m = b.text.match(/(?:M\.?\s*R\.?\s*P\.?|MRP)[^\d₹Rs]{0,12}(?:Rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
    if (m) mrps.push({ side: b.side, value: m[1], imageId: b.imageId });
    const q = b.text.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i);
    if (q) qtys.push({ side: b.side, value: `${q[1]} ${q[2]}`.toLowerCase(), imageId: b.imageId });
  }
  const uniq = (arr) => [...new Set(arr.map((x) => x.value))];
  if (uniq(mrps).length > 1) {
    findings.push({
      type: "INCONSISTENT",
      field: "MRP",
      status: "REVIEW REQUIRED",
      what: `Different MRP values on package sides: ${uniq(mrps).join(" vs ")}`,
      where: mrps.map((m) => m.side).join(" + "),
      why: "Cross-side declarations do not match.",
      rule: "Rule 6(1)(f), Rule 18",
      confidence: 0.9,
      evidence: mrps,
      next: "Verify printed MRP on each side and the package version.",
    });
  }
  if (uniq(qtys).length > 1) {
    findings.push({
      type: "INCONSISTENT",
      field: "Net quantity",
      status: "REVIEW REQUIRED",
      what: `Different quantities: ${uniq(qtys).join(" vs ")}`,
      where: qtys.map((m) => m.side).join(" + "),
      why: "Quantity declarations differ across images.",
      rule: "Rule 6(1)(c), Rule 8",
      confidence: 0.85,
      evidence: qtys,
      next: "Confirm net quantity on the physical pack.",
    });
  }
  return findings;
}

function analyzeImageQuality(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const canvas = document.createElement("canvas");
      const max = 240;
      const scale = Math.min(1, max / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let sumSq = 0;
      let lap = 0;
      const gray = [];
      for (let i = 0; i < data.length; i += 4) {
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray.push(g);
        sum += g;
        sumSq += g * g;
      }
      const n = gray.length;
      const mean = sum / n;
      const contrast = Math.sqrt(sumSq / n - mean * mean);
      const cw = canvas.width;
      for (let y = 1; y < canvas.height - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
          const i = y * cw + x;
          const v = gray[i - 1] + gray[i + 1] + gray[i - cw] + gray[i + cw] - 4 * gray[i];
          lap += v * v;
        }
      }
      const sharpness = lap / n;
      const issues = [];
      if (w < 400 || h < 400) issues.push("Low resolution");
      if (mean < 40) issues.push("Too dark");
      if (mean > 230) issues.push("Too bright / glare");
      if (contrast < 18) issues.push("Low contrast");
      if (sharpness < 40) issues.push("Possible blur");
      const tooLow = issues.length >= 3 || (w < 220 && h < 220);
      resolve({
        width: w,
        height: h,
        brightness: Math.round(mean),
        contrast: Math.round(contrast),
        sharpness: Math.round(sharpness),
        issues,
        tooLow,
        message: tooLow ? "IMAGE QUALITY TOO LOW — Please upload a clearer package image." : issues.length ? issues.join("; ") : "Acceptable",
      });
    };
    img.onerror = () => resolve({ tooLow: true, issues: ["Invalid image"], message: "Invalid image. Please upload a supported package image." });
    img.src = dataUrl;
  });
}

function compressImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) {
      reject(new Error("Invalid image. Please upload a supported package image."));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error("File too large. Use an image under 12 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("Invalid image. Please upload a supported package image."));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function runOcr(dataUrl) {
  if (typeof Tesseract === "undefined") {
    throw new Error("AI SERVICE UNAVAILABLE");
  }
  const result = await Tesseract.recognize(dataUrl, "eng", { logger: () => {} });
  const conf = (result.data.confidence || 0) / 100;
  return {
    text: (result.data.text || "").trim(),
    confidence: conf,
    words: (result.data.words || []).map((w) => ({
      text: w.text,
      conf: (w.confidence || 0) / 100,
      bbox: w.bbox,
    })),
    engine: "Tesseract.js",
  };
}

function persistInspection(insp) {
  const all = inspections();
  const i = all.findIndex((x) => x.id === insp.id);
  if (i >= 0) all[i] = insp;
  else all.unshift(insp);
  save(KEYS.inspections, all);
  currentInspection = insp;
}

function persistComplaint(c) {
  const all = complaints();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c;
  else all.unshift(c);
  save(KEYS.complaints, all);
}

function selectRole(role) {
  selectedRole = role;
  document.querySelectorAll(".role-card").forEach((el) => el.classList.toggle("selected", el.dataset.role === role));
  openAuthModal("signup", role);
}

function handleLogin() {
  openAuthModal("signup", selectedRole || "consumer");
}

function logout() {
  audit("logout");
  localStorage.removeItem(KEYS.session);
  currentInspection = null;
  document.body.classList.remove("app-ready");
  document.getElementById("appShell").style.display = "none";
  document.getElementById("chatFab").style.display = "none";
  document.getElementById("loginPage").style.display = "block";
  document.getElementById("alertBanner").style.display = "flex";
  document.querySelectorAll(".role-card").forEach((el) => el.classList.remove("selected"));
  selectedRole = null;
}

/* =========================================================
   AUTH — Create account / Sign in / Continue with Google
   ========================================================= */
const AUTH_USERS_KEY = "smartmetra_users";

const GOOGLE_DEMO = {
  consumer:   { fullName: "Priya Sharma",              email: "priya.sharma@gmail.com" },
  company:    { fullName: "Compliance Officer",        email: "compliance.officer@gmail.com" },
  government: { fullName: "Legal Metrology Inspector", email: "lm.inspector@gmail.com" },
};

let authMode = "signup";   // "signup" | "signin"
let authRole = "consumer";

function authUsers() { return load(AUTH_USERS_KEY, []); }
function saveAuthUsers(list) { save(AUTH_USERS_KEY, list); }

function initialsOf(name) {
  const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "U") + (parts[1]?.[0] || "")).toUpperCase();
}

function openAuthModal(mode = "signup", role = "consumer") {
  authMode = mode === "signin" ? "signin" : "signup";
  authRole = ROLE_META[role] ? role : "consumer";
  selectedRole = authRole;

  const modal = document.getElementById("authModal");
  if (!modal) return;

  ["authOrg", "authEmail", "authPassword"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  hideAuthError();
  syncAuthUI();
  modal.classList.add("show");
  setTimeout(() => document.getElementById("authEmail")?.focus(), 80);
}

function closeAuthModal() {
  document.getElementById("authModal")?.classList.remove("show");
  hideAuthError();
  document.querySelectorAll(".role-card").forEach((el) => el.classList.remove("selected"));
}

function setAuthRole(role) {
  if (!ROLE_META[role]) return;
  authRole = role;
  selectedRole = role;
  hideAuthError();
  syncAuthUI();
}

function toggleAuthMode(e) {
  if (e) e.preventDefault();
  authMode = authMode === "signup" ? "signin" : "signup";
  hideAuthError();
  syncAuthUI();
  setTimeout(() => document.getElementById("authEmail")?.focus(), 60);
}

function syncAuthUI() {
  const isSignup = authMode === "signup";

  const title = document.getElementById("authTitle");
  const sub = document.getElementById("authSub");
  if (title) title.textContent = isSignup ? "Create your account" : "Sign in to your account";
  if (sub) sub.textContent = isSignup
    ? "Choose how you will use SmartMetra."
    : "Pick your role and enter your registered email.";

  document.querySelectorAll(".auth-role").forEach((el) => {
    el.classList.toggle("active", el.dataset.role === authRole);
  });

  const org = document.getElementById("authOrg");
  if (org) {
    if (authRole === "company") {
      org.style.display = "block";
      org.placeholder = "Company name (used to route complaints)";
    } else if (authRole === "government") {
      org.style.display = "block";
      org.placeholder = "Department / authority name";
    } else {
      org.style.display = "none";
      org.value = "";
    }
  }

  const label = authRole === "company" ? "company" : authRole === "government" ? "government" : "consumer";
  const submit = document.getElementById("authSubmit");
  if (submit) submit.textContent = isSignup ? `Create ${label} account` : `Sign in as ${label}`;

  const switchText = document.getElementById("authSwitchText");
  const switchLink = document.getElementById("authSwitchLink");
  if (switchText) switchText.textContent = isSignup ? "Already have an account?" : "New to SmartMetra?";
  if (switchLink) switchLink.textContent = isSignup ? "Sign in" : "Create an account";
}

function showAuthError(msg) {
  const box = document.getElementById("authError");
  if (!box) return;
  box.textContent = msg;
  box.style.display = "block";
}
function hideAuthError() {
  const box = document.getElementById("authError");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
}

function submitAuth() {
  const email = (document.getElementById("authEmail")?.value || "").trim();
  const password = document.getElementById("authPassword")?.value || "";
  const org = (document.getElementById("authOrg")?.value || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showAuthError("Enter a valid email address.");
  if (password.length < 6) return showAuthError("Password must be at least 6 characters.");
  if (authRole === "company" && !org) return showAuthError("Company name is required.");
  if (authRole === "government" && !org) return showAuthError("Department / authority name is required.");

  const users = authUsers();

  if (authMode === "signup") {
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return showAuthError("An account with this email already exists. Please sign in.");
    }
    const fullName = authRole === "consumer"
      ? email.split("@")[0].replace(/[._-]+/g, " ")
      : org;
    const user = {
      id: uid("USR"),
      email,
      password,
      role: authRole,
      fullName,
      org: org || null,
      provider: "password",
      createdAt: nowIso(),
    };
    users.push(user);
    saveAuthUsers(users);
    completeAuth(user, "password", "Account created");
    return;
  }

  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return showAuthError("No account found for this email. Create an account first.");
  if (user.password !== password) return showAuthError("Incorrect password. Please try again.");
  if (user.role !== authRole) {
    authRole = user.role;
    syncAuthUI();
  }
  completeAuth(user, "password", "Signed in");
}

function completeAuth(user, provider, title) {
  const role = user.role || authRole;
  const meta = ROLE_META[role] || ROLE_META.consumer;
  const fullName = user.fullName || meta.full;

  save(KEYS.session, {
    role,
    fullName,
    email: user.email || null,
    org: user.org || null,
    initials: initialsOf(fullName),
    provider: provider || "password",
    loginAt: nowIso(),
  });
  audit("login", { record: role });

  closeAuthModal();
  closeGoogleModal();
  bootApp();
  toast(title || "Signed in", fullName);
}

/* ---------- Continue with Google (mock chooser) ---------- */
function continueWithGoogle() {
  if (!document.getElementById("authModal")?.classList.contains("show")) {
    openAuthModal("signup", authRole);
  }
  const users = authUsers().slice(-3).reverse();
  const box = document.getElementById("gAccounts");
  if (!box) return;

  box.innerHTML =
    users.map((u) => `
      <button type="button" class="g-account" onclick="googlePick('${u.id}')">
        <span class="g-avatar">${escapeHtml(initialsOf(u.fullName || u.email))}</span>
        <span class="g-info"><strong>${escapeHtml(u.fullName || u.email)}</strong><small>${escapeHtml(u.email)}</small></span>
      </button>`).join("") +
    `<button type="button" class="g-account" onclick="googlePick('__new__')">
      <span class="g-avatar ghost"><i class="fas fa-user-plus"></i></span>
      <span class="g-info"><strong>Use another account</strong><small>Continue as ${escapeHtml(authRole)}</small></span>
    </button>`;

  document.getElementById("googleModal").classList.add("show");
}

function closeGoogleModal() {
  document.getElementById("googleModal")?.classList.remove("show");
}

function cancelGoogle() {
  closeGoogleModal();
  showAuthError("Sign in was cancelled");
}

function googlePick(id) {
  const users = authUsers();
  let user = users.find((u) => u.id === id);

  if (!user) {
    const demo = GOOGLE_DEMO[authRole] || GOOGLE_DEMO.consumer;
    user = users.find((u) => u.email === demo.email);
    if (!user) {
      user = {
        id: uid("USR"),
        email: demo.email,
        password: null,
        role: authRole,
        fullName: demo.fullName,
        org: null,
        provider: "google",
        createdAt: nowIso(),
      };
      users.push(user);
      saveAuthUsers(users);
    }
  }

  closeGoogleModal();
  completeAuth(user, "google", "Signed in with Google");
}

function bootApp() {
  const s = session();
  if (!s) return;
  document.body.classList.add("app-ready");
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("appShell").style.display = "block";
  document.getElementById("chatFab").style.display = "grid";

  const meta = ROLE_META[s.role];
  document.getElementById("sidebarRoleTag").textContent = meta.name;
  document.getElementById("userAvatar").textContent = s.fullName ? s.fullName[0].toUpperCase() : "M";
  document.getElementById("userName").textContent = s.role + "3174824";
  document.getElementById("breadcrumbRoot").textContent = meta.name + " workspace";
  buildNav();
  navigateTo("dashboard");
}

function navItemsForRole(role) {
  const common = [
    { id: "dashboard", icon: "fa-th-large", label: "Overview" },
    { id: "inspection", icon: "fa-camera", label: role === "company" ? "Pre-launch scan" : "Scan a product", scan: true },
    { id: "history", icon: "fa-file-lines", label: "My scans" },
    { id: "products", icon: "fa-box", label: "Products" },
    { id: "complaints", icon: "fa-comment-dots", label: role === "consumer" ? "My complaints" : "Complaints" },
  ];
  if (role === "consumer") return common;
  if (role === "company") {
    return [
      ...common,
      { id: "manufacturers", icon: "fa-industry", label: "Manufacturer profile" },
      { id: "packaging", icon: "fa-cubes", label: "Package twin" },
      { id: "analytics", icon: "fa-chart-line", label: "Analytics" },
    ];
  }
  return [
    ...common,
    { id: "manufacturers", icon: "fa-industry", label: "Manufacturers" },
    { id: "packaging", icon: "fa-cubes", label: "Package twin" },
    { id: "riskmap", icon: "fa-map", label: "Risk zones" },
    { id: "analytics", icon: "fa-chart-line", label: "Analytics" },
    { id: "rules", icon: "fa-scale-balanced", label: "Compliance rules" },
    { id: "audit", icon: "fa-clipboard-list", label: "Audit logs" },
  ];
}

function buildNav() {
  const s = session();
  const items = navItemsForRole(s.role);
  const openComplaints = complaints().filter((c) => !["Resolved", "Rejected"].includes(c.status)).length;
  document.getElementById("sidebarNav").innerHTML = items
    .map((it) => {
      const badge = it.id === "complaints" && openComplaints ? `<span class="badge">${openComplaints}</span>` : "";
      const scan = it.scan ? `<span class="badge-scan">SCAN</span>` : "";
      return `<div class="nav-item" data-page="${it.id}"><i class="fas ${it.icon}"></i> <span>${it.label}</span>${badge}${scan}</div>`;
    })
    .join("");
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.onclick = () => navigateTo(el.dataset.page);
  });
}

const PAGE_META = {
  dashboard: ["Overview", "Evidence-first overview from stored records only"],
  inspection: ["New inspection", "Upload the package sides you can verify. Nothing is inferred when evidence is missing."],
  history: ["My scans", "Each record links back to its images, OCR output, and extracted fields."],
  products: ["Products", "Derived from inspection records — not a catalog of invented SKUs"],
  complaints: ["My complaints", "Linked to inspection evidence"],
  "new-complaint": ["File a complaint", "Auto-filled from the selected inspection when available"],
  manufacturers: ["Manufacturers", "Aggregated from extracted manufacturer fields"],
  packaging: ["Digital package twin", "Versions and findings for the same product evidence"],
  riskmap: ["Risk zones", "Shown only when location data exists on complaints"],
  analytics: ["Analytics", "Computed from stored inspections and complaints"],
  rules: ["Compliance rules", "Legal Metrology (Packaged Commodities) Rules, 2011"],
  audit: ["Audit logs", "User actions, AI results, and human decisions"],
};

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  const meta = PAGE_META[page] || [page, ""];
  document.getElementById("pageTitle").textContent = meta[0];
  renderPage();
  if (window.innerWidth < 1024) document.getElementById("sidebar").classList.remove("open");
}

function destroyCharts() {
  chartObjs.forEach((c) => c.destroy());
  chartObjs = [];
}

function renderPage() {
  destroyCharts();
  const root = document.getElementById("pageContainer");
  const map = {
    dashboard: renderDashboard,
    inspection: renderInspection,
    history: renderHistory,
    products: renderProducts,
    complaints: renderComplaints,
    "new-complaint": renderNewComplaint,
    manufacturers: renderManufacturers,
    packaging: renderTwin,
    riskmap: renderRisk,
    analytics: renderAnalytics,
    rules: renderRules,
    audit: renderAudit,
  };
  (map[currentPage] || renderDashboard)(root);
}

function liveInspections() {
  return inspections().filter((i) => i.mode !== "DEMO");
}

function renderDashboard(root) {
  const s = session();
  const list = liveInspections();
  const comps = complaints();
  const identified = list.filter((i) => i.classification && !i.classification.unknown).length;

  const heading = s.role === "consumer"
    ? { label: "CONSUMER WORKSPACE", title: "Check what you buy.", lede: "Scan a package to read its declarations, then complain with evidence if something is wrong.", cta: "Scan a product", page: "inspection" }
    : s.role === "company"
    ? { label: "COMPANY WORKSPACE", title: "Ship compliant packaging.", lede: "Run pre-launch checks on proposed packaging, then respond to complaints linked to your products.", cta: "Run pre-launch scan", page: "inspection" }
    : { label: "GOVERNMENT WORKSPACE", title: "Verify. Investigate. Decide.", lede: "Inspect packages, verify findings against evidence, and record investigation decisions.", cta: "New inspection", page: "inspection" };

  root.innerHTML = `
    <div class="page-section-label">${heading.label}</div>
    <div class="page-header-row">
      <div>
        <h1 class="page-display">${heading.title}</h1>
        <p class="page-lede">${heading.lede}</p>
      </div>
      <button class="btn btn-primary" onclick="navigateTo('${heading.page}')"><i class="fas fa-expand"></i> ${heading.cta}</button>
    </div>

    <div class="stats-grid">
      <div class="card stat-card">
        <div class="stat-card-top">
          <div class="stat-label">My scans</div>
          <span class="stat-icon"><i class="fas fa-expand"></i></span>
        </div>
        <div>
          <div class="stat-value">${list.length}</div>
          <div class="stat-foot">Stored on your account</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-card-top">
          <div class="stat-label">Products identified</div>
          <span class="stat-icon"><i class="fas fa-cube"></i></span>
        </div>
        <div>
          <div class="stat-value">${identified}</div>
          <div class="stat-foot">From real image text</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-card-top">
          <div class="stat-label">Evidence kept</div>
          <span class="stat-icon green"><i class="fas fa-shield-halved"></i></span>
        </div>
        <div>
          <div class="stat-value">Yes</div>
          <div class="stat-foot">Images + OCR preserved</div>
        </div>
      </div>
    </div>

    ${recentTable(list)}`;
}

function recentTable(list) {
  if (!list.length) {
    return `<div class="card"><strong style="font-size:1.1rem">Recent scans</strong>
      <p class="text-muted mt-2">Open a scan to review what was found on the label.</p>
      <div class="empty-state mt-4">No scans yet. Upload a real package image to create the first record.</div>
    </div>`;
  }
  return `<div class="card">
    <strong style="font-size:1.1rem">Recent scans</strong>
    <p class="text-muted mt-2">Open a scan to review what was found on the label.</p>
    <div class="mt-4" style="display:flex;flex-direction:column;gap:10px">
      ${list.slice(0, 8).map((i) => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:#fff">
          <span class="stat-icon" style="background:var(--bg-card);color:var(--accent)"><i class="fas fa-cube"></i></span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${escapeHtml(i.productLabel || "Unknown product")}</div>
            <div class="text-muted" style="font-size:0.8rem">${escapeHtml(i.extracted?.fields?.brand?.value || "Brand not detected")} · ${fmtDate(i.createdAt).split(",")[0]}</div>
          </div>
          <span class="badge-status ${statusClass(i.status)}">${escapeHtml(i.status).replace(/_/g," ")}</span>
          <button class="btn btn-sm btn-secondary" onclick="openInspection('${i.id}')">Open</button>
        </div>`).join("")}
    </div>
  </div>`;
}

function statusClass(st) {
  if (st === "COMPLETED" || st === "VERIFIED") return "compliant";
  if (st === "FAILED") return "fail";
  if (st === "REVIEW_REQUIRED") return "review";
  return "pending";
}

function renderInspection(root) {
  const s = session();
  root.innerHTML = `
    <div class="page-section-label">SCAN → UNDERSTAND → IDENTIFY</div>
    <div class="page-header-row">
      <div>
        <h1 class="page-display">New inspection</h1>
        <p class="page-lede">Upload the package sides you can verify. Nothing is inferred when evidence is missing.</p>
      </div>
      <button class="btn btn-secondary" onclick="clearDraft()">Cancel</button>
    </div>

    <div class="scan-layout">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <strong style="font-size:1.05rem">Package image set</strong>
            <p class="text-muted mt-2" style="margin:4px 0 0">Front, back, sides, and top or bottom if available.</p>
          </div>
          <span class="badge-status pending">${draftImages.length} images</span>
        </div>

        <div class="drop-zone mt-4" id="inspDrop">
          <i class="fas fa-cloud-arrow-up"></i>
          <p>Drop or choose package images</p>
          <div class="hint">JPG, PNG, WEBP · max 20MB each</div>
          <input type="file" id="inspFiles" accept="image/*" multiple hidden />
        </div>

        <div class="side-tabs">
          ${SIDES.map((sd) => `<div class="side-tab ${draftImages.length === 0 && sd === "Front" ? "active" : ""}">${sd}</div>`).join("")}
        </div>

        <div class="evidence-grid" id="inspGrid"></div>
        <div id="qualityNotes" class="mt-4"></div>
      </div>

      <div>
        <div class="process-panel">
          <h3><i class="fas fa-wand-magic-sparkles"></i> Evidence-led processing</h3>
          <div class="process-step" id="step-1"><span class="process-num">1</span> Quality check</div>
          <div class="process-step" id="step-2"><span class="process-num">2</span> Preprocess &amp; OCR</div>
          <div class="process-step" id="step-3"><span class="process-num">3</span> Extract fields</div>
          <div class="process-step" id="step-4"><span class="process-num">4</span> Identify product</div>
          <div class="process-step" id="step-5"><span class="process-num">5</span> Save evidence</div>
          <div class="process-note">No default product, score, or result is used when image evidence is insufficient.</div>
        </div>
        <button class="run-panel-btn" id="runBtn" onclick="runLiveInspection()" ${draftImages.length ? "" : "disabled"}>
          <i class="fas fa-shield-halved"></i> Run real inspection
        </button>
        <div class="pipeline" id="pipe"></div>
        <div id="inspStatus" class="text-muted mt-2"></div>
      </div>
    </div>

    <div id="inspResults" class="mt-4"></div>`;
  bindUploader();
  renderDraftGrid();
}

function bindUploader() {
  const drop = document.getElementById("inspDrop");
  const input = document.getElementById("inspFiles");
  if (!drop) return;
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("dragover"); };
  drop.ondragleave = () => drop.classList.remove("dragover");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
  };
  input.onchange = () => addFiles(input.files);
}

async function addFiles(fileList) {
  for (const file of [...fileList]) {
    try {
      const dataUrl = await compressImage(file);
      const quality = await analyzeImageQuality(dataUrl);
      draftImages.push({
        id: uid("IMG"),
        side: SIDES[Math.min(draftImages.length, SIDES.length - 1)],
        name: file.name,
        dataUrl,
        quality,
      });
    } catch (err) {
      toast("Upload rejected", err.message);
    }
  }
  const runBtn = document.getElementById("runBtn");
  if (runBtn) runBtn.disabled = !draftImages.length;
  renderDraftGrid();
}

function renderDraftGrid() {
  const grid = document.getElementById("inspGrid");
  const notes = document.getElementById("qualityNotes");
  if (!grid) return;
  grid.innerHTML = draftImages.map((img, idx) => `
    <div class="evidence-item">
      <img src="${img.dataUrl}" alt="${escapeHtml(img.side)}" />
      <button class="remove-btn" onclick="removeDraft(${idx})">&times;</button>
      <span class="badge-pos">${escapeHtml(img.side)}</span>
    </div>
    <select class="side-select" onchange="setSide(${idx}, this.value)">
      ${SIDES.map((s) => `<option ${s === img.side ? "selected" : ""}>${s}</option>`).join("")}
    </select>`).join("");
  if (notes) {
    notes.innerHTML = draftImages.map((img) => `
      <div class="text-muted" style="font-size:0.75rem">${escapeHtml(img.side)} · ${img.quality.width}×${img.quality.height} · ${escapeHtml(img.quality.message)}
      ${img.quality.tooLow ? ' <span class="badge-status fail">BLOCKED</span>' : ""}</div>`).join("");
  }
}

function setSide(i, side) {
  draftImages[i].side = side;
  renderDraftGrid();
}
function removeDraft(i) {
  draftImages.splice(i, 1);
  const runBtn = document.getElementById("runBtn");
  if (runBtn) runBtn.disabled = !draftImages.length;
  renderDraftGrid();
}
function clearDraft() {
  draftImages = [];
  currentInspection = null;
  renderPage();
}

function setPipe(status) {
  const el = document.getElementById("pipe");
  if (!el) return;
  const idx = PIPELINE.indexOf(status);
  el.innerHTML = PIPELINE.filter((p) => !["FAILED"].includes(p) || status === "FAILED")
    .slice(0, 8)
    .map((p, i) => `<span class="${status === "FAILED" && p === "FAILED" ? "fail" : i < idx ? "done" : i === idx ? "active" : ""}">${p}</span>`)
    .join("");
}

function highlightStep(n) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById("step-" + i);
    if (!el) continue;
    el.classList.toggle("done", i < n);
    el.classList.toggle("active", i === n);
  }
}

async function runLiveInspection() {
  const usable = draftImages.filter((i) => !i.quality.tooLow);
  if (!usable.length) {
    toast("IMAGE QUALITY TOO LOW", "Please upload a clearer package image.");
    document.getElementById("inspStatus").textContent = "IMAGE QUALITY TOO LOW";
    return;
  }
  const s = session();
  const insp = {
    id: uid("INSP"),
    mode: "LIVE",
    createdAt: nowIso(),
    user: s.fullName,
    role: s.role,
    status: "UPLOADED",
    images: usable,
    ocr: [],
    productLabel: "Unable to confidently identify this product.",
  };
  persistInspection(insp);
  audit("inspection_created", { inspection: insp.id });
  const statusEl = document.getElementById("inspStatus");
  const runBtn = document.getElementById("runBtn");
  runBtn.disabled = true;
  try {
    highlightStep(1);
    setPipe("QUALITY");
    statusEl.innerHTML = `<span class="loader"></span> Checking image quality on uploaded files…`;
    highlightStep(2);
    setPipe("OCR_PROCESSING");
    insp.status = "OCR_PROCESSING";
    persistInspection(insp);
    const ocrBlocks = [];
    for (const img of usable) {
      statusEl.innerHTML = `<span class="loader"></span> OCR on ${escapeHtml(img.side)} (${escapeHtml(img.name)}) using Tesseract.js`;
      try {
        const ocr = await runOcr(img.dataUrl);
        ocrBlocks.push({
          imageId: img.id,
          side: img.side,
          text: ocr.text,
          confidence: ocr.confidence,
          engine: ocr.engine,
          timestamp: nowIso(),
          words: ocr.words,
        });
        audit("ocr", { inspection: insp.id, record: img.side, aiResult: `engine=${ocr.engine}; conf=${ocr.confidence}` });
      } catch (e) {
        insp.status = "FAILED";
        insp.error = e.message === "AI SERVICE UNAVAILABLE" ? "AI SERVICE UNAVAILABLE" : "OCR could not reliably extract package text.";
        persistInspection(insp);
        statusEl.textContent = insp.error;
        setPipe("FAILED");
        renderResults(insp);
        return;
      }
    }
    insp.ocr = ocrBlocks;
    const anyText = ocrBlocks.some((b) => b.text && b.text.length > 8);
    if (!anyText) {
      insp.status = "FAILED";
      insp.error = "OCR could not reliably extract package text.";
      persistInspection(insp);
      setPipe("FAILED");
      statusEl.textContent = insp.error;
      renderResults(insp);
      return;
    }
    highlightStep(3);
    setPipe("IDENTIFYING");
    insp.status = "IDENTIFYING";
    const extracted = extractFields(ocrBlocks);
    insp.extracted = extracted;
    const allText = ocrBlocks.map((b) => b.text).join("\n");
    highlightStep(4);
    setPipe("CLASSIFYING");
    insp.status = "CLASSIFYING";
    insp.classification = classifyProduct(allText);
    const nameField = extracted.fields.product_name;
    if (insp.classification.unknown && (!nameField.value || nameField.level === "LOW")) {
      insp.productLabel = "Unable to confidently identify this product.";
    } else {
      insp.productLabel = nameField.value || insp.classification.commodity;
    }
    const rules = await loadRules();
    if (!rules) {
      insp.status = "FAILED";
      insp.error = "VERIFICATION REQUIRED — regulatory knowledge base unavailable.";
      persistInspection(insp);
      statusEl.textContent = insp.error;
      renderResults(insp);
      return;
    }
    setPipe("CHECKING_COMPLIANCE");
    insp.status = "CHECKING_COMPLIANCE";
    const extractedValues = {};
    Object.entries(extracted.fields).forEach(([k, f]) => {
      extractedValues[k] = f.value;
    });
    const catKey = (insp.classification.category || "").toLowerCase();
    const context = {
      is_imported: /import|made in (?!india)/i.test(allText),
      category: catKey.includes("food") ? "food" : catKey.includes("personal") ? "cosmetic" : catKey.includes("beverage") ? "food" : "unknown",
      commodity_sold_loose_or_by_standard_unit: false,
    };
    insp.context = context;
    insp.compliance = evaluateCompliance(extractedValues, context, rules);
    insp.crossSide = findInconsistencies(ocrBlocks, extracted.fields);
    const lowConf = Object.values(extracted.fields).some((f) => f.review);
    insp.status = insp.compliance.review_required || lowConf || insp.classification.unknown ? "REVIEW_REQUIRED" : "COMPLETED";
    if (!insp.compliance.field_results.length) {
      insp.compliance.compliance_score = null;
      insp.scoreUnavailable = true;
    }
    highlightStep(5);
    persistInspection(insp);
    audit("findings", { inspection: insp.id, aiResult: `score=${insp.compliance.compliance_score}; risk=${insp.compliance.risk_level}` });
    setPipe(insp.status);
    statusEl.textContent = `Finished · ${insp.status}`;
    renderResults(insp);
    buildNav();
  } catch (err) {
    insp.status = "FAILED";
    insp.error = err.message || "Network error. Retry the scan.";
    persistInspection(insp);
    setPipe("FAILED");
    statusEl.textContent = insp.error;
    toast("Inspection failed", insp.error);
  } finally {
    runBtn.disabled = false;
  }
}

function fieldRow(f) {
  const conf = f.confidence == null ? "—" : `${Math.round(f.confidence * 100)}%`;
  const val = f.value ? escapeHtml(f.normalized || f.value) : "NOT DETECTED";
  return `<tr>
    <td>${escapeHtml(f.id.replaceAll("_", " "))}</td>
    <td>${escapeHtml(f.raw)}</td>
    <td>${val}${f.review && f.value ? ' <span class="badge-status review">REQUIRES HUMAN REVIEW</span>' : ""}</td>
    <td>${conf} · ${escapeHtml(f.level)}</td>
    <td>${escapeHtml(f.sourceImage)}</td>
  </tr>`;
}

function renderResults(insp) {
  const box = document.getElementById("inspResults");
  if (!box) {
    currentInspection = insp;
    navigateTo("history");
    setTimeout(() => openInspection(insp.id), 50);
    return;
  }
  currentInspection = insp;
  if (insp.error && !insp.extracted) {
    box.innerHTML = `<div class="card"><span class="badge-status fail">${escapeHtml(insp.status)}</span><p class="mt-4">${escapeHtml(insp.error)}</p>
      <button class="btn btn-primary mt-4" onclick="runLiveInspection()">Retry</button></div>`;
    return;
  }
  const c = insp.compliance;
  const scoreLabel = insp.scoreUnavailable || c.compliance_score == null ? "COMPLIANCE SCORE NOT AVAILABLE" : `${c.compliance_score}/100`;
  const findings = (c.field_results || []).filter((f) => f.engineStatus !== "PASS");
  box.innerHTML = `
    <div class="grid-2 mb-4">
      <div class="card">
        <div class="text-muted">Product identification</div>
        <h2 style="margin:6px 0">${escapeHtml(insp.productLabel)}</h2>
        <div>Category: <strong>${escapeHtml(insp.classification.category)}</strong> → ${escapeHtml(insp.classification.subcategory)}</div>
        <div class="text-muted mt-2">${insp.classification.unknown ? "UNKNOWN PRODUCT — REVIEW REQUIRED" : "Classification uses visible OCR keywords only."}</div>
        ${insp.mode === "DEMO" ? '<span class="badge-status demo mt-2">DEMO MODE</span>' : '<span class="badge-status pass mt-2">LIVE INSPECTION</span>'}
      </div>
      <div class="card">
        <div class="text-muted">Compliance &amp; risk</div>
        <div class="stat-value">${scoreLabel}</div>
        <div class="mt-2"><span class="badge-status ${statusClass(insp.status)}">${escapeHtml(insp.status)}</span>
          <span class="badge-status ${c.risk_level.toLowerCase()}">${escapeHtml(c.risk_level)} RISK</span></div>
        <p class="text-muted mt-2">Score = 100 − severity weights of failed mandatory declarations. Low OCR confidence is not auto-confirmed as a violation.</p>
      </div>
    </div>
    <div class="card mb-4">
      <strong>Extracted declarations</strong>
      <div class="table-wrap mt-2"><table><thead><tr><th>Field</th><th>Raw OCR</th><th>Normalized</th><th>Confidence</th><th>Source</th></tr></thead>
      <tbody>${Object.values(insp.extracted.fields).map(fieldRow).join("")}</tbody></table></div>
    </div>
    <div class="card mb-4">
      <strong>Explainable findings</strong>
      ${(insp.crossSide || []).map(renderFindingCard).join("")}
      ${findings.map((f) => renderRuleFinding(f, insp)).join("") || '<div class="empty-state mt-2">No failed mandatory declarations. Remaining uncertainty is listed as NOT DETECTED above.</div>'}
    </div>
    <div class="card mb-4">
      <strong>Human verification</strong>
      <p class="text-muted">AI result is stored separately from your decision.</p>
      <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
        <button class="btn btn-success" onclick="verifyInspection('${insp.id}','confirm')">Confirm AI findings</button>
        <button class="btn btn-danger" onclick="verifyInspection('${insp.id}','reject')">Reject as false positive</button>
        <button class="btn btn-secondary" onclick="editFieldPrompt('${insp.id}')">Edit a field</button>
      </div>
      <div class="text-muted mt-2">${insp.human ? `${escapeHtml(insp.human.decision)} by ${escapeHtml(insp.human.reviewer)} at ${fmtDate(insp.human.timestamp)}${insp.human.comment ? " — " + escapeHtml(insp.human.comment) : ""}` : "No human decision yet."}</div>
    </div>
    <div class="card mb-4">
      <strong>Did you find a problem?</strong>
      <p class="text-secondary mt-2">If something appears incorrect, report it from this inspection. The complaint is linked to the same evidence.</p>
      <button class="btn btn-primary" onclick="startComplaintFrom('${insp.id}')">File a complaint</button>
      <button class="btn btn-secondary" onclick="downloadReport('${insp.id}')">Download report</button>
    </div>
    <div class="card">
      <strong>Raw OCR (per side)</strong>
      ${insp.ocr.map((b) => `<div class="mt-4"><div class="text-muted">${escapeHtml(b.side)} · ${escapeHtml(b.engine)} · ${Math.round(b.confidence * 100)}%</div><div class="ocr-box">${escapeHtml(b.text || "(empty)")}</div></div>`).join("")}
    </div>`;
}

function renderFindingCard(f) {
  return `<div class="finding">
    <div class="flex-between"><strong>${escapeHtml(f.type)} · ${escapeHtml(f.field)}</strong><span class="badge-status review">${escapeHtml(f.status)}</span></div>
    <div class="mt-2"><b>WHAT</b> ${escapeHtml(f.what)}</div>
    <div><b>WHERE</b> ${escapeHtml(f.where)}</div>
    <div><b>WHY</b> ${escapeHtml(f.why)}</div>
    <div><b>RULE</b> ${escapeHtml(f.rule)}</div>
    <div><b>CONFIDENCE</b> ${Math.round(f.confidence * 100)}%</div>
    <div><b>NEXT ACTION</b> ${escapeHtml(f.next)}</div>
    <button class="btn btn-sm btn-secondary mt-2" onclick='openEvidence(${JSON.stringify(f.evidence || [])}, ${JSON.stringify(f.what)})'>View evidence</button>
  </div>`;
}

function renderRuleFinding(f, insp) {
  const field = insp.extracted.fields[f.field_id];
  const img = insp.images.find((i) => i.id === field?.imageId) || insp.images[0];
  return `<div class="finding">
    <div class="flex-between"><strong>${escapeHtml(f.status)} · ${escapeHtml(f.label)}</strong><span class="badge-status ${f.severity}">${escapeHtml(f.severity)}</span></div>
    <div class="mt-2"><b>WHAT</b> ${escapeHtml(field?.raw || "NOT DETECTED")}</div>
    <div><b>WHERE</b> ${escapeHtml(field?.sourceImage || "No supporting image region")}</div>
    <div><b>WHY</b> ${escapeHtml(f.message)} (${escapeHtml(f.reason)})</div>
    <div><b>RULE</b> ${escapeHtml(f.rule_reference)} · ${escapeHtml(f.source)}</div>
    <div><b>CONFIDENCE</b> ${field?.confidence == null ? "N/A" : Math.round(field.confidence * 100) + "%"} · ${escapeHtml(field?.level || "UNKNOWN")}</div>
    <div><b>NEXT ACTION</b> Verify the physical pack and record a human decision.</div>
    <button class="btn btn-sm btn-secondary mt-2" onclick='openEvidenceImage("${img?.id || ""}","${escapeHtml(f.label)}","${escapeHtml(field?.raw || "NOT DETECTED")}")'>View evidence</button>
  </div>`;
}

function openEvidence(evidence, what) {
  const insp = currentInspection;
  const images = (evidence || []).map((e) => insp.images.find((i) => i.id === e.imageId)).filter(Boolean);
  showEvidence(images[0] || insp.images[0], what, evidence);
}
function openEvidenceImage(imageId, label, value) {
  const insp = currentInspection;
  const img = insp.images.find((i) => i.id === imageId) || insp.images[0];
  showEvidence(img, `${label}: ${value}`, [{ label, value }]);
}
function showEvidence(img, detail, meta) {
  evidenceContext = { img, detail, meta, inspectionId: currentInspection?.id };
  const content = document.getElementById("evidenceContent");
  if (!img) {
    content.innerHTML = `<p class="text-muted">No uploaded image is attached to this finding. Placeholder evidence is never shown.</p>`;
  } else {
    content.innerHTML = `<div class="evidence-img-wrap"><img src="${img.dataUrl}" alt="${escapeHtml(img.side)}" /><span class="badge-pos">${escapeHtml(img.side)}</span></div>`;
  }
  document.getElementById("evidenceDetail").innerHTML = `<strong>${escapeHtml(detail || "")}</strong><div class="text-muted mt-2">Human verification is stored separately from the OCR result.</div>`;
  document.getElementById("evidenceModal").classList.add("show");
  document.getElementById("evidenceVerifyBtn").onclick = () => {
    verifyInspection(currentInspection.id, "confirm");
    closeEvidenceModal();
  };
  document.getElementById("evidenceRejectBtn").onclick = () => {
    verifyInspection(currentInspection.id, "reject");
    closeEvidenceModal();
  };
}
function closeEvidenceModal() {
  document.getElementById("evidenceModal").classList.remove("show");
}

function verifyInspection(id, decision) {
  const all = inspections();
  const insp = all.find((i) => i.id === id);
  if (!insp) return;
  const comment = decision === "reject" ? prompt("Comment (optional) for this human decision:") : "";
  insp.human = {
    decision: decision === "confirm" ? "Confirmed" : "Rejected",
    reviewer: session().fullName,
    role: session().role,
    timestamp: nowIso(),
    comment: comment || "",
    aiStatus: insp.status,
  };
  insp.status = decision === "confirm" ? "VERIFIED" : "REVIEW_REQUIRED";
  persistInspection(insp);
  audit("human_verification", { inspection: id, humanDecision: insp.human.decision, previousValue: insp.human.aiStatus, newValue: insp.status, comment: insp.human.comment });
  toast("Human decision saved", insp.human.decision);
  if (currentPage === "inspection") renderResults(insp);
  else renderPage();
}

function editFieldPrompt(id) {
  const insp = inspections().find((i) => i.id === id);
  const key = prompt("Field id to edit (e.g. retail_sale_price, net_quantity, consumer_care_details):");
  if (!key || !insp.extracted.fields[key]) {
    toast("Unknown field", "No change made.");
    return;
  }
  const prev = insp.extracted.fields[key].value;
  const next = prompt("New verified value (leave empty for NOT DETECTED):", prev || "");
  insp.extracted.fields[key].value = next || null;
  insp.extracted.fields[key].normalized = next || "NOT DETECTED";
  insp.extracted.fields[key].raw = next || "NOT DETECTED";
  insp.extracted.fields[key].review = false;
  insp.extracted.fields[key].level = next ? "HIGH" : "UNKNOWN";
  persistInspection(insp);
  audit("field_edit", { inspection: id, record: key, previousValue: prev, newValue: next });
  toast("Field updated", key);
  openInspection(id);
}

function openInspection(id) {
  const insp = inspections().find((i) => i.id === id);
  if (!insp) return;
  currentInspection = insp;
  currentPage = "inspection";
  buildNav();
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === "inspection"));
  document.getElementById("pageTitle").textContent = `Inspection ${insp.id}`;
  draftImages = insp.images.map((x) => ({ ...x }));
  const root = document.getElementById("pageContainer");
  root.innerHTML = `<div id="pipe" class="pipeline"></div><div id="inspStatus" class="text-muted mb-4">${escapeHtml(insp.status)}</div><div id="inspResults"></div>
    <div class="mt-4"><button class="btn btn-secondary" onclick="navigateTo('inspection')">Start a new live scan</button></div>`;
  setPipe(insp.status);
  renderResults(insp);
}

function downloadReport(id) {
  const insp = inspections().find((i) => i.id === id);
  if (!insp) return;
  const lines = [
    "SMARTMETRA AI — INSPECTION REPORT",
    "========================================",
    `Inspection ID: ${insp.id}`,
    `Date: ${fmtDate(insp.createdAt)}`,
    `User/Inspector: ${insp.user} (${insp.role})`,
    `Mode: ${insp.mode}`,
    `Product: ${insp.productLabel}`,
    `Category: ${insp.classification?.category} / ${insp.classification?.subcategory}`,
    `Status: ${insp.status}`,
    `Compliance score: ${insp.compliance?.compliance_score ?? "NOT AVAILABLE"}`,
    `Risk: ${insp.compliance?.risk_level ?? "N/A"}`,
    "",
    "EXTRACTED FIELDS",
    ...Object.values(insp.extracted?.fields || {}).map((f) => `- ${f.id}: raw=${f.raw} | normalized=${f.normalized} | conf=${f.confidence ?? "n/a"} | source=${f.sourceImage}`),
    "",
    "FINDINGS",
    ...(insp.compliance?.field_results || []).filter((f) => f.engineStatus !== "PASS").map((f) => `- ${f.status} ${f.label} [${f.rule_reference}] ${f.message}`),
    "",
    "HUMAN VERIFICATION",
    insp.human ? `${insp.human.decision} by ${insp.human.reviewer} at ${insp.human.timestamp}` : "None",
    "",
    "AI-generated analysis is decision support. It is not a legal finding.",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `SmartMetra_${insp.id}.txt`;
  a.click();
  if (window.jspdf) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(11);
    lines.forEach((line, i) => doc.text(line.slice(0, 95), 10, 12 + i * 6));
    doc.save(`SmartMetra_${insp.id}.pdf`);
  }
  audit("report_generated", { inspection: id });
  toast("Report generated", "Text report downloaded. PDF downloaded if jsPDF loaded.");
}

function startComplaintFrom(id) {
  currentInspection = inspections().find((i) => i.id === id);
  navigateTo("new-complaint");
}

function renderHistory(root) {
  const list = inspections();
  if (!list.length) {
    root.innerHTML = `<div class="page-section-label">STORED RECORDS</div>
      <h1 class="page-display">Inspections</h1>
      <p class="page-lede">Each record links back to its images, OCR output, and extracted fields.</p>
      <div class="empty-state">No inspections stored. Upload a real package image to create the first record.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="page-section-label">STORED RECORDS</div>
    <div class="page-header-row">
      <div>
        <h1 class="page-display">Inspections</h1>
        <p class="page-lede">Each record links back to its images, OCR output, and extracted fields.</p>
      </div>
      <button class="btn btn-primary" onclick="navigateTo('inspection')"><i class="fas fa-plus"></i> New inspection</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>Mode</th><th>Product</th><th>Score</th><th>Status</th><th>When</th><th></th></tr></thead>
        <tbody>${list.map((i) => `<tr>
          <td>${escapeHtml(i.id)}</td>
          <td>${i.mode === "DEMO" ? '<span class="badge-status demo">DEMO</span>' : '<span class="badge-status pass">LIVE</span>'}</td>
          <td>${escapeHtml(i.productLabel)}</td>
          <td>${i.compliance?.compliance_score ?? "N/A"}</td>
          <td><span class="badge-status ${statusClass(i.status)}">${escapeHtml(i.status)}</span></td>
          <td>${fmtDate(i.createdAt)}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="openInspection('${i.id}')">Open</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
}

function renderProducts(root) {
  const map = new Map();
  liveInspections().forEach((i) => {
    const key = i.productLabel;
    if (!map.has(key)) map.set(key, { name: key, category: i.classification?.category, scans: 0, last: i.createdAt, score: i.compliance?.compliance_score });
    const row = map.get(key);
    row.scans += 1;
    row.last = i.createdAt;
  });
  const rows = [...map.values()];
  root.innerHTML = `
    <div class="page-section-label">PRODUCTS</div>
    <h1 class="page-display">Products</h1>
    <p class="page-lede">Derived from inspection records — not a catalog of invented SKUs.</p>
    ${rows.length
      ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Scans</th><th>Last score</th><th>Last seen</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${r.scans}</td><td>${r.score ?? "N/A"}</td><td>${fmtDate(r.last)}</td></tr>`).join("")}
        </tbody></table></div></div>`
      : `<div class="empty-state">No product records. Products appear only after a live scan.</div>`}`;
}

function renderComplaints(root) {
  const list = complaints();
  const s = session();
  root.innerHTML = `
    <div class="page-section-label">COMPLAINTS</div>
    <h1 class="page-display">${s.role === "consumer" ? "My complaints" : "Complaints"}</h1>
    <p class="page-lede">Complaints stay linked to their inspection evidence.</p>
    ${list.length ? `<div class="card">${list.map((c) => `
      <div class="finding">
        <div class="flex-between"><strong>${escapeHtml(c.id)}</strong><span class="badge-status ${c.status === "Resolved" ? "resolved" : "pending"}">${escapeHtml(c.status)}</span></div>
        <div class="text-muted">${escapeHtml(c.productName)} · Inspection ${escapeHtml(c.inspectionId || "—")}</div>
        <p class="mt-2">${escapeHtml(c.body)}</p>
        ${c.response ? `<div class="mt-2"><b>Company response:</b> ${escapeHtml(c.response.text)} (${fmtDate(c.response.at)})</div>` : ""}
        ${c.decision ? `<div class="mt-2"><b>Government decision:</b> ${escapeHtml(c.decision.text)}</div>` : ""}
        <div class="flex gap-2 mt-2" style="flex-wrap:wrap">
          ${c.inspectionId ? `<button class="btn btn-sm btn-secondary" onclick="openInspection('${c.inspectionId}')">Linked inspection</button>` : ""}
          ${s.role === "company" ? `<button class="btn btn-sm btn-primary" onclick="respondComplaint('${c.id}')">Respond</button>` : ""}
          ${s.role === "government" ? `<button class="btn btn-sm btn-success" onclick="decideComplaint('${c.id}')">Investigate / decide</button>` : ""}
        </div>
      </div>`).join("")}</div>` : `<div class="empty-state">No complaints stored.</div>`}`;
}

function draftComplaintText(insp, concern) {
  const missing = Object.values(insp.extracted?.fields || {}).filter((f) => !f.value).map((f) => f.id.replaceAll("_", " "));
  const findings = (insp.compliance?.field_results || []).filter((f) => f.engineStatus === "FAIL").map((f) => f.label);
  return [
    `Complaint regarding packaged commodity inspected as ${insp.id}.`,
    `User concern: ${concern || "(not specified)"}.`,
    `Identified product text: ${insp.productLabel}.`,
    `Category (from visible keywords): ${insp.classification?.category} / ${insp.classification?.subcategory}.`,
    findings.length ? `Potential issues flagged for review (not confirmed violations): ${findings.join("; ")}.` : "No failed mandatory declarations were flagged.",
    missing.length ? `Fields NOT DETECTED on the uploaded images: ${missing.join(", ")}.` : "",
    `Risk assessment from available evidence: ${insp.compliance?.risk_level || "N/A"}.`,
    "This complaint is evidence-based decision support. It does not state that a company has definitely violated the law unless an authorized officer so decides.",
  ].filter(Boolean).join(" ");
}

function renderNewComplaint(root) {
  const insp = currentInspection;
  root.innerHTML = `
    <div class="page-section-label">NEW COMPLAINT</div>
    <h1 class="page-display">File a complaint</h1>
    <p class="page-lede">Auto-filled from the selected inspection when available.</p>
    <div class="card">
      ${insp ? `<div class="badge-status pass mb-4">Linked to ${escapeHtml(insp.id)}</div>` : `<div class="badge-status review mb-4">No inspection selected — file after a scan for auto-fill</div>`}
      <div class="form-group"><label>Your concern</label><textarea id="concernBox" placeholder="e.g. MRP seems incorrect on one side of the pack"></textarea></div>
      <button class="btn btn-secondary mb-4" onclick="generateComplaintDraft()" ${insp ? "" : "disabled"}>Generate evidence-based draft</button>
      <div class="form-group"><label>Complaint (editable)</label><textarea id="complaintBody">${insp ? escapeHtml(draftComplaintText(insp, "")) : ""}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Product name</label><input id="cProduct" value="${escapeHtml(insp?.productLabel || "")}" /></div>
        <div class="form-group"><label>Brand</label><input id="cBrand" value="${escapeHtml(insp?.extracted?.fields?.brand?.value || "")}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Manufacturer</label><input id="cMfg" value="${escapeHtml(insp?.extracted?.fields?.manufacturer_packer_importer?.value || "")}" /></div>
        <div class="form-group"><label>Location (optional)</label><input id="cLoc" placeholder="Only if known — never invented" /></div>
      </div>
      ${insp?.images?.length ? `<div class="text-muted mb-4">Evidence images from the inspection will be attached (${insp.images.length}).</div>` : ""}
      <button class="btn btn-primary" onclick="submitComplaint()">Submit complaint</button>
    </div>`;
}

function generateComplaintDraft() {
  const insp = currentInspection;
  if (!insp) return;
  const concern = document.getElementById("concernBox").value.trim();
  document.getElementById("complaintBody").value = draftComplaintText(insp, concern);
  audit("complaint_draft", { inspection: insp.id });
}

function submitComplaint() {
  const body = document.getElementById("complaintBody").value.trim();
  if (!body) {
    toast("Incomplete", "Complaint text is required.");
    return;
  }
  const insp = currentInspection;
  const rec = {
    id: uid("CMP"),
    createdAt: nowIso(),
    by: session().fullName,
    role: session().role,
    status: "Pending",
    body,
    concern: document.getElementById("concernBox").value.trim(),
    productName: document.getElementById("cProduct").value || insp?.productLabel || "NOT DETECTED",
    brand: document.getElementById("cBrand").value || "NOT DETECTED",
    manufacturer: document.getElementById("cMfg").value || "NOT DETECTED",
    location: document.getElementById("cLoc").value.trim() || null,
    inspectionId: insp?.id || null,
    evidenceCount: insp?.images?.length || 0,
    findings: insp?.compliance?.field_results || [],
    risk: insp?.compliance?.risk_level || null,
  };
  persistComplaint(rec);
  if (insp) {
    insp.complaintId = rec.id;
    persistInspection(insp);
  }
  audit("complaint_submitted", { complaint: rec.id, inspection: rec.inspectionId });
  toast("Complaint filed", rec.id);
  navigateTo("complaints");
}

function respondComplaint(id) {
  const text = prompt("Company response (factual, non-defamatory):");
  if (!text) return;
  const all = complaints();
  const c = all.find((x) => x.id === id);
  c.response = { text, at: nowIso(), by: session().fullName };
  c.status = "Company responded";
  persistComplaint(c);
  audit("complaint_response", { complaint: id, comment: text });
  renderPage();
}

function decideComplaint(id) {
  const text = prompt("Investigation note / final decision:");
  if (!text) return;
  const status = prompt("Status: Investigating, Resolved, or Rejected", "Investigating");
  const all = complaints();
  const c = all.find((x) => x.id === id);
  c.decision = { text, at: nowIso(), by: session().fullName };
  c.status = status || "Investigating";
  persistComplaint(c);
  audit("investigation_decision", { complaint: id, newValue: c.status, comment: text });
  renderPage();
}

function renderManufacturers(root) {
  const map = new Map();
  liveInspections().forEach((i) => {
    const name = i.extracted?.fields?.manufacturer_packer_importer?.value;
    if (!name) return;
    if (!map.has(name)) map.set(name, { name, scans: 0, issues: 0 });
    const row = map.get(name);
    row.scans += 1;
    row.issues += (i.compliance?.field_results || []).filter((f) => f.engineStatus === "FAIL").length;
  });
  const rows = [...map.values()];
  root.innerHTML = `
    <div class="page-section-label">MANUFACTURERS</div>
    <h1 class="page-display">Manufacturers</h1>
    <p class="page-lede">Aggregated from extracted manufacturer fields.</p>
    ${rows.length
      ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Manufacturer (from OCR)</th><th>Scans</th><th>Failed declarations</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${r.scans}</td><td>${r.issues}</td></tr>`).join("")}</tbody></table></div></div>`
      : `<div class="empty-state">INSUFFICIENT DATA — manufacturer names appear only when OCR detects them.</div>`}`;
}

function renderTwin(root) {
  const byName = new Map();
  liveInspections().forEach((i) => {
    const k = i.productLabel;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(i);
  });
  const groups = [...byName.entries()].filter(([, v]) => v.length);
  root.innerHTML = `
    <div class="page-section-label">DIGITAL PACKAGE TWIN</div>
    <h1 class="page-display">Package twin</h1>
    <p class="page-lede">Versions and findings for the same product evidence.</p>
    ${groups.length ? groups.map(([name, vers]) => `
      <div class="card mb-4">
        <strong>${escapeHtml(name)}</strong>
        <p class="text-muted">Versions = inspection history for this label text</p>
        ${vers.length > 1 ? compareVersions(vers[1], vers[0]) : `<div class="text-muted">Only one version on file (${escapeHtml(vers[0].id)}).</div>`}
      </div>`).join("")
      : `<div class="empty-state">No package twins yet. Scan the same product more than once to compare versions.</div>`}`;
}

function compareVersions(a, b) {
  const keys = ["retail_sale_price", "net_quantity", "product_name", "manufacturer_packer_importer", "month_year_of_manufacture"];
  return `<div class="table-wrap"><table><thead><tr><th>Field</th><th>${escapeHtml(a.id)}</th><th>${escapeHtml(b.id)}</th></tr></thead><tbody>
    ${keys.map((k) => {
      const av = a.extracted?.fields?.[k]?.normalized || "NOT DETECTED";
      const bv = b.extracted?.fields?.[k]?.normalized || "NOT DETECTED";
      const changed = av !== bv;
      return `<tr><td>${k}</td><td>${escapeHtml(av)}</td><td>${changed ? `<span class="text-amber">${escapeHtml(bv)}</span>` : escapeHtml(bv)}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}

function renderRisk(root) {
  const withLoc = complaints().filter((c) => c.location);
  root.innerHTML = `
    <div class="page-section-label">RISK ZONES</div>
    <h1 class="page-display">Risk zones</h1>
    <p class="page-lede">Shown only when location data exists on complaints.</p>
    ${!withLoc.length ? `<div class="empty-state">LOCATION DATA INSUFFICIENT — geographic risk is shown only when a complainant enters a real location. Locations are never invented.</div>` : ""}`;
}

function renderAnalytics(root) {
  const list = liveInspections();
  const comps = complaints();
  root.innerHTML = `
    <div class="page-section-label">ANALYTICS</div>
    <h1 class="page-display">Analytics</h1>
    <p class="page-lede">Computed from stored inspections and complaints.</p>`;
  if (!list.length && !comps.length) {
    root.innerHTML += `<div class="empty-state">INSUFFICIENT DATA — charts use stored inspections and complaints only. No fabricated statistics.</div>`;
    return;
  }
  root.innerHTML += `<div class="grid-2">
    <div class="card"><strong>Inspection outcomes</strong><canvas id="c1" height="160"></canvas></div>
    <div class="card"><strong>Complaint status</strong><canvas id="c2" height="160"></canvas></div>
  </div>`;
  const statusCount = {};
  list.forEach((i) => { statusCount[i.status] = (statusCount[i.status] || 0) + 1; });
  const cstat = {};
  comps.forEach((c) => { cstat[c.status] = (cstat[c.status] || 0) + 1; });
  if (window.Chart) {
    chartObjs.push(new Chart(document.getElementById("c1"), {
      type: "bar",
      data: { labels: Object.keys(statusCount), datasets: [{ label: "Inspections", data: Object.values(statusCount), backgroundColor: "#0E7490" }] },
      options: { plugins: { legend: { display: false } } },
    }));
    if (comps.length) {
      chartObjs.push(new Chart(document.getElementById("c2"), {
        type: "doughnut",
        data: { labels: Object.keys(cstat), datasets: [{ data: Object.values(cstat), backgroundColor: ["#D97706", "#0E7490", "#059669", "#94a3b8", "#DC2626"] }] },
      }));
    } else {
      document.getElementById("c2").parentElement.innerHTML = "<strong>Complaint status</strong><p class='text-muted mt-4'>INSUFFICIENT DATA</p>";
    }
  }
}

async function renderRules(root) {
  const rules = await loadRules();
  root.innerHTML = `
    <div class="page-section-label">COMPLIANCE RULES</div>
    <h1 class="page-display">Compliance rules</h1>
    <p class="page-lede">Legal Metrology (Packaged Commodities) Rules, 2011</p>`;
  if (!rules) {
    root.innerHTML += `<div class="empty-state">VERIFICATION REQUIRED — could not load legal_metrology_rules.json.</div>`;
    return;
  }
  root.innerHTML += `<div class="card mb-4">
    <strong>${escapeHtml(rules.regulation)}</strong>
    <p class="text-muted">${escapeHtml(rules.jurisdiction)} · ${escapeHtml(rules.version_notes)}</p>
  </div>
  <div class="card"><div class="table-wrap"><table><thead><tr><th>Field</th><th>Rule</th><th>Required</th><th>Severity if missing</th></tr></thead><tbody>
    ${rules.mandatory_declarations.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.rule_reference)}</td><td>${r.required ? "Yes" : r.required_if_applicable ? "If applicable" : "No"}</td><td>${escapeHtml(r.severity_if_missing)}</td></tr>`).join("")}
  </tbody></table></div>
  <p class="text-muted mt-4">Font size: ${escapeHtml(rules.font_and_size_rules.rule_reference)}. Pixel-to-mm font measurement is not claimed unless camera calibration exists.</p>
  </div>`;
}

function renderAudit(root) {
  const logs = auditLogs();
  root.innerHTML = `
    <div class="page-section-label">AUDIT LOGS</div>
    <h1 class="page-display">Audit logs</h1>
    <p class="page-lede">User actions, AI results, and human decisions.</p>
    ${logs.length
      ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Inspection / complaint</th><th>Decision</th></tr></thead><tbody>
          ${logs.slice(0, 80).map((l) => `<tr><td>${fmtDate(l.timestamp)}</td><td>${escapeHtml(l.user)} (${escapeHtml(l.role)})</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.inspection || l.complaint || l.record || "—")}</td><td>${escapeHtml(l.humanDecision || l.newValue || "")}</td></tr>`).join("")}
        </tbody></table></div></div>`
      : `<div class="empty-state">No audit events yet.</div>`}`;
}

function toggleChat() {
  const panel = document.getElementById("chatPanel");
  if (!panel) return;
  const isOpen = panel.classList.contains("open");
  panel.classList.toggle("open", !isOpen);
  if (!isOpen) {
    toggleNotifications(false);
  }
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  const box = document.getElementById("chatMessages");
  box.innerHTML += `<div class="msg user">${escapeHtml(msg)}</div>`;
  box.innerHTML += `<div class="msg bot">${escapeHtml(copilotAnswer(msg))}</div>`;
  box.scrollTop = box.scrollHeight;
}

function copilotAnswer(q) {
  const t = q.toLowerCase();
  const insp = currentInspection;
  const rulesNote = "Answers use Legal Metrology (Packaged Commodities) Rules, 2011 when a rule is cited.";
  if (!insp && (t.includes("flag") || t.includes("missing") || t.includes("evidence") || t.includes("rule"))) {
    return "No current inspection is loaded. Open a live scan first. I will not invent findings.";
  }
  if (t.includes("flag") || t.includes("why")) {
    const fails = (insp.compliance?.field_results || []).filter((f) => f.engineStatus === "FAIL");
    if (!fails.length) return `This inspection was not flagged for failed mandatory declarations. Status is ${insp.status}. ${rulesNote}`;
    return `Flagged for review because: ${fails.map((f) => `${f.label} (${f.reason}) [${f.rule_reference}]`).join("; ")}. These are not automatic legal conclusions.`;
  }
  if (t.includes("evidence")) {
    return insp.images?.length
      ? `Evidence is the uploaded image(s): ${insp.images.map((i) => i.side).join(", ")}. Open View evidence on a finding to see the actual photo.`
      : "No uploaded images are attached.";
  }
  if (t.includes("missing")) {
    const missing = Object.values(insp.extracted?.fields || {}).filter((f) => !f.value).map((f) => f.id);
    return missing.length ? `NOT DETECTED on the uploaded images: ${missing.join(", ")}.` : "No fields are marked NOT DETECTED.";
  }
  if (t.includes("rule") || t.includes("regulation")) {
    return "Mandatory pack declarations include manufacturer/packer/importer (Rule 6(1)(a)), generic name (6(1)(b)), net quantity (6(1)(c), Rule 8), consumer care (6(1)(d)), month/year of manufacture (6(1)(e)), and MRP inclusive of taxes (6(1)(f), Rule 18).";
  }
  if (t.includes("complaint")) {
    return "Use File a complaint on the inspection. The draft is built from this inspection only and stays editable.";
  }
  return "I can explain flags, missing fields, evidence, applicable Rule 6 declarations, or help file a complaint — only from the loaded inspection and the rules file. I will not guess brands or scores.";
}

function applyTheme() {
  /* theme removed — always light */
}

const menuBtn = document.getElementById("menuToggle");
if (menuBtn) menuBtn.onclick = () => document.getElementById("sidebar").classList.toggle("open");

document.getElementById("chatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});
document.getElementById("evidenceModal")?.addEventListener("click", (e) => {
  if (e.target.id === "evidenceModal") closeEvidenceModal();
});

document.getElementById("notificationBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleNotifications();
});
document.getElementById("clearNotificationsBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  clearNotifications();
});

document.getElementById("authModal")?.addEventListener("click", (e) => {
  if (e.target.id === "authModal") closeAuthModal();
});
document.getElementById("googleModal")?.addEventListener("click", (e) => {
  if (e.target.id === "googleModal") cancelGoogle();
});
document.getElementById("authPassword")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAuth();
});
document.getElementById("authEmail")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAuth();
});
document.getElementById("authOrg")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAuth();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("googleModal")?.classList.contains("show")) return cancelGoogle();
  if (document.getElementById("authModal")?.classList.contains("show")) closeAuthModal();
});

document.addEventListener("click", (event) => {
  const target = event.target;
  const notificationPanel = document.getElementById("notificationPanel");
  const notificationBtn = document.getElementById("notificationBtn");
  if (notificationPanel && notificationBtn && !notificationPanel.contains(target) && !notificationBtn.contains(target)) {
    toggleNotifications(false);
  }

  const chatPanel = document.getElementById("chatPanel");
  const chatFab = document.getElementById("chatFab");
  if (chatPanel && chatFab && !chatPanel.contains(target) && !chatFab.contains(target) && target.id !== "chatInput") {
    chatPanel.classList.remove("open");
  }
});

window.selectRole = selectRole;
window.handleLogin = handleLogin;
window.logout = logout;
window.navigateTo = navigateTo;
window.toggleChat = toggleChat;
window.toggleNotifications = toggleNotifications;
window.clearNotifications = clearNotifications;
window.sendChatMessage = sendChatMessage;
window.clearDraft = clearDraft;
window.runLiveInspection = runLiveInspection;
window.removeDraft = removeDraft;
window.setSide = setSide;
window.openInspection = openInspection;
window.verifyInspection = verifyInspection;
window.editFieldPrompt = editFieldPrompt;
window.downloadReport = downloadReport;
window.startComplaintFrom = startComplaintFrom;
window.generateComplaintDraft = generateComplaintDraft;
window.submitComplaint = submitComplaint;
window.respondComplaint = respondComplaint;
window.decideComplaint = decideComplaint;
window.openEvidence = openEvidence;
window.openEvidenceImage = openEvidenceImage;
window.closeEvidenceModal = closeEvidenceModal;

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.setAuthRole = setAuthRole;
window.toggleAuthMode = toggleAuthMode;
window.submitAuth = submitAuth;
window.continueWithGoogle = continueWithGoogle;
window.cancelGoogle = cancelGoogle;
window.googlePick = googlePick;
window.closeGoogleModal = closeGoogleModal;

(async function init() {
  document.getElementById("appShell").style.display = "none";
  document.getElementById("chatFab").style.display = "none";
  syncChatWidgetPosition();
  renderNotifications();
  await loadRules();
  if (session()) {
    bootApp();
  } else {
    document.body.classList.remove("app-ready");
    document.getElementById("loginPage").style.display = "block";
  }
})();