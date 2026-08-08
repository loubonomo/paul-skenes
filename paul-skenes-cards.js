// paul-skenes-cards.js — UI functions & runtime state
// Data (CARDS, PARALLEL_TEMPLATES) lives in paul-skenes-cards.html

const LS_KEY = 'skenes_owned_v2';
const LS_KEY_V3 = 'skenes_owned_v4';  // legacy
const LS_KEY_V5 = 'skenes_owned_v5';  // legacy
const LS_KEY_V6 = 'skenes_owned_v6';  // v6 — split PSA/Raw qty+cost per card
let ownedData = new Map();

// ownedSet.has(rowId) returns true if ANY variant of that card is owned.
// For base card rows (s|* / ua-*): checks for rowId__base and any rowId__* entry.
// For user-added parallels (up-*) and explicit variant keys (contains __): direct lookup.
const ownedSet = {
  has: id => {
    if (id.includes('__') || id.startsWith('up-')) return ownedData.has(id);
    const prefix = id + '__';
    for (const key of ownedData.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }
};

// Migrate ownership keys.
// Phase 1: pre-v5 keys (r-* / ua-* without __) → append __base.
// Phase 2: positional keys r-{year}-{si}-{ci}__variantId → stable s|set|num|type__variantId.
function migrateOwnedKeys() {
  let changed = false;
  const toMigrate = [];

  // Phase 1 — add missing __base suffix
  for (const k of ownedData.keys()) {
    if ((k.startsWith('r-') || k.startsWith('ua-')) && !k.includes('__')) {
      toMigrate.push({ oldKey: k, newKey: k + '__base' });
    }
  }

  // Phase 2 — positional r-{year}-{si}-{ci}__variantId → stable s|set|num|type__variantId
  const grouped = groupCards(CARDS);
  for (const k of ownedData.keys()) {
    if (!k.startsWith('r-')) continue;
    const dunder = k.indexOf('__');
    if (dunder < 0) continue; // handled in phase 1 if it applies
    const rowId = k.slice(0, dunder);
    const variantId = k.slice(dunder + 2);
    const m = rowId.match(/^r-(\d+)-(\d+)-(\d+)$/);
    if (!m) continue;
    const [, year, si, ci] = m;
    const yearGroup = grouped[year];
    if (!yearGroup) continue;
    const setNames = Object.keys(yearGroup);
    const setName = setNames[parseInt(si, 10)];
    if (!setName) continue;
    const cards = yearGroup[setName];
    if (!cards) continue;
    const c = cards[parseInt(ci, 10)];
    if (!c) continue;
    const newRowId = `s|${setName}|${c.num}|${c.type || 'base'}`;
    const newKey = `${newRowId}__${variantId}`;
    if (newKey !== k) {
      toMigrate.push({ oldKey: k, newKey });
    }
  }

  if (!toMigrate.length) return false;

  toMigrate.forEach(({ oldKey, newKey }) => {
    const v = ownedData.get(oldKey);
    ownedData.delete(oldKey);
    // Only set if newKey not already present (avoid clobbering newer data)
    if (!ownedData.has(newKey)) ownedData.set(newKey, v);
  });

  return true;
}

function normalizeEntryV6(v) {
  if (!v || typeof v !== 'object') return { rawQty: 1, rawCost: null, psaQty: 0, psaCost: null, dateAdded: null };
  // Already v6 shape
  if ('rawQty' in v || 'psaQty' in v) return { rawQty: v.rawQty ?? 1, rawCost: v.rawCost ?? null, psaQty: v.psaQty ?? 0, psaCost: v.psaCost ?? null, dateAdded: v.dateAdded ?? null };
  // Migrate from v5 shape (qty + cost)
  return { rawQty: v.qty ?? 1, rawCost: v.cost ?? null, psaQty: 0, psaCost: null, dateAdded: v.dateAdded ?? null };
}
function toggleNotice() {
  const body = document.getElementById('noticeBody');
  const btn  = document.getElementById('noticeToggleBtn');
  if (!body || !btn) return;
  const hidden = body.classList.toggle('collapsed');
  btn.textContent = hidden ? '[show]' : '[hide]';
}

function loadOwned() {
  // Try v6 first
  try {
    const res6 = localStorage.getItem(LS_KEY_V6);
    if (res6) {
      const obj = JSON.parse(res6);
      ownedData = new Map(Object.entries(obj).map(([k,v]) => [k, normalizeEntryV6(v)]));
      if (migrateOwnedKeys()) saveOwned();
      return;
    }
  } catch {}
  // Migrate from v5
  try {
    const res5 = localStorage.getItem(LS_KEY_V5);
    if (res5) {
      const obj = JSON.parse(res5);
      ownedData = new Map(Object.entries(obj).map(([k,v]) => [k, normalizeEntryV6(v)]));
      migrateOwnedKeys();
      saveOwned();
      return;
    }
  } catch {}
  // Migrate from v4
  try {
    const res4 = localStorage.getItem(LS_KEY_V3);
    if (res4) {
      const obj = JSON.parse(res4);
      ownedData = new Map(Object.entries(obj).map(([k,v]) => [k, normalizeEntryV6(v)]));
      migrateOwnedKeys();
      saveOwned();
      return;
    }
  } catch {}
  // Migrate from v2 (plain array)
  try {
    const old = localStorage.getItem(LS_KEY);
    const ids = old ? JSON.parse(old) : [];
    ownedData = new Map(ids.map(id => [id + '__base', { rawQty: 1, rawCost: null, psaQty: 0, psaCost: null, dateAdded: null }]));
    if (ids.length) saveOwned();
  } catch { ownedData = new Map(); }
}
function saveOwned() {
  try {
    const obj = Object.fromEntries(ownedData);
    localStorage.setItem(LS_KEY_V6, JSON.stringify(obj));
  } catch {}
}
function clearOwned() {
  document.getElementById('clearOwnedModal').style.display = 'flex';
}
function clearOwnedConfirmed() {
  document.getElementById('clearOwnedModal').style.display = 'none';
  ownedData.clear();
  saveOwned();
  document.querySelectorAll('.own-cb').forEach(cb => { cb.checked = false; cb.closest('tr').classList.remove('owned-row'); });
  buildAll();
}
function clearOwnedCancel() {
  document.getElementById('clearOwnedModal').style.display = 'none';
}

// ============================================================
//  RENDER
// ============================================================
const TAG_DEF = {
  base:   { cls: 'tag-base',   lbl: 'BASE' },
  rc:     { cls: 'tag-rc',     lbl: 'RC' },
  '1b':   { cls: 'tag-1b',     lbl: '1ST BOWMAN' },
  auto:   { cls: 'tag-auto',   lbl: 'AUTO' },
  relic:  { cls: 'tag-relic',  lbl: 'RELIC' },
  ssp:    { cls: 'tag-ssp',    lbl: 'SSP' },
  insert: { cls: 'tag-insert', lbl: 'INSERT' },
  now:    { cls: 'tag-now',    lbl: 'TOPPS NOW' },
};

function mkTags(tags) {
  return '<div class="tags">' + tags.map(t => {
    const d = TAG_DEF[t];
    return d ? `<span class="tag ${d.cls}">${d.lbl}</span>` : '';
  }).join('') + '</div>';
}

function mkPrice(v, cls) {
  if (!v) return `<span class="c-price na">—</span>`;
  if (v === 'Auction') return `<span class="c-price auction">Auction</span>`;
  if (v.includes('N/A')) return `<span class="c-price na">${v}</span>`;
  if (v.includes('Sold') || v.includes('sold')) return `<span class="c-price grail">${v}</span>`;
  return `<span class="c-price ${cls}">${v}</span>`;
}

// -- User-provided card photos (base64-embedded, keyed by set + card number) --
const CARD_IMAGES = {}; // images now served from images/ folder;

// -- Stable image filename: based on set + card number, never changes with reordering
// Override map for cards that share a set+num with another card (keyed by set|num|title|type)
const IMG_FILENAME_OVERRIDES = {
  // 2023 Bowman Draft Baseball — BDC-14 variants
  "2023 Bowman Draft Baseball|BDC-14|Chrome Prospectors Special Die-Cut Variations|Variation": "2023-bowman-draft-baseball-bdc-14dc",
  "2023 Bowman Draft Baseball|BDC-14|Image Variations|Variation":                              "2023-bowman-draft-baseball-bdc-14iv",
  "2023 Bowman Draft Baseball|BDC-14|Image Variations Autographs|Autograph":                  "2023-bowman-draft-baseball-bdc-14iva",
  // 2024 Topps Update Series — US100 variants (share num with base card)
  "2024 Topps Update Series Baseball|US100|Companion Card|Variation":                          "2024-topps-update-series-baseball-us100cc",
  "2024 Topps Update Series Baseball|US100|Golden Mirror Image Variation|Variation":           "2024-topps-update-series-baseball-us100gm",
  "2024 Topps Update Series Baseball|US100|Oversized 2024 Base|Oversized Insert":             "2024-topps-update-series-baseball-us100o",
  // 2025 Topps Chrome Baseball — #300 variants
  "2025 Topps Chrome Baseball|300|Award Winners Variation|Variation": "2025-topps-chrome-baseball-300awv",
  "2025 Topps Chrome Baseball|300|Image Variation|Variation":         "2025-topps-chrome-baseball-300iv",
  // 2025 Topps Chrome Sapphire Baseball — #300 variants
  "2025 Topps Chrome Sapphire Baseball|300|Image Variation|Variation":         "2025-topps-chrome-sapphire-baseball-300iv",
  // 2025 Topps Chrome Platinum Anniversary Baseball — #197 variants
  "2025 Topps Chrome Platinum Anniversary Baseball|197|Image Variation|Variation": "2025-topps-chrome-platinum-anniversary-baseball-197iv",
  // 2025 Topps Cosmic Chrome Baseball — #100 variants
  "2025 Topps Cosmic Chrome Baseball|100|Constellation Variation|Variation": "2025-topps-cosmic-chrome-baseball-100cv",
  // 2026 Topps Series 1 Baseball — #100 variants (and #203 GMV)
  "2026 Topps Series 1 Baseball|100|Clear Variation|Variation":                     "2026-topps-series-1-baseball-100cv",
  "2026 Topps Series 1 Baseball|100|Golden Mirror Variation|Variation":              "2026-topps-series-1-baseball-100gmv",
  "2026 Topps Series 1 Baseball|203|League Leaders Golden Mirror Variation|Variation": "2026-topps-series-1-baseball-203gmv",
  "2026 Topps Series 1 Baseball|100|Holiday Variation|Variation":                   "2026-topps-series-1-baseball-100hv",
  "2026 Topps Series 1 Baseball|100|Player Number Variation|Variation":              "2026-topps-series-1-baseball-100pnv",
  "2026 Topps Series 1 Baseball|100|Team Color Border Variation|Variation":          "2026-topps-series-1-baseball-100tcbv",
  "2026 Topps Series 1 Baseball|100|True Photo Variation|Variation":                 "2026-topps-series-1-baseball-100tpv",
  "2026 Topps Series 1 Baseball|100|Vintage Stock Variation|Variation":              "2026-topps-series-1-baseball-100vsv",
  "2026 Topps Series 1 Baseball|100|Companion Card|Variation":                       "2026-topps-series-1-baseball-100cc",
  "2026 Topps Series 1 Baseball|100|Flagship Real One Autograph|Autograph":          "2026-topps-series-1-baseball-100froa",
  "2026 Topps Series 1 Baseball|100|Oversized 2026 Topps Baseball|Oversized Insert": "2026-topps-series-1-baseball-100o",
  "2026 Topps Series 1 Baseball|100|Real One Relic|Relic":                           "2026-topps-series-1-baseball-100ror",
  "2026 Topps Series 1 Baseball|100|Dugout Peeks|Insert":                           "2026-topps-series-1-baseball-100dp",
  "2026 Topps Series 1 Baseball|100|Hidden Mascots|Insert":                         "2026-topps-series-1-baseball-100hm",
  // 2025 Topps Series 1 Baseball Celebration — #98 cards
  "2025 Topps Series 1 Baseball Celebration|98|Confetti|Base Parallel Insert":  "2025-topps-series-1-baseball-celebration-98c",
  "2025 Topps Series 1 Baseball Celebration|98|Big Head Variation|Variation":   "2025-topps-series-1-baseball-celebration-98bhv",
  // 2025 Topps Series 1 — #98 variation cards
  "2025 Topps Series 1 Baseball|98|Flagship Real One Autograph|Autograph":  "2025-topps-series-1-baseball-98froa",
  "2025 Topps Series 1 Baseball|98|Golden Mirror Image Variation|Variation": "2025-topps-series-1-baseball-98gm",
  "2025 Topps Series 1 Baseball|98|Player Number Variation|Variation":       "2025-topps-series-1-baseball-98pnv",
  "2025 Topps Series 1 Baseball|98|Murakami Variation|Variation":            "2025-topps-series-1-baseball-98mv",
  // 2024 Topps Archives — #200 variation cards
  "2024 Topps Archives Baseball|200|1970 Topps Design Variation|Variation":          "2024-topps-archives-baseball-200dv",
  "2024 Topps Archives Baseball|200|1970 Topps Image Variation|Variation":           "2024-topps-archives-baseball-200iv",
  // 2025 Topps Archives — #43 variation cards
  "2025 Topps Archives Baseball|43|Base 1964 Design Variation|Variation":            "2025-topps-archives-baseball-43dv",
  "2025 Topps Archives Baseball|43|Base 1964 Image Variation|Variation":             "2025-topps-archives-baseball-43iv",
  // 2024 Topps Chrome Update Series — USC88 variants
    "2025 Topps Chrome Update Series Baseball|ASGC-44|2025 All-Star Game Image Variation|Variation": "2025-topps-chrome-update-series-baseball-asgc-44iv",
"2024 Topps Chrome Update Series Baseball|USC88|Image Variation|Variation":                  "2024-topps-chrome-update-series-baseball-usc88iv",
  // 2024 Topps Update Series — US288 variants (share num with Rookie Debut base card)
  "2024 Topps Update Series Baseball|US288|Companion Card — Rookie Debut|Variation":          "2024-topps-update-series-baseball-us288cc",
  "2024 Topps Update Series Baseball|US288|Golden Mirror Image Variation — Rookie Debut|Variation": "2024-topps-update-series-baseball-us288gm",
  "2024 Topps Update Series Baseball|US288|Oversized 2024 Base — Rookie Debut|Oversized Insert": "2024-topps-update-series-baseball-us288o",
  // 2024 Topps 206 Baseball — all cards share num N/A, need unique slugs
  "2024 Topps 206 Baseball|N/A|Base|Base":                     "2024-topps-206-baseball-base",
  "2024 Topps 206 Baseball|N/A|1910 T210|Insert":              "2024-topps-206-baseball-t210",
  "2024 Topps 206 Baseball|N/A|Background Variation|Variation": "2024-topps-206-baseball-bgv",
  "2024 Topps 206 Baseball|N/A|City Name Variation|Variation":  "2024-topps-206-baseball-cnv",
  "2024 Topps 206 Baseball|N/A|New Beginnings|Insert":          "2024-topps-206-baseball-nb",
  "2024 Topps 206 Baseball|N/A|Night Game Variation|Variation": "2024-topps-206-baseball-ngv",
  // 2024 Topps Heritage High Number Baseball — #594 variants
  "2024 Topps Heritage High Number Baseball|594|Base|Base":                                    "2024-topps-heritage-high-number-baseball-594",
  "2024 Topps Heritage High Number Baseball|594|Chrome|Base Chrome":                           "2024-topps-heritage-high-number-baseball-594c",
  "2024 Topps Heritage High Number Baseball|594|Black & White Image Variation|Variation":       "2024-topps-heritage-high-number-baseball-594bwiv",
  "2024 Topps Heritage High Number Baseball|594|Image Variation|Variation":                     "2024-topps-heritage-high-number-baseball-594iv",
  "2024 Topps Heritage High Number Baseball|594|Mini|Mini":                                     "2024-topps-heritage-high-number-baseball-594m",
  "2024 Topps Heritage High Number Baseball|594|Team Name / City Name Swap Variation|Variation": "2024-topps-heritage-high-number-baseball-594tns",
  // 2024 Topps Black & White Baseball — #66 variants
  "2024 Topps Black & White Baseball|66|Base|Base":                          "2024-topps-black-white-baseball-66",
  "2024 Topps Black & White Baseball|66|Image Variation Super Short Print|Variation": "2024-topps-black-white-baseball-66-iv",
  // 2025 Topps Holiday Baseball — H70 variants (all share same default slug)
  "2025 Topps Holiday Baseball|H70|Base|Base":                          "2025-topps-holiday-baseball-h70",
  "2025 Topps Holiday Baseball|H70|Base Holiday Variation|Variation":   "2025-topps-holiday-baseball-h70-hv",
  "2025 Topps Holiday Baseball|H70|Base Holiday Backs Variation SP|Variation": "2025-topps-holiday-baseball-h70-hbv",
  // 2024 Topps Allen & Ginter Baseball — #282 variants (all share same default slug)
  "2024 Topps Allen & Ginter Baseball|282|Base|Base":             "2024-topps-allen-ginter-baseball-282",
  "2024 Topps Allen & Ginter Baseball|282|Base Mini|Mini":         "2024-topps-allen-ginter-baseball-282-m",
  "2024 Topps Allen & Ginter Baseball|282|Chrome|Base Chrome":    "2024-topps-allen-ginter-baseball-282-ch",
  "2024 Topps Allen & Ginter Baseball|282|Chrome Mini|Mini Chrome": "2024-topps-allen-ginter-baseball-282-chm",
  "2024 Topps Allen & Ginter Baseball|282|Framed Mini Cloth|Mini": "2024-topps-allen-ginter-baseball-282-cm",
  // 2025 Topps Allen & Ginter Baseball — #128 variants (all share same default slug)
  "2025 Topps Allen & Ginter Baseball|128|Base|Base":                      "2025-topps-allen-ginter-baseball-128",
  "2025 Topps Allen & Ginter Baseball|128|Chrome Variation|Base Chrome":   "2025-topps-allen-ginter-baseball-128-ch",
  "2025 Topps Allen & Ginter Baseball|128|Base Mini|Mini":                  "2025-topps-allen-ginter-baseball-128-m",
  "2025 Topps Allen & Ginter Baseball|128|Daguerreotype Variation|Variation": "2025-topps-allen-ginter-baseball-128-dv",
  "2025 Topps Allen & Ginter Baseball|128|Mini Card (Chrome)|Mini Chrome": "2025-topps-allen-ginter-baseball-128-chm",
  "2025 Topps Allen & Ginter Baseball|128|Mini Card (Cloth)|Mini":         "2025-topps-allen-ginter-baseball-128-cm",
  "2025 Topps Allen & Ginter Baseball|128|Mini Card (Metal)|Mini":         "2025-topps-allen-ginter-baseball-128-met",
  "2025 Topps Allen & Ginter Baseball|128|Mini Card (Stained Glass)|Mini": "2025-topps-allen-ginter-baseball-128-sg",
  // 2024 Topps Allen & Ginter X Baseball — #282 variants
  "2024 Topps Allen & Ginter X Baseball|282|Base|Base":           "2024-topps-allen-ginter-x-baseball-282",
  "2024 Topps Allen & Ginter X Baseball|282|Chrome|Base Chrome":  "2024-topps-allen-ginter-x-baseball-282-ch",
  // 2025 Topps Heritage Baseball — #60 variants (all share same num)
  "2025 Topps Heritage Baseball|60|Base|Base":                         "2025-topps-heritage-baseball-60",
  "2025 Topps Heritage Baseball|60|Chrome|Base Chrome":                "2025-topps-heritage-baseball-60c",
  "2025 Topps Heritage Baseball|60|Alternate Cartoon Variation|Variation": "2025-topps-heritage-baseball-60acv",
  "2025 Topps Heritage Baseball|60|Image Variation|Variation":         "2025-topps-heritage-baseball-60iv",
  // 2026 Topps Heritage Baseball — #7 variants (base and Chrome share same default slug)
  "2026 Topps Heritage Baseball|7|League Leaders (Skenes / Skubal)|League Leaders Combo": "2026-topps-heritage-baseball-7",
  "2026 Topps Heritage Baseball|7|League Leaders Chrome (Skenes / Skubal)|Base Chrome":   "2026-topps-heritage-baseball-7c",
  // 2026 Topps Heritage Baseball — #33 variants (all share same default slug)
  "2026 Topps Heritage Baseball|33|Base|Base":                              "2026-topps-heritage-baseball-33",
  "2026 Topps Heritage Baseball|33|Chrome|Base Chrome":                     "2026-topps-heritage-baseball-33c",
  "2026 Topps Heritage Baseball|33|All-Star Icon Logo Variation|Variation":  "2026-topps-heritage-baseball-33asiv",
  "2026 Topps Heritage Baseball|33|Image Variation|Variation":              "2026-topps-heritage-baseball-33iv",
  // 2024 Topps x Chris Berman: Boomer's Baseball — #12 variants (Base and Variation share num)
  "2024 Topps x Chris Berman: Boomer's Baseball|12|Base|Base":                                   "2024-topps-x-chris-berman-boomers-baseball-12",
  "2024 Topps x Chris Berman: Boomer's Baseball|12|Berman's Nickname Nameplate Variation|Variation": "2024-topps-x-chris-berman-boomers-baseball-12-nnv",
  // 2026 Topps Flagship Collection Series 1 Baseball — #62 variants (Base and Chrome share same num)
  "2026 Topps Flagship Collection Series 1 Baseball|62|Base|Base":             "2026-topps-flagship-collection-s1-baseball-62",
  "2026 Topps Flagship Collection Series 1 Baseball|62|Base Chrome|Base Chrome": "2026-topps-flagship-collection-s1-baseball-62c",
  // 2026 Topps Chrome Baseball — #150 variants (all share same default slug)
  "2026 Topps Chrome Baseball|150|Base|Base Chrome":                    "2026-topps-chrome-baseball-150",
  "2026 Topps Chrome Baseball|150|Award Winner Variation|Variation":    "2026-topps-chrome-baseball-150-awv",
  "2026 Topps Chrome Baseball|150|Image Variation|Variation":           "2026-topps-chrome-baseball-150-iv",
  "2026 Topps Chrome Baseball|150|Image Variation SSP|Variation":       "2026-topps-chrome-baseball-150-ivssp",
  "2026 Topps Chrome Baseball|150|Minions Variation|Variation":         "2026-topps-chrome-baseball-150-mv",
  // 2024 Topps Pro Debut Baseball — PD-140 and PDC-140 variants (cards share num)
  "2024 Topps Pro Debut Baseball|PD-140|Base|Base":                        "2024-topps-pro-debut-baseball-pd-140",
  "2024 Topps Pro Debut Baseball|PD-140|Base Autograph|Autograph":         "2024-topps-pro-debut-baseball-pd-140a",
  "2024 Topps Pro Debut Baseball|PDC-140|Base Chrome|Base Chrome":         "2024-topps-pro-debut-baseball-pdc-140",
  "2024 Topps Pro Debut Baseball|PDC-140|Base Chrome Autograph|Autograph": "2024-topps-pro-debut-baseball-pdc-140a",
  "2024 Topps Pro Debut Baseball|PDC-140|Image Variation|Variation":       "2024-topps-pro-debut-baseball-pdc-140iv",
  // 2024 Topps Allen & Ginter X Baseball — four #282 variants share card number
  "2024 Topps Allen & Ginter X Baseball|282|Base|Base":                    "2024-topps-allen-ginter-x-baseball-282",
  "2024 Topps Allen & Ginter X Baseball|282|Chrome|Base Chrome":           "2024-topps-allen-ginter-x-baseball-282c",
  "2024 Topps Allen & Ginter X Baseball|282|Base Mini|Mini":               "2024-topps-allen-ginter-x-baseball-282m",
  "2024 Topps Allen & Ginter X Baseball|282|Base Chrome Mini|Chrome Mini": "2024-topps-allen-ginter-x-baseball-282cm",
  // 2024 Topps Transcendent Baseball — #98 base and image variation share card number
  "2024 Topps Transcendent Baseball|98|Base Transcendent Icons Chrome|Base Transcendent": "2024-topps-transcendent-baseball-98",
  "2024 Topps Transcendent Baseball|98|Image Variation|Variation":                        "2024-topps-transcendent-baseball-98-iv",
  // 2024 Topps Brooklyn Collection Baseball — three #37 variants share card number
  "2024 Topps Brooklyn Collection Baseball|37|Base|Base":                                    "2024-topps-brooklyn-collection-baseball-37",
  "2024 Topps Brooklyn Collection Baseball|37|Brooklyn Die-Cut Variation|Variation":         "2024-topps-brooklyn-collection-baseball-37-dcv",
  "2024 Topps Brooklyn Collection Baseball|37|Vaulted Ceiling Die-Cut Variation|Variation":  "2024-topps-brooklyn-collection-baseball-37-vcdcv",

};
function cardImgSlug(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function cardImgFilename(set, num, title, type) {
  const overrideKey = `${set}|${num}|${title}|${type}`;
  if (IMG_FILENAME_OVERRIDES[overrideKey]) return IMG_FILENAME_OVERRIDES[overrideKey];
  const id = num ? cardImgSlug(num) : cardImgSlug(title);
  return `${cardImgSlug(set)}-${id}`;
}

// -- Thumbnail error handler: tries .jpg → .png → .webp → base64 fallback → emoji
function onThumbError(el, fallbackSrc) {
  if (!el._triedJpeg)  { el._triedJpeg  = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)$/, '.jpeg'); return; }
  if (!el._triedPng)   { el._triedPng   = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)$/, '.png');  return; }
  if (!el._triedWebp)  { el._triedWebp  = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)$/, '.webp'); return; }
  if (fallbackSrc) { el.onerror = null; el.src = fallbackSrc; return; }
  el.parentNode.innerHTML = '🃏';
}

function thumbImgLoad(img) {
  /* onload fires synchronously for cached images (before img is in DOM), so defer */
  requestAnimationFrame(function () {
    var s  = img.src;
    var m  = s.match(/images\/[^?#]+/);
    var tb = img.closest('.card-thumb');
    if (!tb) return;
    tb.dataset.largeUrl = m ? m[0] : s;
    if (img.naturalWidth > img.naturalHeight) tb.classList.add('landscape-thumb');
  });
}

function mkThumb(card, rowId) {
  const q = encodeURIComponent(card.ebayQ || `Paul Skenes ${card.set} ${card.title}`);
  const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Complete=1&LH_Sold=1`;
  const label = (card.title || card.set || 'Card').replace(/"/g,'&quot;');
  const imgKey = `${card.set}|${card.num}|${card.title}|${card.type}`;
  const imgData = CARD_IMAGES[imgKey];
  const fallback = imgData ? imgData.thumb.replace(/"/g,"'") : '';

  // Stable filename — card.imgSlug allows parallel rows to supply a precomputed slug
  const slug = card.imgSlug || cardImgFilename(card.set, card.num, card.title, card.type);

  let thumbInner, largeUrl, hasPhoto;
  if (slug) {
    thumbInner = `<img src="images/${slug}.jpg" alt="${label}" class="card-thumb-img" onload="thumbImgLoad(this)" onerror="onThumbError(this,'${fallback}')">`;
    largeUrl = `images/${slug}.jpg`;
    hasPhoto = true;
  } else if (imgData) {
    thumbInner = `<img src="${imgData.thumb}" alt="${label}" class="card-thumb-img">`;
    largeUrl = imgData.large;
    hasPhoto = true;
  } else {
    thumbInner = '🃏';
    largeUrl = '';
    hasPhoto = false;
  }

  const isT206       = card.set === '2024 Topps 206 Baseball';
  const ebayUrlSafe = ebayUrl.replace(/'/g, '%27');
  const activeUrl    = ebayUrl.replace('&LH_Complete=1&LH_Sold=1', '') + '&_sop=15';
  const activeUrlSafe = activeUrl.replace(/'/g, '%27');
  const binUrl       = activeUrl.replace('&_sop=15', '&LH_BIN=1&_sop=15');
  const binUrlSafe   = binUrl.replace(/'/g, '%27');
  const labelJs      = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");  // safe in JS single-quoted string
  const labelHtml    = label.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');  // safe in HTML attrs
  return `<div class="thumb-wrap">
    <button class="card-thumb${hasPhoto ? ' has-photo' : ''}${/mini/i.test(card.type||'') && !card.notMini ? ' mini-thumb' : ''}${isT206 ? ' t206-thumb' : ''}" onclick="openThumbLightbox('${ebayUrlSafe}', '${labelJs}', this.dataset.largeUrl||'${largeUrl}', '${slug}.jpg', ${/mini/i.test(card.type||'') && !card.notMini}, ${isT206})" title="Enlarge: ${labelHtml}">${thumbInner}</button>
    <div class="thumb-ebay-btns">
      <a class="thumb-mag thumb-bin"    href="${binUrlSafe}"    target="_blank" title="eBay Buy It Now: ${labelHtml}">🏷️</a>
      <a class="thumb-mag thumb-active" href="${activeUrlSafe}" target="_blank" title="eBay all active: ${labelHtml}">🛒</a>
      <a class="thumb-mag thumb-sold"   href="${ebayUrlSafe}"   target="_blank" title="eBay sold: ${labelHtml}">🔨</a>
    </div>
  </div>`;
}

// -- Enlarge-thumbnail lightbox ---------------------------------
function lbImgError(el) {
  if (!el._triedJpeg)  { el._triedJpeg  = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)([^.]*)?$/, '.jpeg'); return; }
  if (!el._triedPng)   { el._triedPng   = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)([^.]*)?$/, '.png');  return; }
  if (!el._triedWebp)  { el._triedWebp  = true; el.src = el.src.replace(/\.(jpg|jpeg|png|webp)([^.]*)?$/, '.webp'); return; }
  el.style.display = 'none';
}

var lbFrontUrl = '', lbBackUrl = '', lbParentBackUrl = '', lbFlippedState = false, lbIsMini = false, lbIsLandscape = false, lbIsT206 = false;
/* try parallel-specific back first; fall through to parent back, then lbImgError */
function lbBackError(el) {
  if (lbParentBackUrl && lbParentBackUrl !== lbBackUrl) {
    el.onerror = lbImgError;
    el.src = lbParentBackUrl;
  } else {
    lbImgError(el);
  }
}
function lbBackSrc(src) {
  if (!src) return '';
  /* always use .jpg for back images, regardless of the parallel front's extension */
  var dot = src.lastIndexOf('.');
  var base = dot >= 0 ? src.slice(0, dot) : src;
  return base + '-back.jpg';
}
function lbFrontOnload(img) {
  if (img.naturalWidth > img.naturalHeight) {
    lbIsLandscape = true;
    img.classList.add('lb-landscape-img');
    var box = document.querySelector('#thumbLightbox .lb-box');
    if (box) box.classList.add('lb-landscape-box');
  }
}
function lbBackOnload(img) {
  /* for actual landscape cards, show back in landscape too (no rotation) */
  if (img.naturalWidth > img.naturalHeight && lbIsLandscape) {
    img.classList.add('lb-landscape-img');
    return;
  }
  /* rotate accidentally-landscape backs into the portrait frame */
  if (img.naturalWidth <= img.naturalHeight) return;
  var w = 240; /* always fill full portrait width */
  var h = Math.round(w * img.naturalWidth / img.naturalHeight);
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;overflow:hidden;width:' + w + 'px;height:' + h + 'px;margin:0 auto;border:1px solid var(--border);';
  img.style.cssText = 'position:absolute;width:' + h + 'px;height:' + w + 'px;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg);border:none;box-shadow:none;max-width:none;';
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);
}
function lbFlip() {
  if (!lbFrontUrl) return;
  var inner = document.querySelector('#lbCardIcon .lb-flip-inner');
  if (!inner) return;
  lbFlippedState = !lbFlippedState;
  inner.classList.toggle('lb-card-flipped', lbFlippedState);
}
function openThumbLightbox(ebayUrl, label, largeUrl, filename, isMini, isT206) {
  lbIsMini = !!isMini;
  lbIsT206 = !!isT206;
  document.getElementById('lbTitle').textContent = label;
  document.getElementById('lbEbayLink').href = ebayUrl;
  const baseUrl   = ebayUrl.replace('&LH_Complete=1&LH_Sold=1', '');
  const activeUrl = baseUrl + '&_sop=15';
  const binUrl    = baseUrl + '&LH_BIN=1&_sop=15';
  const activeEl  = document.getElementById('lbEbayActive');
  if (activeEl) activeEl.href = activeUrl;
  const binEl     = document.getElementById('lbEbayBin');
  if (binEl) binEl.href = binUrl;
  const iconEl = document.getElementById('lbCardIcon');
  const noteEl = document.getElementById('lbNote');
  const fileEl = document.getElementById('lbFilename');
  lbFlippedState = false;
  if (largeUrl) {
    lbFrontUrl = largeUrl;
    /* parallels use their parent's back — strip --id suffix if present */
    lbBackUrl       = lbBackSrc(largeUrl);                                    /* parallel-specific back */
    lbParentBackUrl = lbBackSrc(largeUrl.replace(/--[^.]+(\.\S+)$/, '$1')); /* parent back fallback */
    lbIsLandscape = false;
    var box = document.querySelector('#thumbLightbox .lb-box');
    if (box) box.classList.remove('lb-landscape-box');
    var imgCls = 'lb-card-img' + (lbIsMini ? ' lb-mini-img' : '') + (lbIsT206 ? ' lb-t206-img' : '');
    iconEl.innerHTML =
      '<div class="lb-flip-inner">' +
        '<div class="lb-flip-front"><img src="' + largeUrl + '" alt="" class="' + imgCls + '" onerror="lbImgError(this)" onload="lbFrontOnload(this)"></div>' +
        '<div class="lb-flip-back"><img src="' + lbBackUrl + '" alt="" class="' + imgCls + '" onerror="lbBackError(this)" onload="lbBackOnload(this)"></div>' +
      '</div>';
    iconEl.classList.add('lb-clickable');
    iconEl.onclick = lbFlip;
    noteEl.textContent = 'Photo provided by you. Click the image or ⟳ Flip to see the card back.';
  } else {
    lbFrontUrl = ''; lbBackUrl = ''; lbParentBackUrl = '';
    iconEl.innerHTML = '🃏';
    iconEl.classList.remove('lb-clickable');
    iconEl.onclick = null;
    noteEl.textContent = "A preview image isn't hosted here — open the live eBay search to see real, current photos of this exact card.";
  }
  if (fileEl) {
    if (filename) { fileEl.textContent = '📁 ' + filename; fileEl.style.display = 'block'; }
    else { fileEl.textContent = ''; fileEl.style.display = 'none'; }
  }
  document.getElementById('thumbLightbox').style.display = 'flex';
}
function closeThumbLightbox() {
  document.getElementById('thumbLightbox').style.display = 'none';
  lbFlippedState = false;
  lbIsMini = false;
  lbIsLandscape = false;
  lbIsT206 = false;
  var box = document.querySelector('#thumbLightbox .lb-box');
  if (box) box.classList.remove('lb-landscape-box');
  var iconEl = document.getElementById('lbCardIcon');
  if (iconEl) { iconEl.classList.remove('lb-clickable'); iconEl.onclick = null; }
}
document.addEventListener('keydown', function(e) {
  if (document.getElementById('thumbLightbox').style.display !== 'flex') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); lbFlip(); }
  if (e.key === 'Escape') closeThumbLightbox();
});

// -- Description column: key collector descriptors -------------
const DESC_BADGES = [
  { key:'1b',    cls:'desc-1b',    lbl:'1st Bowman' },
  { key:'rc',    cls:'desc-rc',    lbl:'RC'         },
  { key:'auto',  cls:'desc-auto',  lbl:'Autograph'  },
  { key:'relic', cls:'desc-relic', lbl:'Relic'      },
];
function mkDesc(tags) {
  const pills = DESC_BADGES
    .filter(b => tags.includes(b.key))
    .map(b => `<span class="desc-pill ${b.cls}">${b.lbl}</span>`)
    .join('');
  return pills
    ? `<div class="desc-wrap">${pills}</div>`
    : `<span style="color:var(--text3);font-size:11px">—</span>`;
}

// Strip "1st Bowman" prefix variants from the Card/Set column title
// The 1st Bowman designation is shown via the tag pill instead
function displayTitle(title) {
  return title
    .replace(/^1st Bowman Chrome Auto\s*[—\-–]\s*/i, '')
    .replace(/^1st Bowman Chrome\s*[—\-–]\s*/i, '')
    .replace(/^1st Bowman Paper\s*[—\-–]\s*/i, '')
    .replace(/^1st Bowman\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Chrome RC Auto\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Chrome RC\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Chrome Prospect\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Chrome\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Prospect\s*[—\-–]\s*/i, '')
    .replace(/^Bowman Chrome\s*/i, '')
    .trim();
}

// Group cards by year → set name (official product name)
// Sort sets within a year by a logical product order
const SET_ORDER = [
  // -- 2023 (release order) ----------------------------------------
  '2023 Bowman Draft Baseball',            // Nov 2023
  '2023 Bowman Draft Sapphire Baseball',   // Jan 2024 (online exclusive)
  "2023 Bowman's Best Baseball",           // Feb 2024

  // -- 2024 (release order) ----------------------------------------
  '2024 Topps Hobby Rip Night Baseball',   // Feb 24, 2024
  '2024 Bowman Baseball',                  // May 8, 2024
  '2024 Bowman Mega Box Baseball',          // May 29, 2024
  '2024 Bowman Sapphire Baseball',         // Jun 5, 2024
  '2024 Topps Museum Collection Baseball', // Jul 31, 2024
  '2024 Topps Pristine Baseball',          // Aug 30, 2024
  '2024 Topps Big League Baseball',        // Aug 2024
  '2024 Topps Pro Debut Baseball',         // Sep 6, 2024
  '2024 Bowman Chrome Baseball',           // Sep 11, 2024
  '2024 Topps Five Star Baseball',         // Sep 27, 2024
  '2024 Bowman Chrome Mega Box Baseball',  // Oct 2, 2024
  '2024 Topps 206 Baseball',               // Oct 3, 2024
  '2024 Bowman Sterling Baseball',         // Oct 9, 2024
  '2024 Topps Cosmic Chrome Baseball',     // Oct 11, 2024
  '2024 Topps Update Series Baseball',     // Oct 16, 2024
  '2024 Topps Living Set',                 // Oct 2024 (approx.)
  '2024 Topps Allen & Ginter Baseball',    // Oct 30, 2024
  '2024 Topps Stadium Club Baseball',      // Nov 6, 2024
  '2024 Topps Chrome Update Series Baseball', // Nov 13, 2024
  '2024 Topps Holiday Baseball',           // Nov 15, 2024
  '2024 Bowman Chrome Sapphire Baseball',  // Nov 20, 2024
  '2024 Topps Gilded Collection Baseball', // Nov 20, 2024
  '2024 Topps Black & White Baseball',     // Nov 20, 2024
  '2024 Topps Finest Baseball',            // Nov 2024
  '2024 Topps Tier One Baseball',          // Nov 2024
  '2024 Topps Tribute Baseball',           // Nov 2024
  '2024 Topps Allen & Ginter X Baseball',  // Dec 6, 2024
  '2024 Topps Chrome Sapphire Update Series Baseball', // Dec 10, 2024
  '2024 Topps Chrome Logofractor Edition Baseball', // Dec 2024
  '2024 Topps Brooklyn Collection Baseball', // Dec 11, 2024
  "2024 Topps x Chris Berman: Boomer's Baseball", // Dec 12, 2024
  '2024 Topps Triple Threads Baseball',    // Dec 19, 2024
  '2024 Topps Sterling Baseball',          // Dec 2024
  '2024 Topps Archives Baseball',          // Jan 8, 2025
  '2024 Topps Definitive Baseball',        // Jan 10, 2025
  "2024 Bowman's Best Baseball",           // Jan 15, 2025
  '2024 Topps Transcendent Baseball',      // Jan 22, 2025
  '2024 Topps Diamond Icons Baseball',     // Feb 5, 2025
  '2024 Topps Heritage High Number Baseball', // Mar 26, 2025
  '2024 Topps Inception Baseball',         // Jun 18, 2025
  '2024 Topps NOW Baseball',               // season-long (keep at end)

  // -- 2025 (release order) ----------------------------------------
  '2025 Topps Series 1 Baseball',          // Feb 12, 2025
  '2025 Topps Flagship Collection Series One Baseball', // Feb 12, 2025
  '2025 Topps Series 1 Baseball Celebration', // Mar 26, 2025
  '2025 Topps Heritage Baseball',          // Apr 23, 2025
  '2025 Topps Tribute Baseball',           // Apr 23, 2025
  '2025 Topps Chrome Black Baseball',      // Apr 30, 2025
  '2025 Bowman Baseball',                  // May 7, 2025
  '2025 Topps Dynamic Duals Baseball',      // May 22, 2025
  '2025 Bowman Mega Box Baseball',         // May 28, 2025
  '2025 Topps Series 2 Baseball',          // Jun 11, 2025
  '2025 Topps Flagship Collection Series Two Baseball', // Jun 11, 2025
  '2025 Topps All-Star Game Baseball',     // Jul 1, 2025
  '2025 Topps NOW All-Star Game Baseball', // Jul 15, 2025
  '2025 Topps Chrome Baseball',            // Jul 23, 2025
  '2025 Topps X Bob Ross — The Joy of Baseball', // Jul 31, 2025
  '2025 Topps Finest Baseball',            // Aug 12, 2025
  '2025 Topps Chrome Sapphire Baseball',   // Aug 27, 2025
  '2025 Topps Shoebox Treasures Baseball', // Sep 4, 2025
  '2025 Topps Tier One Baseball',           // Sep 10, 2025
  '2025 Bowman Chrome Baseball',           // Sep 23, 2025
  '2025 Bowman Chrome Mega Box Baseball',  // Oct 8, 2025
  '2025 Bowman Chrome Sapphire Baseball',  // Oct 15, 2025
  '2025 Topps Holiday Baseball',           // Oct 22, 2025
  '2025 Topps Update Series Baseball',     // Nov 12, 2025
  '2025 Topps Allen & Ginter Baseball',    // Dec 3, 2025
  '2025 Topps Chrome Update Series Baseball', // Dec 10, 2025
  '2025 Topps Archives Baseball',          // Dec 12, 2025
  '2025 Topps Heritage High Number Baseball', // Dec 17, 2025
  '2025 Topps Cosmic Chrome Baseball',     // Dec 17, 2025
  '2025 Topps Black & White Baseball',     // Dec 18, 2025
  '2025 Topps Museum Collection Baseball', // Feb 6, 2026
  '2025 Topps Pristine Baseball',          // Feb 12, 2026
  '2025 Topps Stadium Club Baseball',      // Feb 18, 2026
  "2025 Bowman's Best Baseball",           // Mar 11, 2026
  '2025 Topps Chrome Platinum Anniversary Baseball', // Jun 5, 2026
  '2025 Topps Inception Baseball',         // Jun 19, 2026
  '2025 Topps NOW Baseball',               // season-long (keep at end)

  // -- 2026 (release order) ----------------------------------------
  '2026 Topps Series 1 Baseball',          // Feb 11, 2026
  '2026 Topps Flagship Collection Series 1 Baseball', // Feb 11, 2026
  '2026 Topps Heritage Baseball',          // Mar 18, 2026
  '2026 Topps Chrome Black Baseball',      // Apr 29, 2026
  '2026 Bowman Baseball',                  // May 13, 2026
  '2026 Topps Series 2 Baseball',          // Jun 10, 2026
  '2026 Topps Tier One Baseball',          // Jun 24, 2026
  '2026 Topps Dynamic Duals Baseball',     // Jun 24, 2026
  '2026 Topps Finest Baseball',            // Jul 8, 2026
  '2026 Topps Chrome Baseball',            // Jul 22, 2026
  '2026 Topps Tribute Baseball',           // Jul 29, 2026
  '2026 World Baseball Classic Topps NOW', // season (keep at end)
  '2026 Topps NOW Baseball',               // season-long (keep at end)
];

function groupCards(cards) {
  const out = {};
  cards.forEach(c => {
    const yr = String(c.year);
    if (!out[yr]) out[yr] = {};
    if (!out[yr][c.set]) out[yr][c.set] = [];
    out[yr][c.set].push(c);
  });
  // Sort sets within each year by SET_ORDER
  Object.keys(out).forEach(yr => {
    const sorted = {};
    // First add in defined order
    SET_ORDER.forEach(s => { if (out[yr][s]) sorted[s] = out[yr][s]; });
    // Then anything not in order list (alphabetical)
    Object.keys(out[yr]).sort().forEach(s => { if (!sorted[s]) sorted[s] = out[yr][s]; });
    out[yr] = sorted;
  });
  return out;
}

let rowMeta = []; // { id, year, brand, tags }

// -- Beckett checklist URLs keyed by set name -----------------
const BECKETT_URLS = {
  "2023 Bowman Draft Baseball": "https://www.beckett.com/news/2023-bowman-draft-baseball-cards/",
  "2023 Bowman Draft Sapphire Baseball": "https://www.beckett.com/news/2023-bowman-draft-sapphire-baseball-cards/",
  "2023 Bowman's Best Baseball": "https://www.beckett.com/news/2023-bowmans-best-baseball-cards/",
  "2024 Bowman Baseball": "https://www.beckett.com/news/2024-bowman-baseball-cards/",
  "2024 Bowman Chrome Baseball": "https://www.beckett.com/news/2024-bowman-chrome-baseball-cards/",
  "2024 Bowman Mega Box Baseball": "https://www.beckett.com/news/2024-bowman-mega-box-baseball-cards/",
  "2024 Bowman Chrome Mega Box Baseball": "https://www.beckett.com/news/2024-bowman-chrome-mega-box-baseball-cards/",
  "2024 Bowman Sapphire Baseball": "https://www.beckett.com/news/2024-bowman-sapphire-baseball-cards/",
  "2024 Bowman Chrome Sapphire Baseball": "https://www.beckett.com/news/2024-bowman-chrome-sapphire-baseball-cards/",
  "2024 Bowman Sterling Baseball": "https://www.beckett.com/news/2024-bowman-sterling-baseball-cards/",
  "2024 Bowman's Best Baseball": "https://www.beckett.com/news/2024-bowmans-best-baseball-cards/",
  "2024 Topps Update Series Baseball": "https://www.beckett.com/news/2024-topps-update-series-baseball-cards/",
  "2024 Topps Holiday Baseball": "https://www.beckett.com/news/2024-topps-holiday-baseball-cards/",
  "2024 Topps Heritage High Number Baseball": "https://www.beckett.com/news/2024-topps-heritage-high-number-baseball-cards/",
  "2024 Topps Allen & Ginter Baseball": "https://www.beckett.com/news/2024-topps-allen-ginter-baseball-cards/",
  "2024 Topps Allen & Ginter X Baseball": "https://www.beckett.com/news/2024-topps-allen-ginter-x-baseball-cards/",
  "2024 Topps Archives Baseball": "https://www.beckett.com/news/2024-topps-archives-baseball-cards/",
  "2024 Topps Chrome Update Series Baseball": "https://www.beckett.com/news/2024-topps-chrome-update-series-baseball-cards/",
  "2024 Topps Cosmic Chrome Baseball": "https://www.beckett.com/news/2024-topps-cosmic-chrome-baseball-cards/",
  "2024 Topps Chrome Logofractor Edition Baseball": "https://www.beckett.com/news/2024-topps-chrome-logofractor-baseball-cards/",
  "2024 Topps Gilded Collection Baseball": "https://www.beckett.com/news/2024-topps-gilded-collection-baseball-cards/",
  "2024 Topps Stadium Club Baseball": "https://www.beckett.com/news/2024-topps-stadium-club-baseball-cards/",
  "2024 Topps Triple Threads Baseball": "https://www.beckett.com/news/2024-topps-triple-threads-baseball-cards/",
  "2024 Topps Black & White Baseball": "https://www.beckett.com/news/2024-topps-black-and-white-baseball-cards/",
  "2024 Topps Museum Collection Baseball": "https://www.beckett.com/news/2024-topps-museum-collection-baseball-cards/",
  "2024 Topps Five Star Baseball": "https://www.beckett.com/news/2024-topps-five-star-baseball-cards/",
  "2024 Topps Finest Baseball": "https://www.beckett.com/news/2024-topps-finest-baseball-cards/",
  "2024 Topps Inception Baseball": "https://www.beckett.com/news/2024-topps-inception-baseball-cards/",
  "2024 Topps Transcendent Baseball": "https://www.beckett.com/news/2024-topps-transcendent-baseball-cards/",
  "2024 Topps Pristine Baseball": "https://www.beckett.com/news/2024-topps-pristine-baseball-cards/",
  "2024 Topps Tribute Baseball": "https://www.beckett.com/news/2024-topps-tribute-baseball-cards/",
  "2024 Topps Tier One Baseball": "https://www.beckett.com/news/2024-topps-tier-one-baseball-cards/",
  "2024 Topps Sterling Baseball": "https://www.beckett.com/news/2024-topps-sterling-baseball-cards/",
  "2024 Topps 206 Baseball": "https://www.beckett.com/news/2024-topps-206-baseball-cards/",
  "2024 Topps Brooklyn Collection Baseball": "https://www.beckett.com/news/2024-topps-brooklyn-collection-baseball-cards/",
  "2024 Topps NOW Baseball": "https://www.beckett.com/news/2024-topps-now-baseball-cards/",
  "2024 Topps Pro Debut Baseball": "https://www.beckett.com/news/2024-topps-pro-debut-baseball-cards/",
  "2025 Bowman Baseball": "https://www.beckett.com/news/2025-bowman-baseball-cards/",
  "2025 Bowman Mega Box Baseball": "https://www.beckett.com/news/2025-bowman-mega-box-baseball-cards/",
  "2025 Bowman Chrome Baseball": "https://www.beckett.com/news/2025-bowman-chrome-baseball-cards/",
  "2025 Bowman Chrome Mega Box Baseball": "https://www.beckett.com/news/2025-bowman-chrome-mega-box-baseball-cards/",
  "2025 Bowman Chrome Sapphire Baseball": "https://www.beckett.com/news/2025-bowman-chrome-sapphire-baseball-cards/",
  "2025 Bowman's Best Baseball": "https://www.beckett.com/news/2025-bowmans-best-baseball-cards/",
  "2025 Topps Flagship Collection Series One Baseball": "https://www.beckett.com/baseball/2025/topps-flagship-collection/",
  "2025 Topps Flagship Collection Series Two Baseball": "https://www.beckett.com/baseball/2025/topps-flagship-collection-series-2",
  "2025 Topps Series 1 Baseball": "https://www.beckett.com/news/2025-topps-series-1-baseball-cards/",
  "2025 Topps Series 1 Baseball Celebration": "https://www.beckett.com/news/2025-topps-series-1-baseball-celebration-mega-box/",
  "2025 Topps Series 2 Baseball": "https://www.beckett.com/news/2025-topps-series-2-baseball-cards/",
  "2025 Topps Update Series Baseball": "https://www.beckett.com/news/2025-topps-update-series-baseball-cards/",
  "2025 Topps Heritage Baseball": "https://www.beckett.com/news/2025-topps-heritage-baseball-cards/",
  "2025 Topps Heritage High Number Baseball": "https://www.beckett.com/news/2025-topps-heritage-high-number-baseball-cards/",
  "2025 Topps Chrome Sapphire Baseball": "https://www.beckett.com/news/2025-topps-chrome-sapphire-baseball-cards/",
  "2025 Topps Cosmic Chrome Baseball": "https://www.beckett.com/news/2025-topps-cosmic-chrome-baseball-cards/",
  "2025 Topps Allen & Ginter Baseball": "https://www.beckett.com/news/2025-topps-allen-ginter-baseball-checklist-cards",
  "2025 Topps Archives Baseball": "https://www.beckett.com/news/2025-topps-archives-baseball-cards/",
  "2025 Topps Chrome Baseball": "https://www.beckett.com/news/2025-topps-chrome-baseball-cards/",
  "2025 Topps Chrome Update Series Baseball": "https://www.beckett.com/news/2025-topps-chrome-update-series-baseball-cards/",
  "2025 Topps Museum Collection Baseball": "https://www.beckett.com/news/2025-topps-museum-collection-baseball-cards/",
  "2025 Topps Tribute Baseball": "https://www.beckett.com/news/2025-topps-tribute-baseball-cards/",
  "2025 Topps Chrome Black Baseball": "https://www.beckett.com/news/2025-topps-chrome-black-baseball-cards/",
  "2025 Topps X Bob Ross — The Joy of Baseball": "https://www.beckett.com/news/2025-topps-x-bob-ross-the-joy-of-baseball-cards/",
  "2025 Topps All-Star Game Baseball": "https://www.beckett.com/news/2025-topps-all-star-game-baseball-mega-box-cards/",
  "2025 Topps Shoebox Treasures Baseball": "https://www.beckett.com/news/2025-topps-shoebox-treasures-baseball-cards/",
  "2025 Topps Finest Baseball": "https://www.beckett.com/news/2025-topps-finest-baseball-cards",
  "2025 Topps Holiday Baseball": "https://www.beckett.com/news/2025-topps-holiday-baseball-cards/",
  "2025 Topps Black & White Baseball": "https://www.beckett.com/news/2025-topps-black-and-white-baseball-cards/",
  "2025 Topps Pristine Baseball": "https://www.beckett.com/news/2025-topps-pristine-baseball-cards/",
  "2025 Topps Stadium Club Baseball": "https://www.beckett.com/news/2025-topps-stadium-club-baseball-cards/",
  "2025 Topps Chrome Platinum Anniversary Baseball": "https://www.beckett.com/news/2025-topps-chrome-platinum-anniversary-baseball-cards/",
  "2025 Topps Tier One Baseball": "https://www.beckett.com/news/2025-topps-tier-one-baseball-cards/",
  "2025 Topps Transcendent Baseball": "https://www.beckett.com/news/2025-topps-transcendent-baseball-cards/",
  "2026 Bowman Baseball": "https://www.beckett.com/news/2026-bowman-baseball-cards/",
  "2026 Topps Chrome Black Baseball": "https://www.beckett.com/news/2026-topps-chrome-black-baseball-cards/",
  "2026 Topps Tribute Baseball": "https://www.beckett.com/news/2026-topps-tribute-baseball-cards/",
  "2026 Topps Series 1 Baseball": "https://www.beckett.com/news/2026-topps-series-1-baseball-cards/",
  "2026 Topps Series 2 Baseball": "https://www.beckett.com/news/2026-topps-series-2-baseball-cards/",
  "2026 Topps Chrome Baseball": "https://www.beckett.com/news/2026-topps-chrome-baseball-cards/",
  "2024 Topps Definitive Baseball": "https://www.beckett.com/news/2024-topps-definitive-baseball-cards/",
  "2024 Topps Diamond Icons Baseball": "https://www.beckett.com/news/2024-topps-diamond-icons-baseball-cards/",
  "2024 Topps Chrome Sapphire Update Series Baseball": "https://www.beckett.com/news/2024-topps-chrome-sapphire-update-series-baseball-cards/",
  "2024 Topps x Chris Berman: Boomer's Baseball": "https://www.beckett.com/news/2024-topps-x-chris-berman-boomers-baseball-cards/",
  "2025 Topps Inception Baseball": "https://www.beckett.com/news/2025-topps-inception-baseball-cards/",
  "2026 Topps Finest Baseball": "https://www.beckett.com/news/2026-topps-finest-baseball-cards/",
  "2026 Topps Tier One Baseball": "https://www.beckett.com/news/2026-topps-tier-one-baseball-cards/",
  "2026 Topps Dynamic Duals Baseball": "https://www.beckett.com/news/2026-topps-dynamic-duals-baseball-cards/",
  "2026 Topps Heritage Baseball": "https://www.beckett.com/news/2026-topps-heritage-baseball-cards/",
};

// -- Checklist Insider checklist URLs keyed by set name -------
const CI_URLS = {
  // 2023
  // 2024
  "2024 Bowman Baseball": "https://www.checklistinsider.com/2024-bowman-baseball",
  "2024 Bowman Chrome Baseball": "https://www.checklistinsider.com/2024-bowman-chrome-baseball",
  "2024 Bowman Chrome Mega Box Baseball": "https://www.checklistinsider.com/2024-bowman-chrome-mega-box-baseball",
  "2024 Bowman Chrome Sapphire Baseball": "https://www.checklistinsider.com/2024-bowman-chrome-sapphire-baseball",
  "2024 Bowman Mega Box Baseball": "https://www.checklistinsider.com/2024-bowman-mega-box-baseball",
  "2024 Bowman Sapphire Baseball": "https://www.checklistinsider.com/2024-bowman-sapphire-baseball",
  "2024 Bowman Sterling Baseball": "https://www.checklistinsider.com/2024-bowman-sterling-baseball",
  "2024 Bowman's Best Baseball": "https://www.checklistinsider.com/2024-bowmans-best-baseball",
  "2024 Topps Allen & Ginter Baseball": "https://www.checklistinsider.com/2024-topps-allen-ginter-baseball",
  "2024 Topps Allen & Ginter X Baseball": "https://www.checklistinsider.com/2024-topps-allen-ginter-x-baseball",
  "2024 Topps Archives Baseball": "https://www.checklistinsider.com/2024-topps-archives-baseball",
  "2024 Topps 206 Baseball": "https://www.checklistinsider.com/2024-topps-206-baseball",
  "2024 Topps Black & White Baseball": "https://www.checklistinsider.com/2024-topps-black-white-baseball",
  "2024 Topps Brooklyn Collection Baseball": "https://www.checklistinsider.com/2024-topps-brooklyn-collection-baseball",
  "2024 Topps Chrome Logofractor Edition Baseball": "https://www.checklistinsider.com/2024-topps-chrome-logofractor-baseball",
  "2024 Topps Chrome Sapphire Update Series Baseball": "https://www.checklistinsider.com/2024-topps-chrome-update-sapphire-baseball",
  "2024 Topps Chrome Update Series Baseball": "https://www.checklistinsider.com/2024-topps-chrome-update-series-baseball",
  "2024 Topps Cosmic Chrome Baseball": "https://www.checklistinsider.com/2024-topps-cosmic-chrome-baseball",
  "2024 Topps Definitive Baseball": "https://www.checklistinsider.com/2024-topps-definitive-baseball",
  "2024 Topps Diamond Icons Baseball": "https://www.checklistinsider.com/2024-topps-diamond-icons-baseball",
  "2024 Topps Finest Baseball": "https://www.checklistinsider.com/2024-topps-finest-baseball",
  "2024 Topps Five Star Baseball": "https://www.checklistinsider.com/2024-topps-five-star-baseball",
  "2024 Topps Gilded Collection Baseball": "https://www.checklistinsider.com/2024-topps-gilded-collection-baseball",
  "2024 Topps Heritage High Number Baseball": "https://www.checklistinsider.com/2024-topps-heritage-high-number-baseball",
  "2024 Topps Holiday Baseball": "https://www.checklistinsider.com/2024-topps-holiday-baseball",
  "2024 Topps Inception Baseball": "https://www.checklistinsider.com/2024-topps-inception-baseball",
  "2024 Topps Museum Collection Baseball": "https://www.checklistinsider.com/2024-topps-museum-collection-baseball",
  "2024 Topps Pristine Baseball": "https://www.checklistinsider.com/2024-topps-pristine-baseball",
  "2024 Topps Stadium Club Baseball": "https://www.checklistinsider.com/2024-topps-stadium-club-baseball",
  "2024 Topps Sterling Baseball": "https://www.checklistinsider.com/2024-topps-sterling-baseball",
  "2024 Topps Tier One Baseball": "https://www.checklistinsider.com/2024-topps-tier-one-baseball",
  "2024 Topps Transcendent Baseball": "https://www.checklistinsider.com/2024-topps-transcendent-baseball",
  "2024 Topps Tribute Baseball": "https://www.checklistinsider.com/2024-topps-tribute-baseball",
  "2024 Topps Triple Threads Baseball": "https://www.checklistinsider.com/2024-topps-triple-threads-baseball",
  "2024 Topps Pro Debut Baseball": "https://www.checklistinsider.com/2024-topps-pro-debut-baseball",
  "2024 Topps Update Series Baseball": "https://www.checklistinsider.com/2024-topps-update-series-baseball",
  "2024 Topps x Chris Berman: Boomer's Baseball": "https://www.checklistinsider.com/2024-topps-x-chris-berman-boomers-baseball",
  // 2025
  "2025 Bowman Baseball": "https://www.checklistinsider.com/2025-bowman-baseball",
  "2025 Bowman Chrome Baseball": "https://www.checklistinsider.com/2025-bowman-chrome-baseball",
  "2025 Bowman Chrome Mega Box Baseball": "https://www.checklistinsider.com/2025-bowman-chrome-mega-box-baseball",
  "2025 Bowman Chrome Sapphire Baseball": "https://www.checklistinsider.com/2025-bowman-chrome-sapphire-baseball",
  "2025 Topps Dynamic Duals Baseball": "https://www.checklistinsider.com/2025-topps-dynamic-duals-baseball",
  "2025 Bowman Mega Box Baseball": "https://www.checklistinsider.com/2025-bowman-mega-box-baseball",
  "2025 Bowman's Best Baseball": "https://www.checklistinsider.com/2025-bowmans-best-baseball",
  "2025 Topps Allen & Ginter Baseball": "https://www.checklistinsider.com/2025-topps-allen-ginter-baseball",
  "2025 Topps Archives Baseball": "https://www.checklistinsider.com/2025-topps-archives-baseball",
  "2025 Topps Chrome Baseball": "https://www.checklistinsider.com/2025-topps-chrome-baseball",
  "2025 Topps Chrome Platinum Anniversary Baseball": "https://www.checklistinsider.com/2025-topps-chrome-platinum-baseball",
  "2025 Topps Chrome Sapphire Baseball": "https://www.checklistinsider.com/2025-topps-chrome-sapphire-baseball",
  "2025 Topps Chrome Update Series Baseball": "https://www.checklistinsider.com/2025-topps-chrome-update-series-baseball",
  "2025 Topps Cosmic Chrome Baseball": "https://www.checklistinsider.com/2025-topps-cosmic-chrome-baseball",
  "2025 Topps Finest Baseball": "https://www.checklistinsider.com/2025-topps-finest-baseball",
  "2025 Topps NOW All-Star Game Baseball": "https://www.checklistinsider.com/2025-topps-now-all-star-game-set-baseball",
  "2025 Topps Holiday Baseball": "https://www.checklistinsider.com/2025-topps-holiday-baseball",
  "2025 Topps Shoebox Treasures Baseball": "https://www.checklistinsider.com/2025-topps-shoebox-treasures-baseball",
  "2025 Topps Heritage Baseball": "https://www.checklistinsider.com/2025-topps-heritage-baseball",
  "2025 Topps Heritage High Number Baseball": "https://www.checklistinsider.com/2025-topps-heritage-high-number-baseball",
  "2025 Topps Inception Baseball": "https://www.checklistinsider.com/2025-topps-inception-baseball",
  "2025 Topps Museum Collection Baseball": "https://www.checklistinsider.com/2025-topps-museum-collection-baseball",
  "2025 Topps Black & White Baseball": "https://www.checklistinsider.com/2025-topps-black-white-baseball",
  "2025 Topps Pristine Baseball": "https://www.checklistinsider.com/2025-topps-pristine-baseball",
  "2025 Topps Series 1 Baseball": "https://www.checklistinsider.com/2025-topps-series-1-baseball",
  "2025 Topps Series 1 Baseball Celebration": "https://www.checklistinsider.com/2025-topps-series-1-baseball-celebration",
  "2025 Topps Series 2 Baseball": "https://www.checklistinsider.com/2025-topps-series-2-baseball",
  "2025 Topps Stadium Club Baseball": "https://www.checklistinsider.com/2025-topps-stadium-club-baseball",
  "2025 Topps Tier One Baseball": "https://www.checklistinsider.com/2025-topps-tier-one-baseball",
  "2025 Topps Transcendent Baseball": "https://www.checklistinsider.com/2025-topps-transcendent-baseball",
  "2025 Topps Tribute Baseball": "https://www.checklistinsider.com/2025-topps-tribute-baseball",
  "2025 Topps Chrome Black Baseball": "https://www.checklistinsider.com/2025-topps-chrome-black-baseball",
  "2025 Topps Update Series Baseball": "https://www.checklistinsider.com/2025-topps-update-series-baseball",
  "2025 Topps X Bob Ross — The Joy of Baseball": "https://www.checklistinsider.com/2025-topps-x-bob-ross-the-joy-of-baseball",
  // 2026
  "2026 Bowman Baseball": "https://www.checklistinsider.com/2026-bowman-baseball",
  "2026 Topps Chrome Baseball": "https://www.checklistinsider.com/2026-topps-chrome-baseball",
  "2026 Topps Chrome Black Baseball": "https://www.checklistinsider.com/2026-topps-chrome-black-baseball",
  "2026 Topps Dynamic Duals Baseball": "https://www.checklistinsider.com/2026-topps-dynamic-duals-baseball",
  "2026 Topps Finest Baseball": "https://www.checklistinsider.com/2026-topps-finest-baseball",
  "2026 Topps Heritage Baseball": "https://www.checklistinsider.com/2026-topps-heritage-baseball",
  "2026 Topps Series 1 Baseball": "https://www.checklistinsider.com/2026-topps-series-1-baseball",
  "2026 Topps Series 2 Baseball": "https://www.checklistinsider.com/2026-topps-series-2-baseball",
  "2026 Topps Tier One Baseball": "https://www.checklistinsider.com/2026-topps-tier-one-baseball",
  "2026 Topps Tribute Baseball": "https://www.checklistinsider.com/2026-topps-tribute-baseball",
  "2026 World Baseball Classic Topps NOW": "https://www.checklistinsider.com/2026-topps-now-wbc-team-sets-baseball",
};

// ============================================================
//  PARALLEL TEMPLATES
//  Key format: "set name lowercase::type-category"
//  Type categories: base | chrome | chrome-auto | auto | sapphire | sapphire-auto | insert | variation | mini
//  Each entry: { id (url-safe slug), name (display), printRun (e.g. "/499" or "1/1" or null) }
//  Cards can override lookup with a parallelKey property.
// ============================================================

function getParallelTemplateKey(c) {
  if (c.parallelKey) return c.parallelKey;
  const set = c.set.toLowerCase();
  const type = (c.type || '').toLowerCase();
  let cat;
  if (type === 'mini') cat = 'mini';
  else if (type.includes('sapphire') && type.includes('auto')) cat = 'sapphire-auto';
  else if (type.includes('sapphire')) cat = 'sapphire';
  else if (type.includes('chrome') && type.includes('auto')) cat = 'chrome-auto';
  else if (type.includes('auto')) cat = 'auto';
  else if (type.includes('chrome')) cat = 'chrome';
  else if (type.includes('insert')) cat = 'insert';
  else if (type.includes('variation')) cat = 'variation';
  else cat = 'base';
  return `${set}::${cat}`;
}

function getCardParallels(c) {
  return PARALLEL_TEMPLATES[getParallelTemplateKey(c)] || [];
}

// -- Release dates pulled from Beckett's yearly release calendar pages --
const RELEASE_DATES = {
  "2023 Bowman Draft Baseball": "December 12, 2023",
  "2023 Bowman Draft Sapphire Baseball": "January 3, 2024",
  "2023 Bowman's Best Baseball": "January 17, 2024",
  "2024 Topps Hobby Rip Night Baseball": "February 24, 2024",
  "2024 Bowman Baseball": "May 8, 2024",
  "2024 Topps Pro Debut Baseball": "September 6, 2024",
  "2024 Bowman Chrome Baseball": "September 11, 2024",
  "2024 Bowman Chrome Mega Box Baseball": "October 2, 2024",
  "2024 Bowman Mega Box Baseball": "May 29, 2024",
  "2024 Bowman Sapphire Baseball": "June 5, 2024",
  "2024 Bowman Chrome Sapphire Baseball": "November 20, 2024",
  "2024 Bowman Sterling Baseball": "October 9, 2024",
  "2024 Bowman's Best Baseball": "January 15, 2025",
  "2024 Topps Update Series Baseball": "October 16, 2024",
  "2024 Topps Chrome Update Series Baseball": "November 13, 2024",
  "2024 Topps Heritage High Number Baseball": "March 26, 2025",
  "2024 Topps Holiday Baseball": "November 15, 2024",
  "2024 Topps Living Set": "October 2024",
  "2024 Topps Allen & Ginter Baseball": "October 30, 2024",
  "2024 Topps Allen & Ginter X Baseball": "December 6, 2024",
  "2024 Topps Stadium Club Baseball": "November 6, 2024",
  "2024 Topps Archives Baseball": "January 8, 2025",
  "2024 Topps Gilded Collection Baseball": "November 20, 2024",
  "2024 Topps Cosmic Chrome Baseball": "October 11, 2024",
  "2024 Topps Triple Threads Baseball": "December 19, 2024",
  "2024 Topps Black & White Baseball": "November 20, 2024",
  "2024 Topps Museum Collection Baseball": "July 31, 2024",
  "2024 Topps Five Star Baseball": "September 27, 2024",
  "2024 Topps Transcendent Baseball": "January 22, 2025",
  "2024 Topps Pristine Baseball": "August 30, 2024",
  "2024 Topps 206 Baseball": "October 3, 2024",
  "2024 Topps Brooklyn Collection Baseball": "December 11, 2024",
  "2025 Topps Series 1 Baseball": "February 12, 2025",
  "2025 Topps Flagship Collection Series One Baseball": "February 12, 2025",
  "2025 Topps Series 1 Baseball Celebration": "March 26, 2025",
  "2025 Topps Series 2 Baseball": "June 11, 2025",
  "2025 Topps Heritage Baseball": "April 23, 2025",
  "2025 Topps Heritage High Number Baseball": "December 17, 2025",
  "2025 Topps Allen & Ginter Baseball": "December 3, 2025",
  "2025 Topps Finest Baseball": "August 12, 2025",
  "2025 Topps Chrome Baseball": "July 23, 2025",
  "2025 Topps Chrome Update Series Baseball": "December 10, 2025",
  "2025 Topps Update Series Baseball": "November 12, 2025",
  "2025 Topps Archives Baseball": "December 12, 2025",
  "2025 Topps Black & White Baseball": "December 18, 2025",
  "2025 Topps Stadium Club Baseball": "February 18, 2026",
  "2025 Topps Pristine Baseball": "February 12, 2026",
  "2025 Topps Tribute Baseball": "April 23, 2025",
  "2025 Topps Chrome Black Baseball": "April 30, 2025",
  "2025 Topps Museum Collection Baseball": "February 6, 2026",
  "2025 Topps Flagship Collection Series Two Baseball": "June 11, 2025",
  "2025 Topps All-Star Game Baseball": "July 1, 2025",
  "2025 Topps NOW All-Star Game Baseball": "July 15, 2025",
  "2025 Topps Holiday Baseball": "October 22, 2025",
  "2025 Topps Shoebox Treasures Baseball": "September 4, 2025",
  "2025 Topps Tier One Baseball": "September 10, 2025",
  "2025 Topps X Bob Ross — The Joy of Baseball": "July 31, 2025",
  "2025 Bowman Baseball": "May 7, 2025",
  "2025 Topps Dynamic Duals Baseball": "May 22, 2025",
  "2025 Bowman Mega Box Baseball": "May 28, 2025",
  "2025 Bowman Chrome Baseball": "September 23, 2025",
  "2025 Bowman Chrome Mega Box Baseball": "October 8, 2025",
  "2025 Bowman Chrome Sapphire Baseball": "October 15, 2025",
  "2025 Bowman's Best Baseball": "March 11, 2026",
  "2026 Topps Series 1 Baseball": "February 11, 2026",
  "2026 Topps Flagship Collection Series 1 Baseball": "February 11, 2026",
  "2026 Topps Heritage Baseball": "March 18, 2026",
  "2026 Bowman Baseball": "May 13, 2026",
  "2026 Topps Chrome Black Baseball": "April 29, 2026",
  "2026 Topps Tribute Baseball": "July 29, 2026",
  "2026 Topps Series 2 Baseball": "June 10, 2026",
  "2026 Topps Chrome Baseball": "July 22, 2026",
  "2024 Topps Definitive Baseball": "January 10, 2025",
  "2024 Topps Diamond Icons Baseball": "February 5, 2025",
  "2024 Topps Chrome Sapphire Update Series Baseball": "December 10, 2024",
  "2024 Topps x Chris Berman: Boomer's Baseball": "December 12, 2024",
  "2025 Topps Inception Baseball": "June 19, 2026",
  "2026 Topps Tier One Baseball": "June 24, 2026",
  "2026 Topps Dynamic Duals Baseball": "June 24, 2026",
  "2024 Topps Inception Baseball": "June 18, 2025",
  "2025 Topps Chrome Sapphire Baseball": "August 27, 2025",
  "2025 Topps Cosmic Chrome Baseball": "December 17, 2025",
  "2025 Bowman Chrome Sapphire Baseball": "October 15, 2025",
  "2025 Topps Chrome Platinum Anniversary Baseball": "June 5, 2026",
  "2026 Topps Finest Baseball": "July 8, 2026",
};

function buildAll() {
  const wrap = document.getElementById('mainContent');
  let html = '';
  let total = 0;
  rowMeta = [];
  const usedRowIds = new Set(); // dedup: same set+num+type on multiple cards

  const grouped = groupCards(CARDS);
  const years = Object.keys(grouped).sort();

  years.forEach(year => {
    const sets = grouped[year];
    const setNames = Object.keys(sets);

    setNames.forEach((setName, si) => {
      const cards = sets[setName];
      const domId = `s-${year}-${si}`;
      // Use set name for data-brand so filter still works
      const brandSlug = setName.toLowerCase();

      const beckettUrl = BECKETT_URLS[setName] || '';
      const beckettLink = beckettUrl ? `<a class="set-beckett-link" href="${beckettUrl}" target="_blank" onclick="event.stopPropagation()" title="View checklist on Beckett">📋 Beckett</a>` : '';
      const ciUrl = CI_URLS[setName] || '';
      const ciLink = ciUrl ? `<a class="set-ci-link" href="${ciUrl}" target="_blank" onclick="event.stopPropagation()" title="View checklist on Checklist Insider">📋 CI</a>` : '';
      const releaseDate = RELEASE_DATES[setName] || '';
      const releaseDateSpan = releaseDate ? `<span class="set-release-date" title="Release date per Beckett"><span class="release-date-label">Release Date:</span> ${releaseDate}</span>` : '';

      const totalPars = cards.reduce((sum, c) => sum + getCardParallels(c).length, 0);
      html += `<div class="set-section" data-year="${year}" data-set="${setName.toLowerCase()}">
        <div class="set-header" onclick="toggleSet('${domId}')">
          <span class="set-year">${year}</span>
          <span class="set-name">${setName}</span>
          ${beckettLink}${ciLink}
          ${releaseDateSpan}
          <span class="set-badge">${cards.length} card${cards.length!==1?'s':''}</span>
          <span class="set-par-badge">${totalPars} parallel${totalPars!==1?'s':''}</span>
          <span class="set-owned-badge">0 owned</span>
          <span class="set-toggle" id="tog-${domId}">▼</span>
        </div>
        <div class="tbl-wrap" id="${domId}">
          <table>
            <thead><tr>
              <th class="th-own">Own</th>
              <th class="th-img">View</th>
              <th class="th-num">Card #</th>
              <th class="th-card">Card</th>
              <th class="th-tags">Tags</th>
              <th class="th-par">Parallel</th>
              <th class="th-numto">#'d</th>
              <th class="th-qty">Qty</th>
              <th class="th-cost">My Cost</th>
              <th class="th-val">Value</th>
              <th class="th-notes">Notes</th>
            </tr></thead>
            <tbody>`;

      cards.forEach((c, ci) => {
        if (c._hide) return; // card removed without shifting rowIds
        let rowId = `s|${setName}|${c.num}|${c.type||'base'}`;
        if (usedRowIds.has(rowId)) {
          let dupN = 2;
          while (usedRowIds.has(`${rowId}-${dupN}`)) dupN++;
          rowId = `${rowId}-${dupN}`;
        }
        usedRowIds.add(rowId);
        const baseKey = `${rowId}__base`;
        const grailCls = c.isGrail ? ' grail-row' : '';
        const isOwned = ownedSet.has(rowId);    // true if ANY variant owned
        const isBaseOwned = ownedData.has(baseKey); // true if base specifically owned
        const ownedCls = isOwned ? ' owned-row' : '';
        // Template parallels for this card (moved up so parallel names feed into searchStr)
        const tmplPars = getCardParallels(c);
        const parNameStr = tmplPars.map(p => p.name).join(' ').toLowerCase();
        const searchStr = [year, setName, c.num, c.title, c.type, c.parallel||'', c.printRun||'', c.notes, (c.tags||[]).join(' ')].join(' ').toLowerCase();
        rowMeta.push({ id: rowId, year: String(year), set: setName.toLowerCase(), tags: c.tags||[], search: searchStr, parSearch: parNameStr });
        const parToggleBtn = tmplPars.length
          ? `<button class="par-toggle-btn" id="ptbtn-${rowId}" onclick="toggleParallelPanel('${rowIdAttr(rowId)}')" title="Show/hide ${tmplPars.length} template parallels">▶ ${tmplPars.length} Parallel${tmplPars.length!==1?'s':''}</button>`
          : '';

        html += `<tr id="${rowId}" class="${grailCls}${ownedCls}" data-is-mini="${/mini/i.test(c.type||'') && !c.notMini?'1':''}">
          <td class="own-cell"><input type="checkbox" class="own-cb" ${isBaseOwned?'checked':''} onchange="toggleOwn(this,'${rowIdAttr(baseKey)}')"></td>
          <td class="thumb-cell">${mkThumb(c, rowId)}</td>
          <td class="c-num"><span style="display:inline-flex;flex-direction:column;align-items:center;">${c.num}${c.isGrail ? '<span class="grail-gem" title="Grail card">💎</span>' : ''}</span></td>
          <td><div class="c-card-title">${displayTitle(c.title)}</div><div class="c-card-sub">${c.type}</div>${parToggleBtn}</td>
          <td>${mkTags(c.tags)}</td>
          <td class="c-par"><span class="c-par-text" style="${getParallelNameStyle(c.parallel)}">${formatParallelName(c.parallel)}</span>
            ${c.printRun ? `<div class="c-par-pr-pill">${mkPrintRunPill(c.printRun, c.parallel, c.numPill)}</div>` : ''}
          </td>
          <td class="c-numto">${mkPrintRunPill(c.printRun, c.parallel, c.numPill)}</td>
          <td class="c-qty-cell split-cell">${isBaseOwned ? mkSplitQtyContents(baseKey) : SPLIT_EMPTY}</td>
          <td class="c-cost-cell split-cell">${isBaseOwned ? mkSplitCostContents(baseKey) : SPLIT_EMPTY}</td>
          <td class="c-val-cell split-cell">${mkValueCellContents(c.raw, c.psa10, c.priceFlag)}</td>
          <td class="c-notes">${c.notes}</td>
        </tr>`;
        total++;

        // Render template parallel rows (collapsed by default)
        if (tmplPars.length) {
          tmplPars.forEach((p, parIdx) => {
            const varKey = `${rowId}__${p.id}`;
            const isParOwned = ownedData.has(varKey);
            const parOwnedCls = isParOwned ? ' owned-row' : '';
            const parBorderCls = (parIdx === 0 ? ' par-first' : '') + (parIdx === tmplPars.length - 1 ? ' par-last' : '');
            const _parBaseSlug = cardImgFilename(c.set, c.num, c.title, c.type);
            const _parSlug     = _parBaseSlug ? `${_parBaseSlug}--${p.id}` : '';
            const _parImgPath  = _parSlug ? `images/${_parSlug}.jpg` : '';
            const _parEbayBase = (() => {
              let q = (c.ebayQ || `Paul Skenes ${c.set} ${c.num}`).replace(/\s+Base\s*$/, '');
              if (c.num) {
                const needle = ' ' + c.num;
                const idx = q.lastIndexOf(needle);
                if (idx >= 0) q = q.slice(0, idx) + ' #' + c.num + q.slice(idx + needle.length);
              }
              return q;
            })();
            const _parEbayRaw  = _parEbayBase + ' ' + p.name + (p.printRun && p.printRun !== '1/1' ? ' ' + p.printRun : '');
            const _parEbayUrl  = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(_parEbayRaw)}&LH_Complete=1&LH_Sold=1`;
            const _parLabel    = `${displayTitle(c.title)} — ${p.name}${p.printRun ? ' ' + p.printRun : ''}`;
            const _parLabelJs  = _parLabel.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const _parLabelHtml= _parLabel.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
            const _parEbaySafe = _parEbayUrl.replace(/'/g, '%27');
            const _parFilename = _parSlug ? _parSlug + '.jpg' : '';
            const _parThumb    = `<div class="thumb-wrap">
  <button class="card-thumb${_parImgPath ? ' has-photo' : ''}${c.set === '2024 Topps 206 Baseball' ? ' t206-thumb' : ''}" onclick="openThumbLightbox('${_parEbaySafe}','${_parLabelJs}',this.dataset.largeUrl||'${_parImgPath}','${_parFilename}',${/mini/i.test(c.type||'')},${c.set === '2024 Topps 206 Baseball'})" title="${_parLabelHtml}">
    ${_parImgPath ? `<img src="${_parImgPath}" alt="${_parLabelHtml}" class="card-thumb-img" onload="thumbImgLoad(this)" onerror="onThumbError(this)">` : '🃏'}
  </button>
  <div class="thumb-ebay-btns">
    <a class="thumb-mag thumb-bin"    href="${_parEbaySafe.replace('&LH_Complete=1&LH_Sold=1','')+'&LH_BIN=1&_sop=15'}" target="_blank" title="eBay Buy It Now: ${_parLabelHtml}">🏷️</a>
    <a class="thumb-mag thumb-active" href="${_parEbaySafe.replace('&LH_Complete=1&LH_Sold=1','')+'&_sop=15'}"          target="_blank" title="eBay all active: ${_parLabelHtml}">🛒</a>
    <a class="thumb-mag thumb-sold"   href="${_parEbaySafe}"                                                             target="_blank" title="eBay sold: ${_parLabelHtml}">🔨</a>
  </div>
</div>`;
            html += `<tr id="${CSS.escape(varKey)}" class="par-tmpl-row${parOwnedCls}${parBorderCls}" data-parent="${rowId}" data-varid="${varKey}" data-par-name="${p.name.toLowerCase()}" data-is-mini="${/mini/i.test(c.type||'')?'1':''}" style="display:none;--par-stripe:${getParBorderGradient(p.name)}">
              <td class="own-cell"><input type="checkbox" class="own-cb" ${isParOwned?'checked':''} onchange="toggleOwn(this,'${rowIdAttr(varKey)}')"></td>
              <td class="thumb-cell">${_parThumb}</td>
              <td class="c-num" style="color:var(--text3);font-size:10px;">↳ ${c.num}</td>
              <td><div class="c-card-title" style="font-size:12px;">${displayTitle(c.title)}</div><div class="c-card-sub">${c.type}</div></td>
              <td><span class="par-tmpl-label">PARALLEL</span>${p.tags && p.tags.length ? mkTags(p.tags) : ''}</td>
              <td class="c-par">
                <span class="par-tmpl-name" style="${getParallelNameStyle(p.name)}">${formatParallelName(p.name)}</span>
                ${p.printRun ? `<div class="c-par-pr-pill">${mkPrintRunPill(p.printRun, p.name)}</div>` : ''}
              </td>
              <td class="c-numto">${mkPrintRunPill(p.printRun, p.name)}</td>
              <td class="c-qty-cell split-cell">${isParOwned ? mkSplitQtyContents(varKey) : SPLIT_EMPTY}</td>
              <td class="c-cost-cell split-cell">${isParOwned ? mkSplitCostContents(varKey) : SPLIT_EMPTY}</td>
              <td class="c-val-cell split-cell">${mkValueCellContents(p.raw||'', '', p.priceFlag)}</td>
              <td class="c-notes" style="color:var(--text3);font-size:10.5px;">${p.hideLabel ? (p.notes||'') : `Template parallel${p.notes ? ` (${p.notes})` : ''}`}</td>
            </tr>`;
            total++;
          });
        }

        // Render any user-added parallels for this base card, right beneath it
        html += renderParallelRowsFor(rowId);
      });

      html += `</tbody></table></div></div>`;
    });
  });

  wrap.innerHTML = html;
  document.getElementById('totCount').textContent = total;
  document.getElementById('totCount2').textContent = total;
  document.getElementById('visCount').textContent = total;
  updateOwnedCount();
  updateStatsDashboard();
  document.querySelectorAll('.set-section').forEach(sec => updateSectionOwnedBadge(sec));
}

function toggleOwn(cb, variantKey) {
  // When unchecking an already-owned card, ask before wiping qty/cost data
  if (!cb.checked && ownedData.has(variantKey)) {
    if (!confirm('Uncheck this card and clear its quantity/cost data?')) {
      cb.checked = true;
      return;
    }
  }

  // variantKey is the ownedData key, e.g.: "r-2025-3-7__base", "r-2025-3-7__gold", "up-1234-abc"
  // domId: the <tr> element's id attribute
  const domId = variantKey.endsWith('__base') ? variantKey.slice(0, -6) : variantKey;
  // baseRowId: the base card's <tr> id (without any __variant suffix)
  const dunder = variantKey.indexOf('__');
  const baseRowId = dunder >= 0 ? variantKey.slice(0, dunder) : variantKey;

  const row = cb.closest('tr');
  const baseRow = document.getElementById(baseRowId);
  const costCell = row ? row.querySelector('.c-cost-cell') : null;
  const qtyCell  = row ? row.querySelector('.c-qty-cell')  : null;

  if (cb.checked) {
    const existing = ownedData.get(variantKey);
    ownedData.set(variantKey, existing || { rawQty: 1, rawCost: null, psaQty: 0, psaCost: null, dateAdded: new Date().toISOString().slice(0,10) });
    if (row) row.classList.add('owned-row');
    if (baseRow && baseRow !== row) baseRow.classList.add('owned-row');
    if (qtyCell)  qtyCell.innerHTML  = mkSplitQtyContents(variantKey);
    if (costCell) costCell.innerHTML = mkSplitCostContents(variantKey);
  } else {
    ownedData.delete(variantKey);
    if (row) row.classList.remove('owned-row');
    if (qtyCell)  qtyCell.innerHTML  = SPLIT_EMPTY;
    if (costCell) costCell.innerHTML = SPLIT_EMPTY;
    if (baseRow && baseRow !== row) {
      const anyOwned = ownedSet.has(baseRowId);
      if (!anyOwned) baseRow.classList.remove('owned-row');
    }
  }
  saveOwned();
  updateOwnedCount();
  updateStatsDashboard();
  const section = cb.closest('.set-section');
  if (section) updateSectionOwnedBadge(section);
}

// Toggle visibility of template parallel rows for a given base card rowId
function toggleParallelPanel(rowId) {
  const rows = document.querySelectorAll(`.par-tmpl-row[data-parent="${rowId}"]`);
  const btn  = document.getElementById(`ptbtn-${rowId}`);
  const anyVisible = Array.from(rows).some(r => r.style.display === 'table-row');
  rows.forEach(r => { r.style.display = anyVisible ? 'none' : 'table-row'; });
  if (btn) {
    btn.textContent = anyVisible ? `▶ ${rows.length} Parallel${rows.length!==1?'s':''}` : `▼ ${rows.length} Parallel${rows.length!==1?'s':''}`;
    btn.classList.toggle('open', !anyVisible);
  }
}

// Encode a rowId for safe embedding inside onclick="fn('...')" attribute values.
// Use \' (JS escape) for apostrophes — HTML entities like &#39; get decoded by the
// HTML parser before JS runs, which would still break the string literal.
// & is encoded as &amp; because HTML parses that before JS sees the attribute value.
function rowIdAttr(id) {
  return id.replace(/&/g, '&amp;').replace(/'/g, "\\'");
}

// -- Cost/qty formatting helpers --
function fmtCost(num) {
  if (num == null || isNaN(num)) return '';
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseCostVal(val) {
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return (isNaN(num) || String(val).trim() === '') ? null : num;
}
function ownedDataDisplayPsa(rowId) { return fmtCost(ownedData.get(rowId)?.psaCost ?? null); }
function ownedDataDisplayRaw(rowId) { return fmtCost(ownedData.get(rowId)?.rawCost ?? null); }

// -- Split cell content builders --
const SPLIT_EMPTY = `<div class="split-half"><span class="split-placeholder">—</span></div><div class="split-half"></div>`;
function mkSplitQtyContents(rowId) {
  const entry = ownedData.get(rowId);
  const psaQty = entry ? (entry.psaQty ?? 0) : 0;
  const rawQty = entry ? (entry.rawQty ?? 1) : 1;
  const safe = rowIdAttr(rowId);
  return `<div class="split-half"><span class="split-lbl split-lbl-psa">PSA</span><input type="number" class="split-qty-input" min="0" value="${psaQty}" onchange="setCardPsaQty('${safe}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"></div>` +
    `<div class="split-half"><span class="split-lbl split-lbl-raw">Raw</span><input type="number" class="split-qty-input" min="0" value="${rawQty}" onchange="setCardRawQty('${safe}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"></div>`;
}
function mkSplitCostContents(rowId) {
  const entry = ownedData.get(rowId);
  const psaDisp = entry ? (fmtCost(entry.psaCost) || '') : '';
  const rawDisp = entry ? (fmtCost(entry.rawCost) || '') : '';
  const safe = rowIdAttr(rowId);
  return `<div class="split-half"><span class="split-lbl split-lbl-psa">PSA</span><input type="text" class="split-cost-input" value="${psaDisp}" placeholder="$0.00" onfocus="if(this.value.startsWith('$'))this.value=this.value.replace(/[^0-9.]/g,'')" onblur="setCardPsaCost('${safe}',this.value);this.value=ownedDataDisplayPsa('${safe}')" onkeydown="if(event.key==='Enter')this.blur()"></div>` +
    `<div class="split-half"><span class="split-lbl split-lbl-raw">Raw</span><input type="text" class="split-cost-input" value="${rawDisp}" placeholder="$0.00" onfocus="if(this.value.startsWith('$'))this.value=this.value.replace(/[^0-9.]/g,'')" onblur="setCardRawCost('${safe}',this.value);this.value=ownedDataDisplayRaw('${safe}')" onkeydown="if(event.key==='Enter')this.blur()"></div>`;
}
function _parsePriceNum(s) {
  const n = parseFloat((s || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}
function _mkPriceFlag(oldVal, newVal, checkedAt) {
  const o = _parsePriceNum(oldVal), n = _parsePriceNum(newVal);
  if (!o || !n) return '';
  const pct = ((n - o) / o) * 100;
  const up = pct >= 0;
  const sign = up ? '+' : '';
  const asOf = checkedAt ? ` as of ${checkedAt}` : '';
  const tip  = `Was ${oldVal} → Now ${newVal} (${sign}${pct.toFixed(0)}%)${asOf}`;
  const color = up ? '#27ae60' : '#dc2626';
  const arrow = up
    ? '<path d="M3 17l6 -6l4 4l8 -8"/><path d="M14 7l7 0l0 7"/>'
    : '<path d="M3 7l6 6l4 -4l8 8"/><path d="M14 17l7 0l0 -7"/>';
  const svg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${color}" stroke-width="3.25" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">${arrow}</svg>`;
  return `<span class="price-flag" data-tip="${tip}" title="${tip}">${svg}</span>`;
}
function mkValueCellContents(raw, psa10, flag) {
  const f = flag || {};
  const rawFlag   = f.rawOld   ? _mkPriceFlag(f.rawOld,   raw   || '—', f.checkedAt) : '';
  const psa10Flag = f.psa10Old ? _mkPriceFlag(f.psa10Old, psa10 || '—', f.checkedAt) : '';
  return `<div class="split-half"><span class="split-lbl split-lbl-psa">PSA</span><span class="split-val-psa">${psa10 || '—'}</span>${psa10Flag}</div>` +
    `<div class="split-half"><span class="split-lbl split-lbl-raw">Raw</span><span class="split-val-raw">${raw || '—'}</span>${rawFlag}</div>`;
}

// -- Per-field setters --
function setCardPsaQty(rowId, value) {
  if (!ownedData.has(rowId)) return;
  const entry = ownedData.get(rowId);
  const n = parseInt(value, 10);
  entry.psaQty = (isNaN(n) || n < 0) ? 0 : n;
  ownedData.set(rowId, entry); saveOwned(); updateStatsDashboard();
}
function setCardRawQty(rowId, value) {
  if (!ownedData.has(rowId)) return;
  const entry = ownedData.get(rowId);
  const n = parseInt(value, 10);
  entry.rawQty = (isNaN(n) || n < 0) ? 0 : n;
  ownedData.set(rowId, entry); saveOwned(); updateStatsDashboard();
}
function setCardPsaCost(rowId, value) {
  if (!ownedData.has(rowId)) return;
  const entry = ownedData.get(rowId);
  entry.psaCost = parseCostVal(value);
  ownedData.set(rowId, entry); saveOwned(); updateStatsDashboard();
}
function setCardRawCost(rowId, value) {
  if (!ownedData.has(rowId)) return;
  const entry = ownedData.get(rowId);
  entry.rawCost = parseCostVal(value);
  ownedData.set(rowId, entry); saveOwned(); updateStatsDashboard();
}

// -- Parse a price-range string like "$25–40", "Sold $5,429 Apr 2025", "Auction", "N/A" into a midpoint number --
function parsePriceMidpoint(str) {
  if (!str || typeof str !== 'string') return null;
  if (str === 'Auction' || str.includes('N/A')) return null;
  // Find all dollar amounts in the string (handles "Sold $5,429 Apr 2025" and "$25–40")
  const matches = str.match(/\$[\d,]+(?:\.\d+)?/g);
  if (!matches || !matches.length) return null;
  const nums = matches.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(n => !isNaN(n));
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  return (Math.min(...nums) + Math.max(...nums)) / 2;
}

// -- Find the underlying card/parallel/user-card object for a given key --
// Key may be a stable key like "s|2025 Topps Inception Baseball|52|base__base"
// or a user-added parallel id "up-..." or a ua-card rowId "ua-..." or legacy "r-..."
function findCardByRowId(key) {
  // Strip __variant suffix to get the base rowId
  const dunder = key.indexOf('__');
  const rowId = (dunder >= 0 && !key.startsWith('up-')) ? key.slice(0, dunder) : key;

  if (rowId.startsWith('ua-')) {
    const idx = parseInt(rowId.slice(3), 10);
    const c = userCards[idx];
    return c ? { title: c.title || c.setName, set: c.setName, raw: c.raw, psa10: c.psa10 } : null;
  }
  const p = userParallels.find(p => p.id === rowId);
  if (p) return { title: p.title, set: p.set, raw: p.raw, psa10: p.psa10 };

  // Stable format: s|{setName}|{num}|{type}  (type may have -N dedup suffix, e.g. "Variation-2")
  if (rowId.startsWith('s|')) {
    const parts = rowId.split('|');
    if (parts.length >= 4) {
      const setName = parts[1];
      const num     = parts[2];
      let   type    = parts[3];
      // Strip dedup suffix: "Variation-2" → type="Variation", dupIdx=1
      let dupIdx = 0;
      const dupMatch = type.match(/^(.*)-(\d+)$/);
      if (dupMatch) { type = dupMatch[1]; dupIdx = parseInt(dupMatch[2], 10) - 1; }
      const grouped = groupCards(CARDS);
      for (const yearGroup of Object.values(grouped)) {
        if (!yearGroup[setName]) continue;
        const matches = yearGroup[setName].filter(card => card.num === num && (card.type || 'base') === type);
        const c = matches[dupIdx] ?? matches[0];
        if (c) return { title: displayTitle(c.title), set: setName, num: c.num, type: c.type || 'base', parallel: c.parallel || null, raw: c.raw, psa10: c.psa10 };
      }
    }
    return null;
  }

  // Legacy positional format: r-{year}-{si}-{ci}
  const m = rowId.match(/^r-(\d+)-(\d+)-(\d+)$/);
  if (!m) return null;
  const [, year, si, ci] = m;
  const grouped = groupCards(CARDS);
  const setNames = Object.keys(grouped[year] || {});
  const setName = setNames[parseInt(si, 10)];
  if (!setName) return null;
  const cards = grouped[year][setName];
  const c = cards[parseInt(ci, 10)];
  return c ? { title: displayTitle(c.title), set: setName, num: c.num, type: c.type || 'base', parallel: c.parallel || null, raw: c.raw, psa10: c.psa10 } : null;
}

function updateStatsDashboard() {
  const dash = document.getElementById('statsDash');
  if (!dash) return;

  // Total includes main cards + all parallel template rows + user-added
  let _parTotal = 0;
  CARDS.forEach(c => {
    if (c._hide) return;
    const _k = getParallelTemplateKey(c);
    if (PARALLEL_TEMPLATES[_k]) _parTotal += PARALLEL_TEMPLATES[_k].length;
  });
  const totalChecklist = CARDS.filter(c=>!c._hide).length + userCards.length + userParallels.length + _parTotal;
  // Count unique "cards" owned: each base card counts once regardless of how many parallels owned;
  // user-added parallels (up-...) count as separate items.
  const ownedCardIds = new Set();
  ownedData.forEach((_, key) => {
    if (key.startsWith('up-')) { ownedCardIds.add(key); }
    else if (key.includes('__')) { ownedCardIds.add(key.slice(0, key.indexOf('__'))); }
    else { ownedCardIds.add(key); }
  });
  const ownedCount = ownedCardIds.size;
  const ownedPct = totalChecklist ? Math.round((ownedCount / totalChecklist) * 100) : 0;

  let totalCost = 0, costCount = 0;
  let totalValue = 0, valueCount = 0;
  let topCard = null, topValue = -1, topCardGraded = false, topParallelName = null, topCardImgSlug = null;
  const topCandidates = [];

  ownedData.forEach((entry, rowId) => {
    const rawQty = (entry && entry.rawQty != null && entry.rawQty >= 0) ? entry.rawQty : 0;
    const psaQty = (entry && entry.psaQty != null && entry.psaQty >= 0) ? entry.psaQty : 0;
    if (entry.rawCost != null && !isNaN(entry.rawCost) && rawQty > 0) { totalCost += entry.rawCost * rawQty; costCount++; }
    if (entry.psaCost != null && !isNaN(entry.psaCost) && psaQty > 0) { totalCost += entry.psaCost * psaQty; costCount++; }
    const card = findCardByRowId(rowId);
    if (card) {
      // For owned parallels, try to get the parallel's own raw price from PARALLEL_TEMPLATES
      let parRaw = null, parallelName = null;
      const dunder = rowId.indexOf('__');
      const variantId = dunder >= 0 ? rowId.slice(dunder + 2) : 'base';
      if (variantId && variantId !== 'base') {
        const baseRowId = rowId.slice(0, dunder);
        const baseCard  = findCardByRowId(baseRowId + '__base') || findCardByRowId(baseRowId);
        if (baseCard) {
          // Parse baseRowId parts directly (avoid startsWith which can match a shorter type like "Base" when type is "Base Chrome")
          const bParts = baseRowId.startsWith('s|') ? baseRowId.split('|') : [];
          const bSet  = bParts[1] || '';
          const bNum  = bParts[2] || '';
          const bType = bParts[3] || 'base';
          const bCard = CARDS.find(c => (c.set || c.setName) === bSet && c.num === bNum && (c.type || 'base') === bType);
          const tmplKey = bCard ? getParallelTemplateKey(bCard) : '';
          const tmpl = PARALLEL_TEMPLATES[tmplKey];
          if (tmpl) {
            const par = tmpl.find(p => p.id === variantId);
            if (par) { if (par.raw) parRaw = par.raw; parallelName = par.name || null; }
          }
        }
      }
      const _baseImgSlug = cardImgFilename(card.set, card.num, card.title, card.type);
      const imgSlug = (variantId && variantId !== 'base') ? `${_baseImgSlug}--${variantId}` : _baseImgSlug;
      if (rawQty > 0) {
        const rawMid = parsePriceMidpoint(parRaw || card.raw);
        if (rawMid != null) { totalValue += rawMid * rawQty; valueCount++; topCandidates.push({card, value: rawMid, graded: false, ownedKey: rowId, variantId, parallelName, imgSlug}); if (rawMid > topValue) { topValue = rawMid; topCard = card; topCardGraded = false; topParallelName = parallelName; topCardImgSlug = imgSlug; } }
      }
      if (psaQty > 0) {
        const psaMid = parsePriceMidpoint(card.psa10);
        if (psaMid != null) { totalValue += psaMid * psaQty; valueCount++; topCandidates.push({card, value: psaMid, graded: true, ownedKey: rowId, variantId, parallelName, imgSlug}); if (psaMid > topValue) { topValue = psaMid; topCard = card; topCardGraded = true; topParallelName = parallelName; topCardImgSlug = imgSlug; } }
      }
    }
  });

  document.getElementById('dashOwnedCount').textContent = ownedCount;
  document.getElementById('dashOwnedPct').textContent = `of ${totalChecklist.toLocaleString()} total`;
  // Progress ring (r=17, circ=106.81)
  (function() {
    const pct = totalChecklist > 0 ? ownedCount / totalChecklist : 0;
    const circ = 106.81;
    const fg = document.getElementById('progRingFg');
    if (fg) fg.style.strokeDasharray = `${(pct * circ).toFixed(2)} ${circ}`;
    const pe = document.getElementById('progRingPct');
    if (pe) pe.textContent = (pct * 100).toFixed(1) + '%';
  })();

  document.getElementById('dashTotalCost').textContent = costCount ? `$${totalCost.toLocaleString(undefined,{maximumFractionDigits:2})}` : '$0';
  document.getElementById('dashCostNote').textContent = 'Based on logged costs';

  document.getElementById('dashTotalValue').textContent = valueCount ? `$${totalValue.toLocaleString(undefined,{maximumFractionDigits:2})}` : '$0';
  document.getElementById('dashValueNote').textContent = 'Midpoint of raw prices';

  const gainCard = document.getElementById('dashGainCard');
  const gainEl = document.getElementById('dashGainLoss');
  const gainPctEl = document.getElementById('dashGainPct');
  if (costCount && valueCount) {
    const gain = totalValue - totalCost;
    const pct = totalCost > 0 ? (gain / totalCost) * 100 : null;
    gainEl.textContent = `${gain >= 0 ? '+' : '−'}$${Math.abs(gain).toLocaleString(undefined,{maximumFractionDigits:2})}`;
    gainPctEl.textContent = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : '—';
    gainCard.classList.toggle('gain-positive', gain >= 0);
    gainCard.classList.toggle('gain-negative', gain < 0);
  } else {
    gainEl.textContent = '$0';
    gainPctEl.textContent = 'Needs cost + value data';
    gainCard.classList.remove('gain-positive', 'gain-negative');
  }

  const topPodiumEl = document.getElementById('dashPodium');
  const topRankedEl = document.getElementById('dashTopRankedList');

  // Build top-10 deduplicated by set+num+variant
  topCandidates.sort((a, b) => b.value - a.value);
  const seen = new Set();
  const top10 = [];
  for (const t of topCandidates) {
    const key = `${t.card.set}|${t.card.num}|${t.variantId || 'base'}`;
    if (!seen.has(key)) { seen.add(key); top10.push(t); }
    if (top10.length >= 10) break;
  }

  // Left side: top-3 podium with decreasing thumbnail sizes
  if (topPodiumEl) {
    const thumbSizes   = [{w:44,h:62}, {w:44,h:62}, {w:44,h:62}];
    const nameSizes    = [11, 11, 11];
    const priceSizes   = [16, 16, 16];
    const podiumColors = ['var(--gold)', 'rgba(255,255,255,0.55)', '#c0a070'];
    const top3         = top10.slice(0, 3);
    const podLabel     = '<div style="text-align:center;margin-bottom:6px;"><div class="hero-cstat-label" style="margin-bottom:0;color:#fff;">Most Valuable Owned</div></div>';
    const podiumRows   = top3.length ? top3.map((t, i) => {
      const {w, h}      = thumbSizes[i];
      const cardLabel   = t.parallelName || t.card.title || 'Untitled';
      const numStr      = t.card.num ? `#${t.card.num}` : '';
      const badgeColor  = t.graded ? 'var(--gold)' : 'rgba(255,255,255,0.55)';
      const badgeBorder = t.graded ? 'var(--gold-border)' : 'rgba(255,255,255,0.2)';
      const badgeLabel  = t.graded ? 'PSA 10' : 'Raw';
      const badge       = `<span style="font-size:9px;font-family:Arial,sans-serif;font-weight:400;padding:0 3px;line-height:14px;border-radius:2px;border:1px solid ${badgeBorder};color:${badgeColor};white-space:nowrap;margin-left:3px;">${badgeLabel}</span>`;
      const thumbSrc    = `images/${t.imgSlug || ''}.jpg`;
      const ebayQ_      = (t.card.ebayQ || '').replace(/'/g, '%27');
      const ebayUrlP    = `/sch/i.html?_nkw=${encodeURIComponent(t.card.ebayQ||'')}&LH_Complete=1&LH_Sold=1&_sop=13`.replace(/'/g,'%27');
      const thumbLblJs  = `${numStr ? numStr+' ' : ''}${cardLabel}`.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const largeUrl    = `images/${t.imgSlug||''}.jpg`;
      const thumbHtml   = `<div onclick="openThumbLightbox('${ebayUrlP}','${thumbLblJs}','${largeUrl}','${t.imgSlug||''}.jpg')" style="width:${w}px;height:${h}px;background:rgba(0,0,0,0.3);border:1px solid var(--gold-border);border-radius:3px;flex:0 0 ${w}px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;" title="Click to view card details"><img src="${thumbSrc}" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" onerror="onThumbError(this,'')"></div>`;
      const setName     = (t.card.set || '').replace(' Baseball', '');
      const divider     = i < top3.length - 1 ? '<div style="height:8px;"></div>' : '';
      return `<div style="display:flex;align-items:center;gap:7px;">${thumbHtml}<div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px;"><div style="flex:1;min-width:0;"><div style="font-family:'Roboto Mono',monospace;font-size:16px;font-weight:700;color:${podiumColors[i]};margin-bottom:2px;">#${i+1}${badge}</div><div style="font-size:${nameSizes[i]}px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;">${numStr ? `<span style="color:var(--gold);">${numStr}</span> ` : ''}${cardLabel}</div><div style="font-size:8px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${setName}</div></div><div style="font-family:'Barlow Condensed',sans-serif;font-size:${priceSizes[i]}px;font-weight:700;color:var(--green);flex:0 0 auto;text-align:right;">$${Math.round(t.value).toLocaleString()}</div></div></div>${divider}`;
    }).join('') : '<div style="font-size:11px;color:var(--text3);">Add some ownership to see this</div>';
    topPodiumEl.innerHTML = podLabel + podiumRows;
  }

  // Right side: #4–10 ranked list
  if (topRankedEl) {
    const listSlice = top10.slice(3);
    topRankedEl.innerHTML = listSlice.length ? listSlice.map((t, idx) => {
      const rank        = idx + 4;
      const cardLabel   = t.parallelName || t.card.title || 'Untitled';
      const numStr      = t.card.num ? `#${t.card.num}` : '';
      const badgeColor  = t.graded ? 'var(--gold)'        : 'rgba(255,255,255,0.55)';
      const badgeBorder = t.graded ? 'var(--gold-border)' : 'rgba(255,255,255,0.2)';
      const badgeLabel  = t.graded ? 'PSA 10' : 'Raw';
      const badge       = `<span style="font-size:9px;font-family:Arial,sans-serif;font-weight:400;padding:0 2px;line-height:1;border-radius:2px;border:1px solid ${badgeBorder};color:${badgeColor};white-space:nowrap;flex:0 0 auto;">${badgeLabel}</span>`;
      const thumbSrc    = `thumbs/${t.imgSlug || ''}.jpg`;
      const thumb       = `<img src="${thumbSrc}" style="width:16px;height:23px;object-fit:cover;border-radius:2px;flex:0 0 16px;border:1px solid rgba(224,184,76,0.18);" onerror="this.style.display='none'" loading="lazy">`;
      const isLast      = idx === listSlice.length - 1;
      return `<div style="display:flex;align-items:center;gap:4px;padding-bottom:2px;margin-bottom:2px;${isLast ? '' : 'border-bottom:1px solid rgba(255,255,255,0.08);'}"><span style="font-family:'Roboto Mono',monospace;font-size:9px;font-weight:700;color:#fff;flex:0 0 18px;text-align:center;">#${rank}</span>${thumb}<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:3px;overflow:hidden;">${numStr ? `<span style="font-family:'Roboto Mono',monospace;font-size:9px;color:var(--gold);font-weight:700;white-space:nowrap;flex:0 0 auto;">${numStr}</span>` : ''}<span style="font-size:9px;color:rgba(255,255,255,0.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cardLabel}</span>${badge}</div><div style="font-size:7.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(t.card.set||'').replace(' Baseball','')}</div></div><div style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:var(--green);flex:0 0 auto;">$${Math.round(t.value).toLocaleString()}</div></div>`;
    }).join('') : '<div style="font-size:11px;color:var(--text3);">—</div>';
    updateValueMedals(top10);
  }
}

function updateValueMedals(topN) {
  document.querySelectorAll('.value-medal').forEach(el => el.remove());
  const medals   = ['🥇', '🥈', '🥉'];
  const ordinals  = ['1st', '2nd', '3rd'];
  topN.slice(0, 3).forEach((t, i) => {
    const dunder    = (t.ownedKey || '').indexOf('__');
    const baseRowId = dunder >= 0 ? t.ownedKey.slice(0, dunder) : (t.ownedKey || '');
    const isParallel = t.variantId && t.variantId !== 'base';
    const tooltip = `${ordinals[i]} most valuable card`;
    const medal = document.createElement('span');
    medal.className   = 'value-medal';
    medal.title       = tooltip;
    medal.textContent = medals[i];

    if (isParallel) {
      // Only place on the parallel's own row (visible when expanded)
      const parRow = document.querySelector(`tr[data-varid="${t.ownedKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
      if (parRow) {
        const parNumCell = parRow.querySelector('.c-num');
        if (parNumCell) {
          medal.style.cssText = 'display:inline;font-size:12px;line-height:1;cursor:default;margin-right:3px;';
          parNumCell.insertBefore(medal, parNumCell.firstChild);
        }
      }
    } else {
      // Base card — place on the base row
      const row = document.getElementById(baseRowId);
      if (!row) return;
      const numCell = row.querySelector('.c-num');
      if (!numCell) return;
      medal.style.cssText = 'display:block;font-size:13px;line-height:1;cursor:default;text-align:center;margin-bottom:4px;';
      const inner = numCell.querySelector('span') || numCell;
      inner.insertBefore(medal, inner.firstChild);
    }
  });
}

// -- Export / Import backup --------------------------------------
function downloadImageMap() {
  const grouped = groupCards(CARDS);
  const rows = [['Filename', 'Year', 'Set', 'Card #', 'Card Name', 'Type', 'Parallel']];
  Object.keys(grouped).sort().forEach(year => {
    const sets = grouped[year];
    Object.keys(sets).forEach(setName => {
      sets[setName].forEach(c => {
        const slug = cardImgFilename(setName, c.num, c.title, c.type);
        rows.push([`${slug}.jpg`, year, setName, c.num || '', c.title || '', c.type || '', c.parallel || '']);
      });
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'skenes-image-map.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function exportMyData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 3,
    ownedData: Object.fromEntries(ownedData),
    userCards,
    userParallels,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `skenes-card-tracker-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importMyData(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('Invalid file');

    const ownedCount = data.ownedData ? Object.keys(data.ownedData).length : 0;
    const cardCount = Array.isArray(data.userCards) ? data.userCards.length : 0;
    const parCount = Array.isArray(data.userParallels) ? data.userParallels.length : 0;
    const ok = confirm(`Import backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date'}?\n\nThis will REPLACE your current data with:\n- ${ownedCount} owned card${ownedCount!==1?'s':''}\n- ${cardCount} custom card${cardCount!==1?'s':''}\n- ${parCount} added parallel${parCount!==1?'s':''}`);
    if (!ok) { event.target.value = ''; return; }

    if (data.ownedData) {
      ownedData = new Map(Object.entries(data.ownedData).map(([k,v]) => [k, typeof v === 'object' && v ? { ...v, qty: v.qty ?? 1 } : { cost: null, dateAdded: null, qty: 1 }]));
      migrateOwnedKeys(); // upgrade any old-format keys
    }
    if (Array.isArray(data.userCards)) userCards = data.userCards;
    if (Array.isArray(data.userParallels)) userParallels = data.userParallels;

    saveOwned();
    buildAll();
    renderAllUserCards();
    updateStatsDashboard();
    alert('Backup imported successfully.');
  } catch (err) {
    alert('Could not import this file. Make sure it\'s a backup exported from this page.');
  } finally {
    event.target.value = '';
  }
}

function updateOwnedCount() {
  const uniqueIds = new Set();
  for (const key of ownedData.keys()) {
    if (key.startsWith('up-')) uniqueIds.add(key);
    else if (key.includes('__')) uniqueIds.add(key.slice(0, key.indexOf('__')));
    else uniqueIds.add(key);
  }
  document.getElementById('ownedCount').textContent = uniqueIds.size;
  const el = document.getElementById('totalEntries');
  if (el) el.textContent = ownedData.size;
}

function toggleSet(id) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : '';
  const tog = document.getElementById('tog-' + id);
  if (tog) tog.textContent = isOpen ? '▶' : '▼';
}

let _filterTimer;
function debouncedFilter() {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(doFilter, 250);
}

function doFilter() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  const yr = document.getElementById('filterYear').value;
  const type = document.getElementById('filterType').value;
  const setFilter = document.getElementById('filterBrand').value.toLowerCase();
  const owned = document.getElementById('filterOwned').value;
  let vis = 0;
  rowMeta.forEach(r => {
    const row = document.getElementById(r.id);
    if (!row) return;
    let show = true;
    if (q && !r.search.includes(q) && !(r.parSearch && r.parSearch.includes(q))) show = false;
    if (yr && r.year !== yr) show = false;
    if (setFilter && r.set !== setFilter) show = false;
    if (type) {
      const t = r.tags;
      if (type === 'base'   && !t.includes('base') && !t.includes('1b')) show = false;
      if (type === 'auto'   && !t.includes('auto')) show = false;
      if (type === 'relic'  && !t.includes('relic')) show = false;
      if (type === 'insert' && !t.includes('insert') && !t.includes('now')) show = false;
      if (type === 'now'    && !t.includes('now')) show = false;
      if (type === 'rc'     && !t.includes('rc')) show = false;
      if (type === '1b'     && !t.includes('1b')) show = false;
      if (type === 'ssp'    && !t.includes('ssp')) show = false;
    }
    if (owned === 'owned'   && !ownedSet.has(r.id)) show = false;
    if (owned === 'unowned' &&  ownedSet.has(r.id)) show = false;
    row.classList.toggle('hidden-row', !show);
    if (show) vis++;
  });
  let visParCount = 0;
  const ownedMode = owned === 'owned';
  const affectedParents = new Set();

  if (ownedMode) {
    // Owned mode: hide all par-tmpl-rows first, then reveal only the ones in ownedData
    document.querySelectorAll('.par-tmpl-row').forEach(tr => {
      tr.style.display = 'none';
      tr.removeAttribute('data-auto-expanded');
    });
    // Walk ownedData keys — any key with a non-base variantId is an owned parallel
    for (const [key] of ownedData.entries()) {
      const dunder = key.indexOf('__');
      if (dunder < 0) continue;
      const variantId = key.slice(dunder + 2);
      if (variantId === 'base') continue;
      // Find the par-tmpl-row that carries this varid
      const safeVal = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const parRow  = document.querySelector(`.par-tmpl-row[data-varid="${safeVal}"]`);
      if (!parRow) continue;
      const parentId  = parRow.dataset.parent;
      const parentRow = parentId ? document.getElementById(parentId) : null;
      if (parentRow && parentRow.classList.contains('hidden-row')) continue;
      parRow.style.display = 'table-row';
      parRow.dataset.autoExpanded = '1';
      if (parentId) affectedParents.add(parentId);
      visParCount++;
    }
  } else {
    // Normal mode: hide filtered-out rows; auto-expand only the parallel rows that match the search query
    document.querySelectorAll('.par-tmpl-row').forEach(tr => {
      const parentId  = tr.dataset.parent;
      const parentRow = parentId ? document.getElementById(parentId) : null;
      const parentHidden = parentRow && parentRow.classList.contains('hidden-row');
      if (parentHidden) {
        // Parent filtered out — hide
        tr.style.display = 'none';
        tr.removeAttribute('data-auto-expanded');
        if (parentId) affectedParents.add(parentId);
      } else if (q && tr.dataset.parName && tr.dataset.parName.includes(q)) {
        // This parallel's name matches the search — show it directly
        if (tr.style.display === 'none') {
          tr.style.display = 'table-row';
          tr.dataset.autoExpanded = 'search';
          if (parentId) affectedParents.add(parentId);
        }
        visParCount++;
      } else if (tr.dataset.autoExpanded === 'search' && !q) {
        // Search cleared — collapse rows that were search-auto-expanded
        tr.style.display = 'none';
        tr.removeAttribute('data-auto-expanded');
        if (parentId) affectedParents.add(parentId);
      } else if (tr.dataset.autoExpanded && tr.dataset.autoExpanded !== 'search') {
        // Was auto-expanded by owned mode — collapse back
        tr.style.display = 'none';
        tr.removeAttribute('data-auto-expanded');
        if (parentId) affectedParents.add(parentId);
      } else if (tr.style.display !== 'none') {
        visParCount++;
      }
    });
  }

  // Sync toggle-button text for parents whose parallel visibility changed
  affectedParents.forEach(parentId => {
    const parentRow = document.getElementById(parentId);
    if (!parentRow) return;
    const btn = parentRow.querySelector('.par-toggle-btn');
    if (!btn) return;
    const parRows = document.querySelectorAll(`.par-tmpl-row[data-parent="${parentId.replace(/"/g, '\\"')}"]`);
    const anyOpen = Array.from(parRows).some(r => r.style.display !== 'none');
    const count   = parRows.length;
    btn.textContent = `${anyOpen ? '▼' : '▶'} ${count} Parallel${count !== 1 ? 's' : ''}`;
    anyOpen ? btn.classList.add('open') : btn.classList.remove('open');
  });

  document.getElementById('visCount').textContent = vis + visParCount;

  // Hide entire set-section containers when all their rows are filtered out
  document.querySelectorAll('.set-section').forEach(sec => {
    const rows = sec.querySelectorAll('tbody tr:not(.par-tmpl-row)');
    const anyVisible = Array.from(rows).some(tr => !tr.classList.contains('hidden-row'));
    sec.style.display = anyVisible ? '' : 'none';
  });
}

function doSort() {
  const mode = document.getElementById('sortBy').value;
  document.querySelectorAll('.set-section tbody').forEach(tbody => {
    const allRows = Array.from(tbody.children);
    const groups = [];
    let current = null;
    allRows.forEach(tr => {
      if (tr.classList.contains('par-row-extra') || tr.classList.contains('par-tmpl-row')) {
        if (current) current.children.push(tr);
      } else {
        current = { anchor: tr, children: [] };
        groups.push(current);
      }
    });
    if (mode === 'default') {
      groups.sort((a, b) => {
        const ai = a.anchor.dataset.origIndex, bi = b.anchor.dataset.origIndex;
        if (ai !== undefined && bi !== undefined) return Number(ai) - Number(bi);
        return 0;
      });
    } else {
      groups.forEach(g => {
        const card = findCardByRowId(g.anchor.id);
        g._value = card ? (parsePriceMidpoint(card.raw) ?? -1) : -1;
        g._owned = ownedData.has(g.anchor.id) ? 1 : 0;
        g._num = (card && card.num != null) ? String(card.num) : (g.anchor.querySelector('.c-num')?.textContent || '');
      });
      if (mode === 'value-desc') groups.sort((a, b) => b._value - a._value);
      else if (mode === 'value-asc') groups.sort((a, b) => a._value - b._value);
      else if (mode === 'owned-first') groups.sort((a, b) => b._owned - a._owned);
      else if (mode === 'num-asc') groups.sort((a, b) => a._num.localeCompare(b._num, undefined, { numeric: true }));
    }
    groups.forEach((g, i) => {
      if (g.anchor.dataset.origIndex === undefined) g.anchor.dataset.origIndex = i;
    });
    groups.forEach(g => {
      tbody.appendChild(g.anchor);
      g.children.forEach(c => tbody.appendChild(c));
    });
  });
}

// ── User-added parallels (localStorage) ─────────────────────
const PAR_KEY = 'user_added_parallels_v1';
let userParallels = [];

function loadUserParallels() {
  try {
    const v = localStorage.getItem(PAR_KEY);
    userParallels = v ? JSON.parse(v) : [];
  } catch { userParallels = []; }
}
function saveUserParallels() {
  try { localStorage.setItem(PAR_KEY, JSON.stringify(userParallels)); } catch {}
}

function renderParallelRowsFor(baseRowId) {
  if (!userParallels || !userParallels.length) return '';
  const mine = userParallels.filter(p => p.baseRowId === baseRowId);
  if (!mine.length) return '';
  return mine.map(p => {
    const isOwned = ownedData.has(p.id);
    const ownedCls = isOwned ? ' owned-row' : '';
    const parDisplay = [p.color, p.numbered && p.numbered !== 'Unnumbered' ? p.numbered : ''].filter(Boolean).join(' ');
    return `<tr id="${p.id}" class="par-row-extra${ownedCls}">
      <td class="own-cell"><input type="checkbox" class="own-cb" ${isOwned?'checked':''} onchange="toggleOwn(this,'${p.id}')"></td>
      <td class="thumb-cell"></td>
      <td class="c-num">${p.num||''}</td>
      <td><div class="c-card-title">${p.title||''}</div><div class="c-card-sub">User Parallel <span style="color:var(--gold2);font-size:9px;margin-left:4px">\u2746 ADDED</span></div></td>
      <td></td>
      <td class="c-par"><span class="par-tag">${parDisplay||'\u2014'}</span></td>
      <td></td><td class="c-qty-cell"></td>
      <td class="c-cost-cell"></td>
      <td class="c-val-cell">${mkValueCellContents(p.raw||'', '', p.priceFlag)}</td>
      <td class="c-notes">${p.notes||''}</td>
    </tr>`;
  }).join('');
}

// ── User-added cards (localStorage) ─────────────────────────
const UA_KEY = 'user_added_cards_v1';
let userCards = [];

function loadUserCards() {
  try {
    const v = localStorage.getItem(UA_KEY);
    return v ? JSON.parse(v) : [];
  } catch { return []; }
}
function saveUserCards(arr) {
  try { localStorage.setItem(UA_KEY, JSON.stringify(arr)); } catch {}
}

function autoTag(title, parallel, setName) {
  const hay = (title + ' ' + parallel + ' ' + setName).toLowerCase();
  const tags = [];
  if (/1st bowman|bowman draft|bdc-|bd-/.test(hay)) tags.push('1b');
  if (/rookie card|\brc\b|rookie debut|update series|topps update|series [12]|heritage|allen.*ginter|stadium club|archives|triple threads|tribute|museum/.test(hay)) tags.push('rc');
  if (/auto|autograph|signed/.test(hay)) tags.push('auto');
  if (/relic|patch|jersey|stitches|logoman|memorabil/.test(hay)) tags.push('relic');
  if (/ssp|short print|variation|image var|golden mirror|error/.test(hay)) tags.push('ssp');
  if (/insert|top of the game|stars in the night|all.star.*insert|1989|gpk|garbage pail/.test(hay)) tags.push('insert');
  if (/topps now/.test(hay)) tags.push('now');
  if (!tags.includes('auto') && !tags.includes('relic') && !tags.includes('insert') && !tags.includes('now') && !tags.includes('ssp')) tags.push('base');
  return [...new Set(tags)];
}

function detectBrand(setName) {
  const s = (setName || '').toLowerCase();
  if (/bowman draft/.test(s)) return 'bowman draft';
  if (/bowman chrome|chrome.*bowman/.test(s)) return 'bowman chrome';
  if (/bowman/.test(s)) return 'bowman chrome';
  if (/topps now/.test(s)) return 'topps now';
  if (/topps chrome update|chrome update/.test(s)) return 'topps chrome update';
  if (/topps chrome|chrome/.test(s)) return 'topps chrome';
  if (/topps update|update series/.test(s)) return 'topps update';
  if (/series 1|series 2|topps series/.test(s)) return 'topps series';
  if (/heritage/.test(s)) return 'topps heritage';
  if (/allen.*ginter|ginter/.test(s)) return 'allen & ginter';
  if (/stadium club/.test(s)) return 'stadium club';
  if (/archives/.test(s)) return 'archives';
  return 'topps';
}

function renderUserRow(c, idx) {
  const rowId = `ua-${idx}`;
  const tags = c.tags || [];
  const isOwned = ownedData.has(rowId);
  const ownedCls = isOwned ? ' owned-row' : '';
  const thumb = mkThumb({ ebayQ: `Paul Skenes ${c.setName} ${c.cardNum} ${c.parallel}`, title: c.title });
  rowMeta = rowMeta.filter(r => r.id !== rowId);
  rowMeta.push({ id: rowId, year: String(c.year), set: (c.setName||'').toLowerCase(), tags, search: [c.year, c.setName, c.cardNum, c.title, c.parallel, tags.join(' ')].join(' ').toLowerCase() });
  return `<tr id="${rowId}" class="user-added-row${ownedCls}">
    <td class="own-cell"><input type="checkbox" class="own-cb" ${isOwned?'checked':''} onchange="toggleOwn(this,'${rowId}')"></td>
    <td class="thumb-cell">${thumb}</td>
    <td class="c-num">${c.cardNum || '\u2014'}</td>
    <td><div class="c-card-title">${displayTitle(c.title || c.setName)}</div><div class="c-card-sub">${c.type || 'User Added'} <span style="color:var(--gold2);font-size:9px;margin-left:4px">\u2746 CUSTOM</span></div></td>
    <td>${mkTags(tags)}</td>
    <td class="c-par"><span class="c-par-text">${c.parallel || '\u2014'}</span></td>
    <td></td>
    <td class="c-qty-cell"></td>
    <td class="c-cost-cell"></td>
    <td class="c-val-cell">${mkValueCellContents(c.raw||'', c.psa10||'', c.priceFlag)}</td>
    <td class="c-notes">${c.notes||''}</td>
  </tr>`;
}

function renderAllUserCards() {
  document.querySelectorAll('tr.user-added-row').forEach(r => r.remove());
  rowMeta = rowMeta.filter(r => !r.id.startsWith('ua-'));
  userCards.forEach((c, idx) => {
    const brand = detectBrand(c.setName);
    const section = findOrCreateSection(c.year, brand, c.setName);
    const tbody = section.querySelector('tbody');
    if (tbody) {
      tbody.insertAdjacentHTML('beforeend', renderUserRow(c, idx));
      updateSectionBadge(section);
    }
  });
  updateOwnedCount();
  const tmplParCount = document.querySelectorAll('.par-tmpl-row').length;
  const total = rowMeta.length + tmplParCount;
  const totEl = document.getElementById('totCount');
  const tot2El = document.getElementById('totCount2');
  if (totEl) totEl.textContent = total;
  if (tot2El) tot2El.textContent = total;
}

function findOrCreateSection(year, brand, setName) {
  let found = null;
  document.querySelectorAll('.set-section').forEach(sec => {
    const nameEl = sec.querySelector('.set-name');
    const yearEl = sec.querySelector('.set-year');
    if (nameEl && yearEl && yearEl.textContent.trim() === String(year) && nameEl.textContent.trim() === setName) {
      found = sec;
    }
  });
  if (found) return found;
  const domId = `ua-sec-${year}-${Date.now()}`;
  const secHtml = `<div class="set-section" data-year="${year}" data-brand="${brand}">
    <div class="set-header" onclick="toggleSet('${domId}')">
      <span class="set-year">${year}</span>
      <span class="set-name">${setName}</span>
      <span class="set-badge ua-badge">0 cards</span>
      <span class="set-toggle" id="tog-${domId}">\u25bc</span>
    </div>
    <div class="tbl-wrap" id="${domId}">
      <table><thead><tr>
        <th class="th-own">Own</th><th class="th-img">View</th>
        <th style="width:80px">Card #</th><th style="min-width:170px">Card</th>
        <th style="width:88px">Tags</th><th style="min-width:170px">Parallel</th>
        <th></th><th>Qty</th><th>Cost</th><th>Value</th><th>Notes</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </div>`;
  const main = document.getElementById('mainContent');
  if (main) main.insertAdjacentHTML('beforeend', secHtml);
  return main ? main.lastElementChild : document.body;
}

function updateSectionBadge(section) {
  const badge = section.querySelector('.set-badge');
  if (!badge) return;
  const count = section.querySelectorAll('tbody tr:not(.par-tmpl-row)').length;
  badge.textContent = `${count} card${count!==1?'s':''}`;
}

function updateSectionOwnedBadge(section) {
  const badge = section.querySelector('.set-owned-badge');
  if (!badge) return;
  const count = section.querySelectorAll('.own-cb:checked').length;
  badge.textContent = `${count} owned`;
}

function initUserCards() {
  userCards = loadUserCards();
  renderAllUserCards();
}

function ensureLightbox() { /* lightbox is in HTML */ }

/* openAddCard / closeAddCard / previewTags — disabled; code preserved in _archive/add-card-functions.js */

function deleteUserCard(idx) {
  if (!confirm('Remove this card from your custom list?')) return;
  ownedData.delete(`ua-${idx}`);
  saveOwned();
  userCards.splice(idx, 1);
  saveUserCards(userCards);
  renderAllUserCards();
  doFilter();
}

/* submitAddCard — disabled; code preserved in _archive/add-card-functions.js */


// ============================================================
//  GRID VIEW
// ============================================================

// Map a parallel name to a representative color hex for left-border accents
function getParallelColor(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('superfractor'))                             return '#c9a23a';
  if (n.includes('padparadscha'))                            return '#e91e8c';
  if (n.includes('burgundy'))                                return '#8b1a3a';
  if (n.includes('navy'))                                    return '#1a3a8b';
  if (n.includes('rose gold'))                                         return '#c9878e';
  if (n.includes('gold') || n.includes('yellow'))            return '#f1c40f';
  if (n.includes('red') || n.includes('scarlet') || n.includes('ruby') || n.includes('flare') || n.includes('crimson')) return '#e74c3c';
  if (n.includes('orange') || n.includes('galactic'))        return '#e67e22';
  if (n.includes('polka') && n.includes('blue'))                       return '#5588ff';
  if (n.includes('fuchsia') || n.includes('pink') || n.includes('magenta') || n.includes('rose')) return '#e91e8c';
  if (n.includes('light purple'))                                            return '#c8a4e8';
  if (n.includes('purple') || n.includes('violet') || n.includes('nebula') || n.includes('indigo') || n.includes('amethyst')) return '#9b59b6';
  if (n.includes('black') && n.includes('sapphire'))              return '#333';
  if (n.includes('green') && n.includes('sapphire'))              return '#27ae60';
  if (n.includes('sapphire'))                                      return '#1a6fd4';
  if (n.includes('light blue'))                                      return '#87ceeb';
  if (n.includes('aqua'))                                            return '#00bcd4';
  if (n.includes('blue') || n.includes('sky') || n.includes('teal') || n.includes('moon') || n.includes('cyan') || n.includes('raywave')) return '#3498db';
  if (n.includes('green') || n.includes('emerald') || n.includes('lime') || n.includes('forest')) return '#27ae60';
  if (n.includes('black') || n.includes('eclipse') || n.includes('onyx') || n.includes('midnight')) return '#888';
  if (n.includes('platinum') || n.includes('pearl') || n.includes('white') || n.includes('silver') || n.includes('prismatic')) return '#bbb';
  // Named variants that contain 'refractor' must come BEFORE the generic refractor catch-all
  if (n.includes('lunar glow') || n.includes('lunar'))               return '#1abc9c';
  if (n.includes('japan'))                                            return '#bc002d';
  if (n.includes('wave') || n.includes('pulsar') || n.includes('mojo') || n.includes('refractor')) return '#aaa';
  // Metals & materials
  if (n.includes('bronze'))                                       return '#cd7f32';
  if (n.includes('copper'))                                       return '#b87333';
  if (n.includes('wood'))                                         return '#8b4513';
  if (n.includes('metal') || n.includes('metallic'))             return '#9e9e9e';
  if (n.includes('chrome'))                                       return '#555555';
  // Colors
  if (n.includes('turquoise'))                                    return '#40e0d0';
  if (n.includes('chartreuse'))                                   return '#7ec850';
  if (n.includes('cherry blossom'))                               return '#f472b6';
  if (n.includes('sepia'))                                        return '#8b6331';
  if (n === 'b&w' || n.includes('grayscale'))                    return '#666666';
  // Rainbow / chromatic
  if (n.includes('foilfractor'))                              return '#c9a23a';
  if (n.includes('x-fractor') || n.includes('cupfractor') ||
      n.includes('rainbow foil') || n.includes('rainbow foilboard') ||
      n.includes('holo foil') || n.includes('holographic') ||
      n.includes('stained glass') || n.includes('confetti') || n.includes('diamante'))
                                                                  return '#8b5cf6';
  // Icy/frozen
  if (n.includes('frozenfractor') || n.includes('frozen fractor')) return '#7cc8f0';
  // Nature / seasonal
  if (n.includes('cherry blossom'))                               return '#f472b6';
  if (n.includes('sandglitter'))                                  return '#c2a45e';
  if (n.includes('glitter'))                                      return '#e8b000';
  if (n.includes('camo'))                                         return '#556b2f';
  if (n.includes('ghost'))                                        return '#aaaaaa';
  if (n.includes('amber'))                                        return '#e8900a';
  // Special branded
  if (n.includes('stocking stuffer'))                             return '#e74c3c';
  if (n.includes('jack o') || n.includes('lantern'))             return '#f97316';
  if (n.includes('canvas'))                                       return '#c8882a';
  if (n.includes('lightboard'))                                   return '#ffe600';
  if (n.includes('independence day'))                             return '#cc2936';
  if (n === 'team color')                                         return '#1a1a1a';
  if (n.includes('canary'))                                       return '#f5e040';
  return '#777';
}

// Returns a CSS background value (gradient or solid hex) for the --par-stripe custom property
function getParBorderGradient(name) {
  const n = (name || '').toLowerCase();
  if (n === 'diamond') return '#ccc';
  if (n === 'refractor' || n === 'x-fractor' || n === 'holo foilboard' ||
      n === 'rainbow foilboard' || n === 'foilboard')
    return 'linear-gradient(to bottom,#f43,#fc0,#0f0,#08f,#a0f)';
  if (n.includes('oil spill'))
    return 'linear-gradient(to bottom,#080820,#1a3a80,#080820)';
  if (n === 'checkerboard refractor')
    return 'repeating-linear-gradient(to bottom,#1a1a1a 0px,#1a1a1a 4px,#d0d0d0 4px,#d0d0d0 8px)';
  if (n.includes('independence day'))
    return 'repeating-linear-gradient(to bottom,#cc2936 0px,#cc2936 8px,#fff 8px,#fff 16px,#002868 16px,#002868 24px)';
  if (n.includes('japan'))
    return 'linear-gradient(to bottom,#fff 0%,#fff 35%,#bc002d 35%,#bc002d 65%,#fff 65%,#fff 100%)';
  if (n.includes('frozenfractor') || n.includes('frozen fractor'))
    return 'linear-gradient(to bottom,#7cc8f0,#b8e8ff,#7cc8f0)';
  if (n.includes('foilfractor') || n.includes('superfractor'))
    return 'linear-gradient(to bottom,#f5c518,#fffbe0,#f5c518,#fffbe0,#f5c518)';
  if ((n.includes('black') && !n.includes('sapphire')) || n.includes('eclipse') || n.includes('onyx') || n.includes('midnight'))
    return 'linear-gradient(to bottom,#1a1a1a,#3a3a3a,#1a1a1a)';
  if (n.includes('red/white/blue') || n.includes('red, white'))
    return 'linear-gradient(to bottom,#cc2936 0%,#cc2936 33%,#f0f0f0 33%,#f0f0f0 66%,#002868 66%,#002868 100%)';
  if (n.includes('baseball seams'))
    return 'repeating-linear-gradient(to bottom,#f5f0e8 0px,#f5f0e8 5px,#cc2936 5px,#cc2936 8px)';
  if (n.includes('gradient')) {
    const m = name.match(/^([^/]+)\/([^/]+?)\s*gradient/i);
    if (m) {
      const c1 = getParallelColor(m[1].trim());
      const c2 = getParallelColor(m[2].trim());
      return `linear-gradient(to bottom,${c1},${c2})`;
    }
  }
  // Two-tone slash parallels (e.g. "Blue/Gold", "Rose Gold/Gold")
  if (n.includes('/') && !n.includes('red/white') && !n.includes('gradient')) {
    const _bparts = name.split('/');
    if (_bparts.length === 2) {
      const _bc1 = getParallelColor(_bparts[0].trim());
      const _bc2 = getParallelColor(_bparts[1].trim());
      return `linear-gradient(to bottom,${_bc1},${_bc2},${_bc1})`;
    }
  }
  return getParallelColor(name) || 'rgba(232,176,0,0.7)';
}

function mkPrintRunPill(pr, parallelName, customStyle) {
  if (!pr) return '';
  if (customStyle) {
    return `<span style="display:inline-block;font-family:'Roboto Mono',monospace;font-size:10px;font-weight:600;padding:1px 7px;border-radius:20px;background:${customStyle.bg};color:${customStyle.color};border:1px solid ${customStyle.color};white-space:nowrap;">${pr}</span>`;
  }
  const n = (parallelName || '').toLowerCase();
  // Special: Independence Day — split red/blue pill
  if (n.includes('independence day')) {
    return `<span style="display:inline-block;font-family:'Roboto Mono',monospace;font-size:10px;font-weight:600;padding:1px 7px;border-radius:20px;background:linear-gradient(to right,#cc2936 50%,#002868 50%);color:#fff;border:1px solid #444;white-space:nowrap;">${pr}</span>`;
  }
  const col = getParallelColor(parallelName || '');
  let hex = col.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  return `<span style="display:inline-block;font-family:'Roboto Mono',monospace;font-size:10px;font-weight:600;padding:1px 7px;border-radius:20px;background:rgba(${r},${g},${b},0.15);color:${col};border:1px solid rgba(${r},${g},${b},0.3);white-space:nowrap;">${pr}</span>`;
}


// Returns an inline style string for parallel name text.
// Handles gradient parallels (e.g. "Aqua/Pink Gradient") with CSS gradient text.
const RAINBOW_GRADIENT = `background:linear-gradient(to right,#e74c3c,#e67e22,#f1c40f,#27ae60,#3498db,#9b59b6,#e74c3c,#e67e22);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:mojo-sweep 4s linear infinite;font-weight:600;`;
const ICY_GRADIENT = `background:linear-gradient(to right,#a8d8f0,#b8dff0,#c8e8ff,#b8dff0,#90c8e8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #7ab8d8;font-weight:600;`;

const AUTO_SCRIPT = ``; // Set font style here when a script font is chosen
function formatParallelName(name) {
  if (!name) return '';
  if (!AUTO_SCRIPT) return name;
  return name.replace(/\b(auto(?:graph)?)\b/gi, `<span style="${AUTO_SCRIPT}">$1</span>`);
}

function lavaGradientStyle(name) {
  let hex = getParallelColor(name).replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  const dark  = `rgb(${Math.round(r*.45)},${Math.round(g*.45)},${Math.round(b*.45)})`;
  const base  = `rgb(${r},${g},${b})`;
  const light = `rgb(${Math.round(r+(255-r)*.55)},${Math.round(g+(255-g)*.55)},${Math.round(b+(255-b)*.55)})`;
  return `background:linear-gradient(45deg,${dark},${base},${light},${base},${dark});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px ${dark};font-weight:600;`;
}

function _parallelStyleRaw(name) {
  const n = (name || '').toLowerCase().trim();
  // Rainbow prismatic for solo named types only
  if (n === 'refractor' || n === 'holo foilboard' ||
      n === 'rainbow foilboard' || n === 'foilboard') return RAINBOW_GRADIENT;
  if (n.includes('oil spill')) return `color:#001a66;animation:oil-pulse 3.5s ease-in-out infinite;font-weight:600;`;
  if (n === 'checkerboard refractor') return `background:repeating-linear-gradient(135deg,#1a1a1a 0px,#1a1a1a 6px,#d0d0d0 6px,#d0d0d0 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #333;font-weight:600;`;
  if (n.includes('purple') && n.includes('checkerboard')) return `background:repeating-linear-gradient(135deg,#4a0a7a 0px,#4a0a7a 6px,#d0aaf0 6px,#d0aaf0 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #380860;font-weight:600;`;
  if (n.includes('blue') && n.includes('checkerboard')) return `background:repeating-linear-gradient(135deg,#0a2870 0px,#0a2870 6px,#90c0f0 6px,#90c0f0 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #081a50;font-weight:600;`;
  if (n.includes('pearl') && n.includes('checkerboard')) return `background:repeating-linear-gradient(135deg,#8888a8 0px,#8888a8 6px,#eeeefc 6px,#eeeefc 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #666680;font-weight:600;`;
  if (n === 'x-fractor') return `background:repeating-linear-gradient(135deg,#2e2e2e 0px,#2e2e2e 6px,#c8c8c8 6px,#c8c8c8 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #222;font-weight:600;`;
  if (n.includes('x-fractor')) {
    let _xhex = getParallelColor(name).replace('#','');
    if (_xhex.length===3) _xhex=_xhex[0]+_xhex[0]+_xhex[1]+_xhex[1]+_xhex[2]+_xhex[2];
    const _xr=parseInt(_xhex.slice(0,2),16),_xg=parseInt(_xhex.slice(2,4),16),_xb=parseInt(_xhex.slice(4,6),16);
    const _xdark=`rgb(${Math.round(_xr*.45)},${Math.round(_xg*.45)},${Math.round(_xb*.45)})`;
    const _xIsNeon = ['blue','green','orange','red'].some(c => n.includes(c));
    const _xlight = _xIsNeon
      ? `rgb(${Math.min(255,Math.round(_xr*1.5))},${Math.min(255,Math.round(_xg*1.5))},${Math.min(255,Math.round(_xb*1.5))})`
      : `rgb(${Math.round(_xr+(255-_xr)*.55)},${Math.round(_xg+(255-_xg)*.55)},${Math.round(_xb+(255-_xb)*.55)})`;
    return `background:repeating-linear-gradient(135deg,${_xdark} 0px,${_xdark} 6px,${_xlight} 6px,${_xlight} 12px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px ${_xdark};font-weight:600;`;
  }
  // Icy white/blue for Frozenfractors
  if (n.includes('frozenfractor')) return ICY_GRADIENT;
  // Japan flag: white on both ends, red in the center
  if (n.includes('independence day')) return `background:repeating-linear-gradient(to right,#cc2936 0px,#cc2936 20px,#fff 20px,#fff 40px,#002868 40px,#002868 60px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.5px #000;font-weight:600;letter-spacing:0.03em;animation:ind-sweep 6s linear infinite;`;
  if (n.includes('memorial day')) return `background:radial-gradient(ellipse 18px 10px at 8% 30%,#1a2a0a 99%,transparent 100%),radial-gradient(ellipse 14px 8px at 35% 10%,#6b4c1a 99%,transparent 100%),radial-gradient(ellipse 12px 9px at 62% 70%,#2d3d12 99%,transparent 100%),radial-gradient(ellipse 16px 7px at 80% 20%,#7a5c30 99%,transparent 100%),radial-gradient(ellipse 20px 8px at 50% 85%,#1a2a0a 99%,transparent 100%),radial-gradient(ellipse 10px 10px at 25% 55%,#6b4c1a 99%,transparent 100%),linear-gradient(#556b2f,#4a5c20);background-size:120px 20px;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:camo-pulse 4s ease-in-out infinite;`;
  if (n === 'team color') return `background:linear-gradient(to right,#111 0%,#111 50%,#e8b000 50%,#e8b000 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.5px #888;font-weight:600;letter-spacing:0.03em;`;
  if (n.includes('japan')) return `background:linear-gradient(to right,#fff 0%,#fff 24%,#bc002d 24%,#bc002d 76%,#fff 76%,#fff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.5px #000;font-weight:600;letter-spacing:0.03em;`;
  if (n.includes('rose gold') && n.includes('lava')) return `background:linear-gradient(to bottom,#7a2030,#c9878e,#f4b8c5,#c9878e,#7a2030);background-size:100% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #5c1020;font-weight:700;animation:lavalamp-flow 3s ease-in-out infinite;`;
  if (n.includes('red') && n.includes('lava')) return `background:linear-gradient(to bottom,#5c0800,#cc1100,#ff3300,#cc1100,#5c0800);background-size:100% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #440600;font-weight:700;animation:lavalamp-flow 3s ease-in-out infinite;`;
  if (n.includes('lava')) {
    let _lhex = getParallelColor(name).replace('#','');
    if (_lhex.length===3) _lhex=_lhex[0]+_lhex[0]+_lhex[1]+_lhex[1]+_lhex[2]+_lhex[2];
    const _lr=parseInt(_lhex.slice(0,2),16),_lg=parseInt(_lhex.slice(2,4),16),_lb=parseInt(_lhex.slice(4,6),16);
    const _ldark=`rgb(${Math.round(_lr*.45)},${Math.round(_lg*.45)},${Math.round(_lb*.45)})`;
    const _lbase=`rgb(${_lr},${_lg},${_lb})`;
    const _llight=`rgb(${Math.round(_lr+(255-_lr)*.55)},${Math.round(_lg+(255-_lg)*.55)},${Math.round(_lb+(255-_lb)*.55)})`;
    return `background:linear-gradient(to bottom,${_ldark},${_lbase},${_llight},${_lbase},${_ldark});background-size:100% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px ${_ldark};font-weight:700;animation:lavalamp-flow 3s ease-in-out infinite;`;
  }
  if (n.includes('superfractor') || n.includes('foilfractor')) return `color:#f0c000;animation:gold-glow-pulse 2s ease-in-out infinite;font-weight:700;`;
  if (n.includes('sapphire') && getParallelColor(name) !== '#1a6fd4') {
    const _ss = lavaGradientStyle(name).replace('-webkit-background-clip:', 'background-size:200% 200%;-webkit-background-clip:');
    return _ss + 'animation:sparkle-twinkle 3s ease-in-out infinite;';
  }
  if (n.includes('sapphire')) return `background:linear-gradient(45deg,#0a2a6e,#1a6fd4,#6aacf0,#1a6fd4,#0a2a6e);background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:sparkle-twinkle 3s ease-in-out infinite;-webkit-text-stroke:0.4px #0a2a6e;font-weight:600;`;
  if (n.includes('yellow') && n.includes('lunar')) return `background:linear-gradient(45deg,#4a6e00,#9ac800,#dcff60,#9ac800,#4a6e00);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #3a5600;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if ((n.includes('fuchsia') || n.includes('magenta')) && n.includes('lunar')) return `background:linear-gradient(45deg,#7a0050,#d4178a,#ff80cc,#d4178a,#7a0050);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #600040;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('lunar')) return `background:linear-gradient(45deg,#0a5a50,#1abc9c,#ccfff8,#1abc9c,#0a5a50);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #0a5a50;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n === 'sparkle refractor' || n === 'sparkle foil') return `background:radial-gradient(circle,#f0c000 32%,transparent 32%) 0px 0px,radial-gradient(circle,#e63000 32%,transparent 32%) 3px 5px,radial-gradient(circle,#2266cc 32%,transparent 32%) 7px 2px,radial-gradient(circle,#22aa33 32%,transparent 32%) 10px 8px,radial-gradient(circle,#ff8800 32%,transparent 32%) 14px 3px,radial-gradient(circle,#ff3366 32%,transparent 32%) 2px 11px,radial-gradient(circle,#ffdd00 32%,transparent 32%) 11px 13px,radial-gradient(circle,#cc22ff 32%,transparent 32%) 17px 7px,radial-gradient(circle,#00aaff 32%,transparent 32%) 5px 9px,radial-gradient(circle,#ff6600 32%,transparent 32%) 13px 1px,linear-gradient(135deg,#999,#ccc,#eee,#ddd,#aaa);background-size:20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,20px 16px,100% 100%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;animation:sparkle-shift 3s linear infinite;`;
  if (n.includes('light blue sparkle'))  return `background:linear-gradient(120deg,#d0edff,#87ceeb,#eaf6ff,#6ab8e8,#c0e4ff);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('blue sparkle'))        return `background:linear-gradient(120deg,#5aabff,#1565c0,#82c3ff,#2196f3,#5aabff);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('pink sparkle'))        return `background:linear-gradient(120deg,#ffb6c1,#ff1493,#ffccd5,#ff69b4,#ffb6c1);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('silver sparkle'))      return `background:linear-gradient(120deg,#f0f0f0,#a8a8a8,#ffffff,#c8c8c8,#e8e8e8);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('burgundy sparkle'))    return `background:linear-gradient(120deg,#c04060,#6a1020,#d06080,#8b1a3a,#c04060);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('aqua sparkle'))        return `background:linear-gradient(120deg,#40e8e8,#007f7f,#80ffff,#00b4b4,#40e8e8);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('green sparkle'))       return `background:linear-gradient(120deg,#80e880,#1b5e20,#a8f0a8,#2e7d32,#80e880);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n.includes('sparkle'))             return `background:linear-gradient(120deg,#f0f0f0,#a8a8a8,#ffffff,#c0c0c0,#e8e8e8);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
  if (n === 'diamond') return `background:linear-gradient(135deg,#888,#ddd,#fff,#ccc,#999,#eee,#aaa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #666;font-weight:600;`;
  if (n.includes('pearl')) return `background:linear-gradient(90deg,#b0a0c0 0%,#b8b8c8 30%,#f0eef8 50%,#b8b8c8 70%,#b0a0c0 100%);background-size:300% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:shimmer 3.5s linear infinite;-webkit-text-stroke:0.4px #9090a0;font-weight:600;`;
  if (n.includes('polka')) {
    const isGP = n.includes('green') || n.includes('pink');
    const dotC = isGP ? '#228833' : '#cc66ff';
    const bgC  = isGP ? '#ff88cc' : '#5588ff';
    return `background:radial-gradient(circle,${dotC} 38%,transparent 38%) 0 0,radial-gradient(circle,${dotC} 38%,transparent 38%) 6px 6px,linear-gradient(${bgC},${bgC});background-size:12px 12px,12px 12px,100% 100%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0px;font-weight:700;animation:polka-bounce 1.8s ease-in-out infinite;`;
  }
  if (n.includes('chrome') && !n.includes('refractor')) return `background:linear-gradient(to right,#555,#aaa,#555);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;`;
  if (n.includes('hta choice')) return `background:linear-gradient(55deg,#ff0080,#ff6600,#ffcc00,#00cc88,#0088ff,#cc00ff,#ff0080,#ff6600);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:mojo-sweep 3s linear infinite;font-weight:700;`;
  if (n === 'mojo') return `background:linear-gradient(55deg,#ff0080,#ff6600,#ffcc00,#00cc88,#0088ff,#cc00ff,#ff0080,#ff6600);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:mojo-sweep 3s linear infinite;font-weight:700;`;
  // other mojos (colored): fall through to lavaGradientStyle via getParallelColor
  if (n.includes('red/white/blue') || n.includes('red, white'))
    return `background:linear-gradient(to right,#cc2936 0%,#cc2936 33%,#e8e8e8 33%,#e8e8e8 66%,#002868 66%,#002868 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.5px #333;font-weight:600;letter-spacing:0.03em;`;
  if (n.includes('baseball seams'))
    return `background:repeating-linear-gradient(to right,#f5f0e8 0px,#f5f0e8 12px,#cc2936 12px,#cc2936 16px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.5px #8b1a1a;font-weight:600;`;
  if (n.includes('gradient')) {
    const m = name.match(/^([^/]+)\/([^/]+?)\s*gradient/i);
    if (m) {
      const c1 = getParallelColor(m[1].trim());
      const c2 = getParallelColor(m[2].trim());
      return `background:linear-gradient(to right,${c1},${c2});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;`;
    }
  }
  if (n === 'glossy' || n === 'patch') return `color:#555;`;
  if (n.includes('tie-dye')) return `background:repeating-radial-gradient(circle at 40% 50%,#ff4488 0%,#ff4488 7%,#ff8800 7%,#ff8800 14%,#ffdd00 14%,#ffdd00 21%,#44cc00 21%,#44cc00 28%,#0088ff 28%,#0088ff 35%,#8800ff 35%,#8800ff 42%,#ff4488 42%);background-size:140px 30px;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;animation:tiedye-scroll 6s linear infinite;`;
  if (n.includes('canvas')) return `background:repeating-linear-gradient(90deg,rgba(0,0,0,.09) 0px,rgba(0,0,0,.09) 1px,transparent 1px,transparent 4px),repeating-linear-gradient(0deg,rgba(0,0,0,.09) 0px,rgba(0,0,0,.09) 1px,transparent 1px,transparent 4px),linear-gradient(#c8a870,#b89060);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;`;
  if (n === 'wood' || n === 'wood stock') return `background:repeating-linear-gradient(to right,#5c2e0a 0px,#5c2e0a 2px,#7a4418 2px,#7a4418 6px,#9a6030 6px,#9a6030 8px,#6a3810 8px,#6a3810 11px,#c49060 11px,#c49060 13px,#7a4418 13px,#7a4418 18px);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;`;
  if (n.includes('copper')) return `background:linear-gradient(135deg,#8b4513 0%,#cd7f32 25%,#e8a860 45%,#d4894a 55%,#b87333 75%,#e8c08a 90%,#cd7f32 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;animation:copper-sweep 7s ease-in-out infinite;`;
  if (n === 'wave refractor') return `background:linear-gradient(to bottom,#e74c3c,#e67e22,#f1c40f,#27ae60,#3498db,#9b59b6,#e74c3c,#e67e22);background-size:auto 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:wave-sweep 4s linear infinite;font-weight:600;`;
  if (n.includes('aqua') && n.includes('wave') && n.includes('refractor')) return `background:linear-gradient(to bottom,#004d6e,#00bcd4,#80eeff,#00bcd4,#004d6e);background-size:auto 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;-webkit-text-stroke:0.4px #003a52;font-weight:600;animation:wave-sweep 3.5s linear infinite;`;
  // Two-tone slash parallels (e.g. "Blue/Gold", "Rose Gold/Gold")
  if (n.includes('/') && !n.includes('red/white') && !n.includes('gradient')) {
    const _sparts = name.split('/');
    if (_sparts.length === 2) {
      const _sc1 = getParallelColor(_sparts[0].trim());
      const _sc2 = getParallelColor(_sparts[1].trim());
      return `background:linear-gradient(to right,${_sc1},${_sc2},${_sc1});background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;animation:mojo-sweep 3.5s linear infinite;`;
    }
  }
  const col = getParallelColor(name);
  if (col === '#777') return `color:${col};`;
  const _lavs = lavaGradientStyle(name);
  if (n.includes('refractor') || n === 'x-fractor') {
    return _lavs.replace('-webkit-background-clip:', 'background-size:200% auto;-webkit-background-clip:') + 'animation:mojo-sweep 3.5s linear infinite;';
  }
  return _lavs;
}
function getParallelNameStyle(name) {
  let s = _parallelStyleRaw(name);
  if (s.includes('-webkit-background-clip')) {
    if (!s.includes('-webkit-text-stroke')) s += '-webkit-text-stroke:0.4px #222;';
    s += 'font-size:12px;';
  }
  return s;
}

function openGridView() {
  const modal = document.getElementById('gridModal');
  modal.style.display = 'flex';
  document.getElementById('gridSearch').value = '';
  document.getElementById('gridOwnedOnly').checked = false;
  buildGrid();
}

function closeGridView() {
  document.getElementById('gridModal').style.display = 'none';
}

function mkGridTags(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(t => {
    const d = TAG_DEF[t];
    return d ? `<span class="grid-tag ${d.cls}">${d.lbl}</span>` : '';
  }).join('');
}

function toggleGridParallels(safeId) {
  const rows = document.querySelectorAll(`#gridBody tr.grid-par-row[data-gridparent="${safeId}"]`);
  const btn  = document.getElementById(`gptbtn-${safeId}`);
  const anyVisible = Array.from(rows).some(r => !r.classList.contains('grid-par-hidden'));
  rows.forEach(r => r.classList.toggle('grid-par-hidden', anyVisible));
  if (btn) btn.textContent = anyVisible ? `▶ ${rows.length} parallels` : `▼ ${rows.length} parallels`;
}

function buildGrid() {
  const tbody = document.getElementById('gridBody');
  let html = '';
  let totalRows = 0, ownedRows = 0;
  const usedRowIds = new Set();  // mirrors buildAll() deduplication

  const grouped = groupCards(CARDS);
  const years = Object.keys(grouped).sort();

  years.forEach(year => {
    const sets = grouped[year];
    Object.keys(sets).forEach(setName => {
      const cards = sets[setName];

      const totalInSet = cards.filter(c => !c._hide).length;
      const ownedInSet = cards.filter(c => !c._hide && ownedSet.has(`s|${setName}|${c.num}|${c.type||'base'}`)).length;
      html += `<tr class="grid-set-header"><td colspan="4"><div class="grid-set-inner"><span class="grid-set-name">${year} · ${setName}</span><span class="grid-set-badge">${ownedInSet} / ${totalInSet} owned</span></div></td></tr>`;

      cards.forEach(c => {
        if (c._hide) return;
        let rowId = `s|${setName}|${c.num}|${c.type||'base'}`;
        if (usedRowIds.has(rowId)) {
          let dupN = 2;
          while (usedRowIds.has(`${rowId}-${dupN}`)) dupN++;
          rowId = `${rowId}-${dupN}`;
        }
        usedRowIds.add(rowId);
        const safeId = rowId.replace(/[^a-zA-Z0-9]/g, '_');
        const owned  = ownedSet.has(rowId);
        if (owned) ownedRows++;
        totalRows++;

        const tmplPars = getCardParallels(c);
        const userPars = userParallels.filter(p => p.baseRowId === rowId);
        const totalPars = tmplPars.length + userPars.length;
        const parToggle = totalPars
          ? `<button id="gptbtn-${safeId}" class="grid-par-toggle" onclick="toggleGridParallels('${safeId}')">▶ ${totalPars} parallel${totalPars!==1?'s':''}</button>`
          : '';

        html += `<tr class="${owned ? 'grid-owned' : ''}" data-search="${[year, setName, c.num, c.title, c.type, c.parallel].join(' ').toLowerCase()}" data-owned="${owned ? '1' : '0'}" data-safeid="${safeId}">
          <td class="grid-own-cell">${owned ? '<span class="gv-owned-chk">✓</span>' : ''}</td>
          <td class="grid-num">${c.num}</td>
          <td class="grid-title">${displayTitle(c.title)}<div class="grid-sub">${c.type}${parToggle}</div></td>
          <td class="grid-tags">${mkGridTags(c.tags)}</td>
        </tr>`;

        // Template parallel rows (collapsed by default)
        tmplPars.forEach(p => {
          const varKey   = `${rowId}__${p.id}`;
          const isOwned  = ownedData.has(varKey);
          if (isOwned) ownedRows++;
          totalRows++;
          const color    = getParallelColor(p.name);
          const prStr    = p.printRun ? `<span style="color:${color};font-size:11px;font-weight:700;margin-left:6px;">${p.printRun}</span>` : '';
          html += `<tr class="grid-par-row grid-par-hidden${isOwned?' grid-owned':''}"
            data-gridparent="${safeId}"
            data-search="${[year, setName, c.num, c.title, p.name, p.printRun||''].join(' ').toLowerCase()}"
            data-owned="${isOwned?'1':'0'}"
            style="border-left:3px solid ${color}60;">
            <td class="grid-own-cell">${isOwned ? '<span class="gv-owned-chk">✓</span>' : ''}</td>
            <td class="grid-num" style="color:#aaa;font-size:10px;">↳ ${c.num}</td>
            <td class="grid-title" style="padding-left:16px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle;flex-shrink:0;"></span><span style="${getParallelNameStyle(p.name)}">${formatParallelName(p.name)}</span>${prStr}
            </td>
            <td class="grid-tags"></td>
          </tr>`;
        });

        // User-added parallel rows
        userPars.forEach(p => {
          const isOwned = ownedData.has(p.id);
          if (isOwned) ownedRows++;
          totalRows++;
          const parDisplay = [p.color, p.numbered && p.numbered !== 'Unnumbered' ? p.numbered : ''].filter(Boolean).join(' ');
          const color = getParallelColor(p.color || '');
          html += `<tr class="grid-par-row grid-par-hidden${isOwned?' grid-owned':''}"
            data-gridparent="${safeId}"
            data-search="${[year, setName, p.num, p.title, parDisplay].join(' ').toLowerCase()}"
            data-owned="${isOwned?'1':'0'}"
            style="border-left:3px solid ${color}60;">
            <td class="grid-own-cell">${isOwned ? '<span class="gv-owned-chk">✓</span>' : ''}</td>
            <td class="grid-num" style="color:#aaa;font-size:10px;">↳ ${p.num}</td>
            <td class="grid-title" style="padding-left:16px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle;"></span>${p.title}
              <div class="grid-sub" style="padding-left:13px;">${p.type} <span style="color:var(--gold2);font-size:9px;">✦ ADDED</span></div>
            </td>
            <td class="grid-tags"></td>
          </tr>`;
        });
      });
    });
  });

  if (userCards.length) {
    html += `<tr class="grid-set-header"><td colspan="4"><div class="grid-set-inner"><span class="grid-set-name">Custom Added Cards</span></div></td></tr>`;
    userCards.forEach((c, idx) => {
      const rowId = `ua-${idx}`;
      const owned = ownedData.has(rowId);
      if (owned) ownedRows++;
      totalRows++;
      html += `<tr class="${owned ? 'grid-owned' : ''}" data-search="${[c.year, c.setName, c.cardNum, c.title, c.parallel].join(' ').toLowerCase()}" data-owned="${owned ? '1' : '0'}">
        <td class="grid-own-cell">${owned ? '<span class="gv-owned-chk">✓</span>' : ''}</td>
        <td class="grid-num">${c.cardNum || '—'}</td>
        <td class="grid-title">${displayTitle(c.title || c.setName)}<div class="grid-sub">${c.setName}</div></td>
        <td class="grid-tags">${mkGridTags(c.tags || [])}</td>
      </tr>`;
    });
  }

  tbody.innerHTML = html;
  document.getElementById('gridOwnedSummary').textContent = `${ownedRows} / ${totalRows} owned`;
}

function filterGrid() {
  const q         = document.getElementById('gridSearch').value.toLowerCase().trim();
  const ownedOnly = document.getElementById('gridOwnedOnly').checked;
  const rows      = document.querySelectorAll('#gridBody tr');
  let lastHeader  = null;
  let headerVisible = false;

  rows.forEach(tr => {
    if (tr.classList.contains('grid-set-header')) {
      if (lastHeader && !headerVisible) lastHeader.classList.add('grid-hidden');
      lastHeader = tr;
      headerVisible = false;
      tr.classList.remove('grid-hidden');
      return;
    }
    if (tr.classList.contains('grid-par-row')) {
      const parentSafeId = tr.dataset.gridparent;
      const parentRow    = parentSafeId ? document.querySelector(`#gridBody tr[data-safeid="${parentSafeId}"]`) : null;
      const parentHidden = parentRow && parentRow.classList.contains('grid-hidden');
      const search       = tr.dataset.search || '';
      const owned        = tr.dataset.owned === '1';
      const matchFilter  = (!q || search.includes(q)) && (!ownedOnly || owned);
      const shouldExpand = (ownedOnly && owned) || (q && search.includes(q));
      if (shouldExpand && !parentHidden) {
        tr.classList.remove('grid-par-hidden');
      } else if (!ownedOnly && !q) {
        tr.classList.add('grid-par-hidden');
      }
      tr.classList.toggle('grid-hidden', !matchFilter || parentHidden);
      if (matchFilter && !parentHidden) headerVisible = true;
      return;
    }
    const search = tr.dataset.search || '';
    const owned  = tr.dataset.owned === '1';
    const show   = (!q || search.includes(q)) && (!ownedOnly || owned);
    tr.classList.toggle('grid-hidden', !show);
    if (show) headerVisible = true;
  });
  if (lastHeader && !headerVisible) lastHeader.classList.add('grid-hidden');
}

// ============================================================
//  PRICE FLAG TOOLTIP  (fixed-position — escapes table cell clipping)
// ============================================================
(function () {
  const tip = document.createElement('div');
  tip.id = 'priceTip';
  Object.assign(tip.style, {
    position: 'fixed', background: '#1a1a1a', color: '#e8e8e8',
    fontSize: '11px', fontFamily: "'Roboto Mono',monospace",
    padding: '5px 9px', borderRadius: '4px', border: '1px solid #444',
    whiteSpace: 'nowrap', zIndex: '9999', pointerEvents: 'none',
    opacity: '0', transition: 'opacity .15s', display: 'none'
  });
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('.price-flag');
    if (!el) return;
    tip.textContent = el.dataset.tip || '';
    tip.style.display = 'block';
    // Measure after display so offsetWidth is real
    const r   = el.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    let left = r.left + r.width / 2 - tipW / 2;
    // Keep within viewport horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    tip.style.left = left + 'px';
    tip.style.top  = (r.top - tipH - 6) + 'px';
    tip.style.opacity = '1';
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.price-flag')) return;
    tip.style.opacity = '0';
    tip.style.display = 'none';
  });
})();

// ============================================================
//  BRAND COMBO BOX
// ============================================================
let _comboCurrent = '';   // currently-selected brand value
let _comboFocusIdx = -1;  // keyboard navigation index

function initCombo() {
  const inp  = document.getElementById('brandComboInput');
  const list = document.getElementById('brandComboList');
  const clr  = document.getElementById('brandClearBtn');
  const wrap = document.getElementById('brandComboWrapper');
  if (!inp || !list || !wrap) return;

  _comboBuildList('');

  inp.addEventListener('input', () => {
    // Typing clears the active selection so cards show unfiltered while searching
    if (_comboCurrent) {
      _comboCurrent = '';
      const sel = document.getElementById('filterBrand');
      if (sel) sel.value = '';
      if (clr) clr.style.display = 'none';
      doFilter();
    }
    _comboBuildList(inp.value);
    comboOpen();
  });

  inp.addEventListener('focus', () => {
    _comboBuildList(inp.value || '');
    comboOpen();
  });

  inp.addEventListener('blur', e => {
    // Don't close if focus moves to something inside the wrapper (e.g. clear btn)
    if (wrap.contains(e.relatedTarget)) return;
    setTimeout(() => {
      comboClose();
      // Restore display label if something is selected
      if (_comboCurrent) {
        const sel = document.getElementById('filterBrand');
        const opt = sel ? Array.from(sel.options).find(o => o.value === _comboCurrent) : null;
        if (opt) inp.value = opt.text;
      } else {
        inp.value = '';
      }
    }, 150);
  });

  inp.addEventListener('keydown', e => {
    const items = list.querySelectorAll('.combo-all, .combo-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _comboFocusIdx = Math.min(_comboFocusIdx + 1, items.length - 1);
      _comboHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _comboFocusIdx = Math.max(_comboFocusIdx - 1, 0);
      _comboHighlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_comboFocusIdx >= 0 && items[_comboFocusIdx]) items[_comboFocusIdx].click();
    } else if (e.key === 'Escape') {
      comboClose();
      inp.blur();
    }
  });

  if (clr) clr.addEventListener('click', () => comboClear());

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) comboClose();
  });
}

function _comboBuildList(q) {
  const sel  = document.getElementById('filterBrand');
  const list = document.getElementById('brandComboList');
  if (!sel || !list) return;
  q = (q || '').toLowerCase().trim();
  list.innerHTML = '';
  _comboFocusIdx = -1;

  // "All Products" row
  const allEl = document.createElement('div');
  allEl.className = 'combo-all' + (_comboCurrent === '' ? ' selected' : '');
  allEl.textContent = 'All Products';
  allEl.onclick = () => comboSelect('', '');
  list.appendChild(allEl);

  let anyItem = false;
  sel.querySelectorAll('optgroup').forEach(grp => {
    const hits = [];
    grp.querySelectorAll('option').forEach(opt => {
      if (!q || opt.text.toLowerCase().includes(q) || opt.value.includes(q)) {
        hits.push({ value: opt.value, label: opt.text });
        anyItem = true;
      }
    });
    if (!hits.length) return;
    const hdr = document.createElement('div');
    hdr.className = 'combo-group-label';
    hdr.textContent = grp.label.replace(/^--\s*|\s*--$/g, '');
    list.appendChild(hdr);
    hits.forEach(item => {
      const el = document.createElement('div');
      el.className = 'combo-item' + (item.value === _comboCurrent ? ' selected' : '');
      el.textContent = item.label;
      el.dataset.value = item.value;
      el.onclick = () => comboSelect(item.value, item.label);
      list.appendChild(el);
    });
  });

  if (q && !anyItem) {
    const empty = document.createElement('div');
    empty.className = 'combo-empty';
    empty.textContent = 'No matching products';
    list.appendChild(empty);
  }
}

function _comboHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('focused', i === _comboFocusIdx));
  if (_comboFocusIdx >= 0 && items[_comboFocusIdx]) {
    items[_comboFocusIdx].scrollIntoView({ block: 'nearest' });
  }
}

function comboOpen() {
  const list = document.getElementById('brandComboList');
  if (list) list.classList.add('open');
}

function comboClose() {
  const list = document.getElementById('brandComboList');
  if (list) list.classList.remove('open');
  _comboFocusIdx = -1;
}

function comboSelect(value, label) {
  _comboCurrent = value;
  const sel = document.getElementById('filterBrand');
  if (sel) sel.value = value;
  const inp = document.getElementById('brandComboInput');
  if (inp) inp.value = label;
  const clr = document.getElementById('brandClearBtn');
  if (clr) clr.style.display = value ? 'inline' : 'none';
  comboClose();
  doFilter();
}

function comboClear() {
  comboSelect('', '');
  const inp = document.getElementById('brandComboInput');
  if (inp) { inp.value = ''; inp.focus(); }
  _comboBuildList('');
  comboOpen();
}

// ============================================================
//  INIT
// ============================================================
function toggleSetNav() {
  const panel = document.getElementById('setNavPanel');
  const expanded = panel.classList.toggle('snav-expanded');
  try { localStorage.setItem('snavExpanded', expanded ? '1' : '0'); } catch {}
}

let _snavLastActive = null;
let _snavTick = false;

function updateSetNavActive() {
  const bc = document.getElementById('binderContent');
  const binderVisible = bc && bc.style.display === 'block';
  const sections = document.querySelectorAll(binderVisible ? '.bv-section[data-set]' : '.set-section[data-set]');
  let current = null;
  sections.forEach(sec => {
    if (sec.getBoundingClientRect().top <= window.innerHeight * 0.35) current = sec.dataset.set;
  });
  if (current === _snavLastActive) return;
  _snavLastActive = current;
  const list = document.getElementById('setNavList');
  if (!list) return;
  list.querySelectorAll('.snav-item').forEach(el => el.classList.toggle('snav-active', el.dataset.set === current));
  const activeEl = list.querySelector('.snav-item.snav-active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function initSetNav() {
  const panel = document.getElementById('setNavPanel');
  const list  = document.getElementById('setNavList');
  if (!panel || !list) return;
  try { if (localStorage.getItem('snavExpanded') === '1') panel.classList.add('snav-expanded'); } catch {}
  const sections = Array.from(document.querySelectorAll('.set-section[data-set]'));
  if (!sections.length) return;
  let currentYear = '';
  sections.forEach(sec => {
    const setKey = sec.dataset.set || '';
    const year   = sec.dataset.year || (setKey.match(/^(\d{4})/) || [])[1] || '';
    if (year !== currentYear) {
      currentYear = year;
      const yDiv = document.createElement('div');
      yDiv.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px 3px;position:sticky;top:0;z-index:1;background:#1a1d22;';
      const ySpan = document.createElement('span');
      ySpan.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.08em;color:#b4bece;font-family:"Barlow Condensed",sans-serif;white-space:nowrap;';
      ySpan.textContent = year;
      const yLine = document.createElement('div');
      yLine.style.cssText = 'flex:1;height:1px;background:rgba(180,190,210,0.2);';
      yDiv.appendChild(ySpan);
      yDiv.appendChild(yLine);
      list.appendChild(yDiv);
    }
    const displayName = setKey
      .replace(/^\d{4}\s+/, '')
      .replace(/\s+baseball\s*$/i, '')
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/'(\w)/g, (_, c) => "'" + c.toLowerCase());
    const item = document.createElement('div');
    item.className = 'snav-item';
    item.dataset.set = setKey;
    item.textContent = displayName;
    item.title = displayName;
    item.onclick = () => {
      const bc = document.getElementById('binderContent');
      if (bc && bc.style.display === 'block') {
        const bSec = document.querySelector(`.bv-section[data-set="${CSS.escape(setKey)}"]`);
        if (bSec) bSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    list.appendChild(item);
  });
  window.addEventListener('scroll', () => {
    if (!_snavTick) { _snavTick = true; requestAnimationFrame(() => { updateSetNavActive(); _snavTick = false; }); }
  }, { passive: true });
  updateSetNavActive();
}

async function initAll() {
  try {
    loadOwned();
    loadUserParallels();
    buildAll();
    initUserCards();
    initCombo();
    updateStatsDashboard();
    ensureLightbox();
    setTimeout(initSetNav, 0);
    try {
      if (localStorage.getItem('skenes_notice_collapsed') === '1') {
        const body = document.getElementById('noticeBody');
        const btn  = document.getElementById('noticeToggleBtn');
        if (body) { body.classList.add('collapsed'); if (btn) btn.textContent = '[show]'; }
      }
    } catch {}
  } catch(e) {
    console.error('initAll error:', e);
    try { updateStatsDashboard(); } catch {}
  }
}
initAll();
