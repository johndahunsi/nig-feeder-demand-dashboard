/* ── LOOKUP ENGINE ─────────────────────────────────────────────
   Reads pre-computed outputs.json.
   ──────────────────────────────────────────────────────────────── */
let DB = null;

function nearest(arr, v) {
  return arr.reduce((a,b) => Math.abs(b-v)<Math.abs(a-v)?b:a);
}

function lookupScalar(h0, cf, pw, yr) {
  const h0n=nearest(DB.meta.h0_vals,h0),
        cfn=nearest(DB.meta.cf_vals,cf),
        yrn=nearest(DB.meta.years,yr);
  const row = DB.scalar.find(r=>r.h0===h0n&&r.cf===cfn&&r.pw===pw&&r.yr===yrn);
  return row || DB.scalar.find(r=>r.pw===pw&&r.yr===yrn) || DB.scalar[0];
}

function lookupDiurnal(h0, season, yr, pw) {
  const h0n=nearest([2,4,6.6,8,10,12,16,20],h0),
        yrn=nearest([0,5,10,15,20],yr),
        sea=season==='harm'?'harmattan':season;
  const row = DB.diurnal.find(r=>r.h0===h0n&&r.season===sea&&r.yr===yrn&&r.pw===pw);
  return row ? row.profile : DB.diurnal.find(r=>r.pw===pw).profile;
}

function lookupTraj(h0, cf, pw) {
  const h0n=nearest([4,6.6,8,10,14,20],h0),
        cfn=nearest([0.60,0.75,0.85],cf);
  const row = DB.trajectory.find(r=>r.h0===h0n&&r.cf===cfn&&r.pw===pw);
  return row ? row.traj : DB.trajectory.find(r=>r.pw===pw).traj;
}

function lookupZone(hhA,hhB,hhC) {
  const hAn=nearest(DB.meta.hhA_vals,hhA),
        hBn=nearest(DB.meta.hhB_vals,hhB),
        hCn=nearest(DB.meta.hhC_vals,hhC);
  return DB.zones.find(r=>r.hhA===hAn&&r.hhB===hBn&&r.hhC===hCn) || DB.zones[0];
}

// ── Override compute functions with lookup equivalents ────────────
function ringPeak(p, pw, yr) {
  if(!DB) return 7.88;
  const row = lookupScalar(p.h0, p.cf, pw||'CT', yr||0);
  const hhScale = (p.hhA+p.hhB+p.hhC) / 4000;
  const lamScale = 1 + (p.lam-1.0)*0.6;
  const gpScale  = 0.40 + (p.gp/100)*0.60;
  return +(row.peak * hhScale * lamScale * gpScale).toFixed(2);
}

function btmFrac(p, pw, yr) {
  if(!DB) return 0.63;
  const row = lookupScalar(p.h0, p.cf, pw||'CT', yr||0);
  const gpScale = 0.40 + (p.gp/100)*0.60;
  return +Math.min(0.90, row.btm * gpScale).toFixed(3);
}

function co2Lookup(p, pw, yr) {
  if(!DB) return 2000;
  const peak = ringPeak(p, pw||'CT', yr||0);
  const btm  = btmFrac(p, pw||'CT', yr||0);
  return Math.round(peak*btm*1000*0.325*8760*0.984/1000);
}

function pathMult(pw, yr) {
  if(!DB) return 1;
  const traj = lookupTraj(6.6, 0.75, pw);
  const yrn  = Math.min(20, Math.max(0, Math.round(yr)));
  return traj[yrn] / traj[0];
}

function trajPeak(pw, yr, p) {
  if(!DB) return ringPeak(p,pw,yr);
  const traj = lookupTraj(p.h0, p.cf, pw);
  const yrn  = Math.min(20, Math.max(0, Math.round(yr)));
  const base = traj[yrn];
  const hhScale = (p.hhA+p.hhB+p.hhC)/4000;
  const lamScale = 1+(p.lam-1.0)*0.6;
  const gpScale  = 0.40+(p.gp/100)*0.60;
  return +(base * hhScale * lamScale * gpScale).toFixed(2);
}

function btmFracT(pw, yr, p) { return btmFrac(p, pw, yr); }
function peakMWT(pw, yr, p)   { return trajPeak(pw, yr, p); }


// ── Chart rendering and UI (from engine.js) ─────────────────
const DEFAULT_ZONES = [
  {name:'Zone A (MTF 5)', hh:1000, tier:1},  // MTF 5 — GRA/premium estate
  {name:'Zone B (MTF 4)', hh:2000, tier:2},  // MTF 4 — upper-middle residential
  {name:'Zone C (MTF 3)', hh:1000, tier:3},  // MTF 3 — lower-middle urban (sandcrete)
];
let zones = DEFAULT_ZONES.map(z=>({...z}));

// Appliance definitions: [name, defaultKW, minKW, maxKW, step, unit, rationale]
const APP_DEFS = [
  ['Lighting',       0.08, 0.03, 0.20, 0.01, 'kW', 'LED: 0.05–0.08 | CFL: 0.10 | Incandescent: 0.15–0.20'],
  ['TV / Radio',     0.15, 0.05, 0.30, 0.01, 'kW', 'LED TV 32": 0.05–0.08 | 43": 0.10–0.12 | Plasma/CRT: 0.15–0.25'],
  ['Fans',           0.065,0.025,0.12, 0.005,'kW', 'Table: 0.025–0.04 | Ceiling: 0.05–0.06 | Standing: 0.06–0.10'],
  ['Refrigerator',   0.15, 0.08, 0.35, 0.01, 'kW', '100L: 0.08–0.12 | 150L: 0.12–0.18 | 200L+: 0.20–0.35'],
  ['Water Pump',     0.75, 0.25, 1.50, 0.05, 'kW', '0.5HP: 0.37 | 1HP: 0.75 | 1.5HP: 1.10 | 2HP: 1.50'],
  ['Boiler/Geyser',  2.00, 0.75, 3.00, 0.25, 'kW', 'Instant 10L: 1.0–1.5 | Instant 20L: 1.5–2.0 | Storage: 2.0–3.0'],
  ['Pressing Iron',  1.20, 0.75, 2.40, 0.05, 'kW', 'Basic: 0.75–1.0 | Standard: 1.0–1.5 | Steam: 1.5–2.4'],
  ['Phone Charging', 0.05, 0.01, 0.15, 0.01, 'kW', 'Phone only: 0.01 | Phone+tablet: 0.03 | + Laptop: 0.05–0.12'],
  ['Deep Freezer',   0.15, 0.08, 0.25, 0.01, 'kW', '100L: 0.08–0.12 | 150L: 0.12–0.18 | 200L+: 0.18–0.25'],
  ['Washing Machine',0.45, 0.25, 2.00, 0.05, 'kW', 'Semi-auto: 0.25–0.50 | Front-load: 0.80–1.20 | Top-load+heat: 1.50–2.00'],
  ['Microwave Oven', 0.80, 0.60, 1.40, 0.05, 'kW', '700W output: 0.80 | 900W: 1.00 | 1200W: 1.35'],
  ['Elec. Cooking',  1.50, 0.60, 2.20, 0.05, 'kW', 'Single hotplate: 0.60–1.00 | Induction: 1.20–2.00 | Coil: 1.00–1.50'],
];

// Live kW overrides — start at defaults
let appKW = Object.fromEntries(APP_DEFS.map(([name,kw])=>[name,kw]));

// MTF tier ADMD base values (kW/HH) — calibrated to simulator v16 (paper v36)
// Used when zones are customised; admd[tier] is the per-HH ADMD at central params
// ADMD_BASE updated for corrected kW ratings (Lighting 0.08, Fans 0.065, Pump 0.75, WashMach 0.45)
// Analytic estimate: −4.2% on non-BTM organic component; BTM migration unchanged.
const ADMD_BASE = {1:2.55, 2:1.934, 3:1.462, 4:0.810, 5:0.40};
// Base BTM fractions calibrated at H0=6.6h/day (PeopleSuN national urban average)
const BTM_F0    = {1:0.72, 2:0.617, 3:0.526, 4:0.318, 5:0.15};
const BTM_FLOOR = {1:0.50, 2:0.40,  3:0.30,  4:0.15,  5:0.05};  // persistence floor as % of BTM_F0
const H0_BTM_REF = 6.6;  // PeopleSuN calibration point

// H0-dependent BTM fraction.
// At H0=6.6h: returns PeopleSuN-calibrated base value exactly.
// At H0>6.6h: decays linearly toward a persistence floor.
//   Floor = households that retain generators for backup value / legacy inertia
//   even when supply is mostly reliable.  Evidence: PeopleSuN better-served zones
//   still show significant generator ownership; 30%+ of Nigerian outages are forced
//   equipment failures regardless of nominal band (Energy for Growth Hub 2025).
// At H0<6.6h: scales up slightly (higher generator dependency at lower supply hours).
// Stage 2 validation: floor percentages should be calibrated against PeopleSuN
//   tier × supply-hour cross-tabs from the raw microdata.
function btmFraction(tier, h0) {
  const f0    = BTM_F0[tier]    || 0.50;
  const floor = f0 * (BTM_FLOOR[tier] || 0.30);
  if(h0 <= H0_BTM_REF){
    // Below calibration: slight uplift toward more BTM
    const frac = Math.max(0, Math.min(1, (H0_BTM_REF - h0)/(H0_BTM_REF - 2.0)));
    return f0 + f0 * 0.15 * frac;
  } else {
    // Above calibration: linear decay to floor
    const frac = Math.min(1, (h0 - H0_BTM_REF)/(24 - H0_BTM_REF));
    return f0 - (f0 - floor) * frac;
  }
}

// Keep BTM_F as alias for backward compat (used in btmMW, co2 functions)
const BTM_F = BTM_F0;

// Appliance utilisation factors (fraction of day running at rated kW)
const UTIL = {
  'Lighting':0.30,'TV / Radio':0.20,'Fans':0.40,'Refrigerator':0.85,
  'Water Pump':0.05,'Boiler/Geyser':0.04,'Pressing Iron':0.03,'Phone Charging':0.25,
  'Deep Freezer':0.57,'Washing Machine':0.06,'Microwave Oven':0.04,'Elec. Cooking':0.08
};

// Tier penetration index: APP_DEFS index [kw,t1,t2,t3,t4,t5] — matches APPLIANCES order
// Penetrations by tier [T1,T2,T3,T4,T5]
const PEN = {
  'Lighting':       [1.00,1.00,0.98,0.90,0.70],
  'TV / Radio':     [1.00,0.95,0.82,0.55,0.30],
  'Fans':           [0.60,0.75,0.88,0.95,0.95],
  'Refrigerator':   [1.00,0.92,0.72,0.38,0.10],
  'Water Pump':     [1.00,0.82,0.55,0.15,0.02],
  'Boiler/Geyser':  [0.90,0.62,0.25,0.05,0.00],
  'Pressing Iron':  [0.88,0.82,0.65,0.28,0.08],
  'Phone Charging': [1.00,1.00,0.95,0.78,0.55],
  'Deep Freezer':   [0.90,0.50,0.22,0.05,0.00],
  'Washing Machine':[0.65,0.28,0.10,0.02,0.00],
  'Microwave Oven': [0.85,0.50,0.18,0.02,0.00],
  'Elec. Cooking':  [0.35,0.10,0.04,0.01,0.00],
};

// Default organic kW/HH per tier — computed from default APP_DEFS kW values.
// Used as the denominator in the kW-override scaling ratio.
// Organic component only (excludes BTM migration and AC temperature load).
const ORG_DEFAULT = (function(){
  const out = {};
  [1,2,3,4,5].forEach(tier => {
    const t = tier - 1;
    out[tier] = APP_DEFS.reduce((s,[name,kw]) => {
      const pen  = (PEN[name]||[])[t] || 0;
      const util = UTIL[name] || 0;
      return s + kw * pen * util;
    }, 0);
  });
  return out;
})();

// Compute live ADMD for a given tier using current appKW overrides.
//
// Architecture: the calibrated ADMD_BASE values incorporate BTM migration,
// AC temperature-driven load, and the full Markov engine output — not just
// the appliance organic component.  Recomputing ADMD purely from pen×kW×util
// omits BTM migration and understates total demand by 27–34% depending on tier.
//
// Correct approach: scale the calibrated ADMD by the ratio
//   organic_current / organic_default
// applied only to the non-BTM, non-AC organic fraction.
// The BTM and AC fractions are preserved unchanged.
//
// ADMD_live = ADMD_base × [btmF + (1-btmF-acF) × (organic_current/organic_default) + acF]
//           = ADMD_base × [1 - (1-btmF-acF) × (1 - ratio)]
//
// where ratio = organic_current / organic_default, acF ≈ 0.22 (AC share of organic)
function liveADMD(tier) {
  const t     = tier - 1;
  const btmF  = BTM_F[tier] || 0.5;
  const acF   = 0.22;                      // AC fraction of non-BTM ADMD (calibrated)
  const base  = ADMD_BASE[tier] || 1.5;

  // Current organic contribution from kW-overrideable appliances
  const orgCurrent = APP_DEFS.reduce((s,[name]) => {
    const kw   = appKW[name];
    const pen  = (PEN[name]||[])[t] || 0;
    const util = UTIL[name] || 0;
    return s + kw * pen * util;
  }, 0);

  const orgDefault = ORG_DEFAULT[tier] || orgCurrent;
  const ratio      = orgDefault > 0 ? orgCurrent / orgDefault : 1.0;

  // Scale only the non-BTM, non-AC organic fraction; preserve BTM and AC unchanged
  const organicFrac = (1 - btmF - acF * (1 - btmF));
  return base * (1 - organicFrac * (1 - ratio));
}

// ringPeak: zones[] array, live appKW overrides, H0-dependent BTM fraction.
// BTM fraction falls as H0 rises — better-served feeders have fewer generators
// and lower Day-1 BTM migration on franchise commencement.
function ringPeak(p){
  const {S,cf,gp,h0}=p;
  let total = 0;
  for(const z of zones){
    const btmF = btmFraction(z.tier, h0);  // H0-dependent, not constant
    const admd  = liveADMD(z.tier);
    const g = gp/100;
    const kw = (admd*btmF*g + admd*(1-btmF)*(S/3.64))*(cf/0.75);
    total += z.hh * kw / 1000;
  }
  return total;
}

// ── ZONE BUILDER ─────────────────────────────────────────────────────────────

const TIER_NAMES = {1:'MTF 5 (GRA/premium)', 2:'MTF 4 (upper-middle)', 3:'MTF 3 (lower-middle)',
                    4:'MTF 2 (lower-income)', 5:'MTF 1 (subsistence)'};
const TIER_COLS  = {1:'#bc8cff', 2:'#58a6ff', 3:'#d29922', 4:'#3fb950', 5:'#8b949e'};

function renderZones(){
  const container = document.getElementById('zone-rows');
  if(!container) return;
  container.innerHTML = zones.map((z,i)=>`
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <div style="width:8px;height:8px;border-radius:50%;background:${TIER_COLS[z.tier]};flex-shrink:0"></div>
        <input value="${z.name}" oninput="zones[${i}].name=this.value;updateAll()"
          style="flex:1;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:10px;font-family:'IBM Plex Mono',monospace;outline:none;padding:1px 0">
        ${zones.length>1?`<button onclick="removeZone(${i})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:0 2px;line-height:1">×</button>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <div style="flex:1">
          <div style="font-size:8px;color:var(--muted);margin-bottom:2px">Households</div>
          <input type="number" value="${z.hh}" min="100" max="20000" step="100"
            oninput="zones[${i}].hh=+this.value||100;updateAll()"
            style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);font-size:10px;font-family:'IBM Plex Mono',monospace;padding:3px 6px;border-radius:2px;outline:none">
        </div>
        <div style="flex:1">
          <div style="font-size:8px;color:var(--muted);margin-bottom:2px">MTF Tier</div>
          <select oninput="zones[${i}].tier=+this.value;renderZones();updateAll()"
            style="width:100%;background:var(--surface);border:1px solid var(--border);color:${TIER_COLS[z.tier]};font-size:10px;padding:3px 6px;border-radius:2px;outline:none">
            ${[1,2,3,4,5].map(t=>`<option value="${t}" ${z.tier===t?'selected':''}>${['MTF 5 (GRA/premium)','MTF 4 (upper-middle)','MTF 3 (lower-middle)','MTF 2 (lower-income)','MTF 1 (subsistence)'][t-1]}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>`).join('');
}

function addZone(){
  if(zones.length>=6) return;
  zones.push({name:`Zone ${String.fromCharCode(65+zones.length)}`, hh:500, tier:3});
  renderZones(); updateAll();
}

function removeZone(i){
  if(zones.length<=1) return;
  zones.splice(i,1); renderZones(); updateAll();
}

function resetZones(){
  zones = DEFAULT_ZONES.map(z=>({...z}));
  renderZones(); updateAll();
}

// ── APPLIANCE kW SLIDERS ─────────────────────────────────────────────────────

function buildAppSliders(){
  const container = document.getElementById('app-sliders');
  if(!container) return;
  container.innerHTML = APP_DEFS.map(([name,defKW,minKW,maxKW,step,unit,rationale])=>`
    <div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:2px">
        <span style="color:var(--text)">${name}</span>
        <span id="kw-lbl-${name.replace(/[^a-z]/gi,'_')}" style="font-family:'IBM Plex Mono',monospace;color:var(--accent)">${(appKW[name]||defKW).toFixed(2)} kW</span>
      </div>
      <input type="range" min="${minKW}" max="${maxKW}" step="${step}" value="${appKW[name]||defKW}"
        oninput="appKW['${name}']=+this.value;document.getElementById('kw-lbl-${name.replace(/[^a-z]/gi,'_')}').textContent=this.value+' kW';appPanelBuilt=false;updateAll()"
        style="width:100%;height:3px;accent-color:var(--accent)">
      <div style="font-size:8px;color:var(--muted);margin-top:1px;line-height:1.4">${rationale}</div>
    </div>`).join('');
}

function resetAppliances(){
  APP_DEFS.forEach(([name,defKW])=>{ appKW[name]=defKW; });
  buildAppSliders(); appPanelBuilt=false; updateAll();
}

function toggleAdvanced(){
  const panel = document.getElementById('adv-panel');
  const arrow = document.getElementById('adv-arrow');
  const open  = panel.style.display==='none';
  panel.style.display = open?'block':'none';
  arrow.style.transform = open?'rotate(90deg)':'';
  if(open){ renderZones(); buildAppSliders(); }
}

// ── CHART HELPERS ─────────────────────────────────────────────────────────────
function pathMult(path,year){
  // Scientifically grounded three-driver pathway model (v5 revision):
  //   gd  = per-household demand growth rate (income + appliance acquisition)
  //   gp  = connection/population growth rate (urban migration)
  //   gee = energy efficiency improvement rate (LED, inverter AC adoption)
  // Net CAGR = gd + gp - gee applied as compound growth from Year 0 baseline.
  // All pathways are monotone: CT/US/PT grow, RA/SD decline (population-driven),
  // floor at 0.40 (extreme stress scenario minimum — feeder cannot lose >60% of peak).
  // Sources: Nigeria ETP (2022); IEA Nigeria Energy Outlook; Energy for Growth Hub.
  const q={
    ct:{gd:.030,gp:.005,gee:.008},  // 3.2%/yr net — moderate income growth, modest efficiency
    us:{gd:.035,gp:.015,gee:.005},  // 5.5%/yr net — rapid in-migration, same per-HH as CT, minimal efficiency
    ra:{gd:.020,gp:-.003,gee:.015}, // -1.0%/yr net — slow growth + population decline + efficiency
    sd:{gd:.015,gp:-.005,gee:.015}, // -1.5%/yr net — economic stagnation + net out-migration
    pt:{gd:.030,gp:.005,gee:.015},  // 2.0%/yr net — moderate growth, prosumer solar + efficiency
  }[path];
  const net = q.gd + q.gp - q.gee;
  return Math.max(0.40, Math.pow(1 + net, year));
}

function trajPeak(path,year,p){ return +(ringPeak(p)*pathMult(path,year)).toFixed(3); }
function btmMW(peak,gp,h0){
  // Weighted average BTM fraction across zones at current H0
  const p = P();
  const h = (h0 !== undefined) ? h0 : (p ? p.h0 : 6.6);
  const totalHH = zones.reduce((s,z)=>s+z.hh, 0);
  const wtdBtmF = zones.reduce((s,z)=>s + z.hh * btmFraction(z.tier, h), 0) / Math.max(totalHH,1);
  return peak * wtdBtmF * (gp/100);
}
// Three developer supply mix scenarios for ΔEF
// Fleet-weighted EF_baseline = 0.984 kg CO2/kWh
// MTF 5: 80% diesel (0.82) + 15% petrol (1.00) = 0.82
// MTF 4: 45% diesel (0.89) + 55% petrol (1.09) = 1.00  
// MTF 3: 20% diesel (0.92) + 80% petrol (1.25) = 1.18
// NOTE: fuel type does NOT affect demand — only CO2 accounting
const EF_FLEET = 0.984;  // fleet-weighted baseline (kg CO2/kWh)
const EF_DIESEL_LB = 0.70;  // large diesel lower bound
const DEF_EF = {
  floor:   0.554,  // fleet EF - grid (0.984 - 0.430)
  central: 0.746,  // fleet EF - 60% sol+40% gas project (0.984 - 0.238)
  upper:   0.902,  // fleet EF - 90% sol+10% gas project (0.984 - 0.082)
};
const DEF_PROJ_EF = {floor:0.430, central:0.238, upper:0.082};

function co2Lookup(p, defKey){
  // CO2 = BTM energy x generator-on fraction x DEF
  // Generator-on correction 0.325: generators run mainly 18-22h
  // Overnight is rare (diesel cost approx NGN1,200-2,400/hr)
  const b = btmMW(ringPeak(p),p.gp,p.h0);
  const def_ef = DEF_EF[defKey||'floor'];
  return b * 8760 * 0.52 * 1000 * def_ef * 1e-3 * 0.325;
}

// ── CHART HELPERS ─────────────────────────────────────────────────────────────
function mkChart(id,cfg){
  if(charts[id]) charts[id].destroy();
  const el=document.getElementById(id);
  if(!el) return;
  charts[id]=new Chart(el,cfg);
  return charts[id];
}

// Capacity line as a dataset (no plugin needed)
function capDataset(cap,len){
  return {
    label:'Feeder capacity',
    data:Array(len).fill(cap),
    borderColor:'#d29922',
    borderDash:[4,3],
    borderWidth:1.5,
    pointRadius:0,
    fill:false,
    tension:0,
  };
}

// ── SIDEBAR PATHWAY LIST ──────────────────────────────────────────────────────
function buildPWList(){
  document.getElementById('pw-list').innerHTML = PATHS.map(k=>`
    <div class="pw-toggle active" id="pw-${k}" onclick="togglePW('${k}')">
      <div class="pw-dot" style="background:${PCOLORS[k]}"></div>
      <span class="pw-name">${PNAMES[k]}</span>
      <span class="pw-val" id="pwv-${k}">—</span>
    </div>`).join('');
}

function togglePW(k){
  if(activePathways.has(k)&&activePathways.size>1){ activePathways.delete(k); document.getElementById('pw-'+k).classList.remove('active'); }
  else { activePathways.add(k); document.getElementById('pw-'+k).classList.add('active'); }
  updateAll();
}

// ── KPI UPDATE ────────────────────────────────────────────────────────────────
function updateKPIs(p){
  // Day 1 peak is always Year 0 by definition — the KPI card never changes with year selector
  const peak=ringPeak(p);   // Year 0
  const btm=btmMW(peak,p.gp);
  const gen=Math.max(0,peak-p.cap);
  const tco2=co2Lookup(p,'floor');
  const lo=(tco2*8/1000).toFixed(0);
  const hi=(tco2*15/1000).toFixed(0);

  document.getElementById('hdr-peak').textContent=peak.toFixed(2)+' MW';
  const hdrSub2=document.getElementById('hdr-sub2');
  if(hdrSub2) hdrSub2.textContent='vs '+p.cap.toFixed(1)+' MW rating · '+zones.length+' zone'+(zones.length>1?'s':'')+' · '+zones.reduce((s,z)=>s+z.hh,0).toLocaleString()+' HH';
  document.getElementById('hdr-peak').style.color=peak>p.cap?'#f85149':'#3fb950';
  document.getElementById('k-peak').textContent=peak.toFixed(2)+' MW';
  const totalHH = zones.reduce((s,z)=>s+z.hh,0);
  const zonesDesc = zones.map(z=>`${z.name}(T${z.tier})`).join(' · ');
  document.getElementById('k-peak-sub').textContent=((peak/p.cap*100).toFixed(0))+'% of '+p.cap.toFixed(1)+' MW · Year 0';
  document.getElementById('k-btm').textContent=btm.toFixed(2)+' MW';
  document.getElementById('k-gen').textContent=gen>0?'+'+gen.toFixed(2)+' MW':'None';
  document.getElementById('k-gen').parentElement.className='kpi '+(gen>0?'kpi-r':'kpi-g');
  document.getElementById('k-co2').textContent=Math.round(tco2).toLocaleString()+' t';
  document.getElementById('k-co2-sub').textContent='$'+lo+'k–$'+hi+'k / yr';
  var _ct=document.getElementById('c-tco2'); if(_ct) _ct.textContent=Math.round(tco2).toLocaleString()+' t';
  var _cl=document.getElementById('c-lo');   if(_cl) _cl.textContent='$'+lo+'k';
  var _ch=document.getElementById('c-hi');   if(_ch) _ch.textContent='$'+hi+'k';;

  // Update Planning Pathways sidebar year label
  const pwYrEl = document.getElementById('pw-year-lbl');
  if(pwYrEl) pwYrEl.textContent = 'Year ' + p.year;

  PATHS.forEach(k=>{
    const el=document.getElementById('pwv-'+k);
    if(el) el.textContent=trajPeak(k, p.year, p).toFixed(2)+' MW';
  });
  return {peak,btm,gen,tco2};
}

// ── TRAJECTORY ────────────────────────────────────────────────────────────────
function updateTrajectory(p){
  const active=[...activePathways];
  const yl='Y';
  const labels=YEARS.map(y=>yl+y);

  // uncertainty band as two filled datasets
  const lo=YEARS.map(y=>trajPeak('ra',y,{...p,cf:.55,gp:50}));
  const hi=YEARS.map(y=>trajPeak('us',y,{...p,cf:.85,gp:100}));

  const datasets=[
    {label:'hi-band',data:hi,borderColor:'transparent',backgroundColor:'rgba(88,166,255,.08)',fill:'+1',tension:.35,pointRadius:0},
    {label:'lo-band',data:lo,borderColor:'transparent',backgroundColor:'transparent',fill:false,tension:.35,pointRadius:0},
    ...active.map(k=>({
      label:PNAMES[k],data:YEARS.map(y=>trajPeak(k,y,p)),
      borderColor:PCOLORS[k],backgroundColor:'transparent',
      borderWidth:k==='ct'?2.5:1.8,borderDash:PDASH[k],
      tension:.35,pointRadius:4,pointBackgroundColor:PCOLORS[k],fill:false
    })),
    capDataset(p.cap,YEARS.length)
  ];

  mkChart('ch-traj',{type:'line',data:{labels,datasets},options:{
    ...baseOpts('MW'),
    plugins:{legend:{display:false}}
  }});

  // Y5 bar
  const y5d=active.map(k=>trajPeak(k,5,p));
  mkChart('ch-y5',{type:'bar',data:{
    labels:active.map(k=>PNAMES[k].split(' ')[0]),
    datasets:[{data:y5d,backgroundColor:active.map(k=>PCOLORS[k]+'bb'),borderColor:active.map(k=>PCOLORS[k]),borderWidth:1,borderRadius:2},
              capDataset(p.cap,active.length)]
  },options:{...baseOpts('MW'),plugins:{legend:{display:false}},scales:{x:{...baseOpts().scales.x,stacked:false},y:{...baseOpts('MW').scales.y,min:0}}}});

  // Y20 bar
  const y20d=active.map(k=>trajPeak(k,20,p));
  mkChart('ch-y20',{type:'bar',data:{
    labels:active.map(k=>PNAMES[k].split(' ')[0]),
    datasets:[{data:y20d,backgroundColor:active.map(k=>PCOLORS[k]+'bb'),borderColor:active.map(k=>PCOLORS[k]),borderWidth:1,borderRadius:2},
              capDataset(p.cap,active.length)]
  },options:{...baseOpts('MW'),plugins:{legend:{display:false}},scales:{x:{...baseOpts().scales.x},y:{...baseOpts('MW').scales.y,min:0}}}});

  // Legend
  document.getElementById('traj-legend').innerHTML=[...active,'cap'].map(k=>{
    if(k==='cap') return `<span class="leg"><span style="display:inline-block;width:18px;height:0;border-bottom:2px dashed #d29922;margin-right:5px"></span>Feeder ${p.cap.toFixed(1)} MW</span>`;
    return `<span class="leg"><span class="leg-ln" style="background:${PCOLORS[k]}"></span>${PNAMES[k]}</span>`;
  }).join('');

  const y0=ringPeak(p);
  const nercNote = p.h0 >= 16
    ? ` At H₀ = ${p.h0.toFixed(0)} h/day this feeder has above-average supply. The suppressed demand delta is smaller than at the 6.6 h/day baseline, but BTM generator migration is supply-independent and still drives Day 1 loading.`
    : ` Raising H₀ models a better-served feeder and reduces the suppressed demand delta, but BTM migration persists regardless.`;
  document.getElementById('ins-traj').innerHTML=y0>p.cap
    ?`<b>Day 1 feeder overloading confirmed.</b> Year 0 peak of ${y0.toFixed(2)} MW exceeds the ${p.cap.toFixed(1)} MW rating.${nercNote} Embedded generation is a Day 1 capital commitment.`
    :`<b>Feeder within capacity at these parameters.</b> Year 0 peak of ${y0.toFixed(2)} MW is below the ${p.cap.toFixed(1)} MW rating.${nercNote} Note: Debt-Service Floor Year 20 (7.13 MW) is a decline from the 7.88 MW Day 1 baseline, reflecting negative net demand growth (−0.5%/yr) under sustained contraction.`;
}

// ── DIURNAL ───────────────────────────────────────────────────────────────────
function updateDiurnal(p){
  const prof=p.season==='dry'?DRY:p.season==='harm'?HARM:WET;
  const sc=pathMult(PATHS.find(k=>activePathways.has(k))||'ct',p.year);
  const ring=HOURS.map(h=>+((prof.A[h]+prof.B[h]+prof.C[h])*sc).toFixed(3));
  const capArr=Array(24).fill(p.cap);

  mkChart('ch-diurnal-zones',{type:'line',data:{
    labels:HR_LABELS,
    datasets:[
      {label:'Zone A',data:HOURS.map(h=>+(prof.A[h]*sc).toFixed(3)),borderColor:'#58a6ff',backgroundColor:'rgba(88,166,255,.06)',fill:true,tension:.3,pointRadius:0,borderWidth:2},
      {label:'Zone B',data:HOURS.map(h=>+(prof.B[h]*sc).toFixed(3)),borderColor:'#d29922',backgroundColor:'rgba(210,153,34,.06)',fill:true,tension:.3,pointRadius:0,borderWidth:2},
      {label:'Zone C',data:HOURS.map(h=>+(prof.C[h]*sc).toFixed(3)),borderColor:'#3fb950',backgroundColor:'rgba(63,185,80,.06)',fill:true,tension:.3,pointRadius:0,borderWidth:2},
      {label:'Ring',data:ring,borderColor:'#e6edf3',fill:false,tension:.3,pointRadius:0,borderWidth:2,borderDash:[4,2]},
      {label:'Cap',data:capArr,borderColor:'#d29922',fill:false,tension:0,pointRadius:0,borderWidth:1,borderDash:[3,3]},
    ]
  },options:{...baseOpts('MW'),plugins:{legend:{display:false}},
    scales:{x:{...baseOpts().scales.x,ticks:{color:'#8b949e',maxRotation:0}},y:{...baseOpts('MW').scales.y,min:0}}}
  });

  mkChart('ch-seasonal',{type:'line',data:{
    labels:HOURS.map(h=>h+':00'),
    datasets:[
      {label:'Hot-dry (Mar–Apr)',
       data:HOURS.map(h=>+(DRY.A[h]+DRY.B[h]+DRY.C[h]).toFixed(2)),
       borderColor:'#f0883e',backgroundColor:'transparent',
       fill:false,tension:.3,pointRadius:0,borderWidth:2},
      {label:'Harmattan (Nov–Feb)',
       data:HOURS.map(h=>+(HARM.A[h]+HARM.B[h]+HARM.C[h]).toFixed(2)),
       borderColor:'#e3b341',backgroundColor:'transparent',
       fill:false,tension:.3,pointRadius:0,borderWidth:2,borderDash:[4,3]},
      {label:'Wet (Jun–Sep)',
       data:HOURS.map(h=>+(WET.A[h]+WET.B[h]+WET.C[h]).toFixed(2)),
       borderColor:'#58a6ff',backgroundColor:'transparent',
       fill:false,tension:.3,pointRadius:0,borderWidth:2,borderDash:[8,3]},
      {label:'5 MW rating',data:HOURS.map(()=>5.0),
       borderColor:'#f85149',pointRadius:0,borderWidth:1.5,
       borderDash:[4,2],backgroundColor:'transparent',fill:false}
    ]
  },options:{...baseOpts('MW'),
    plugins:{legend:{display:true,labels:{color:'#8b949e',font:{size:9},boxWidth:10}}},
    scales:{x:{...baseOpts().scales.x,ticks:{...baseOpts().scales.x.ticks,maxTicksLimit:8}},
            y:{...baseOpts().scales.y,min:0}}}});

  // Multi-year diurnal overlay
  const yrCols={0:'#58a6ff',5:'#3fb950',10:'#d29922',20:'#f85149'};
  const activePath=PATHS.find(k=>activePathways.has(k))||'ct';
  mkChart('ch-diurnal-yrs',{type:'line',data:{
    labels:HR_LABELS,
    datasets:Object.entries(yrCols).map(([y,col])=>({
      label:'Year '+y,
      data:HOURS.map(h=>+((prof.A[h]+prof.B[h]+prof.C[h])*pathMult(activePath,+y)).toFixed(3)),
      borderColor:col,backgroundColor:'transparent',fill:false,
      tension:.3,pointRadius:0,borderWidth:+y===0?2.5:1.5,
      borderDash:+y===0?[]:[4,3],
    })).concat([{label:p.cap.toFixed(1)+' MW',data:Array(24).fill(p.cap),
      borderColor:'#d29922',fill:false,tension:0,pointRadius:0,borderWidth:1,borderDash:[3,3]}])
  },options:{...baseOpts('MW'),
    plugins:{legend:{display:true,labels:{color:'#8b949e',font:{size:9},boxWidth:10}}},
    scales:{x:{...baseOpts().scales.x,ticks:{...baseOpts().scales.x.ticks,maxTicksLimit:8}},
            y:{...baseOpts().scales.y,min:0}}}});

}

// ── DECOMPOSITION ─────────────────────────────────────────────────────────────
function updateDecomposition(p){
  const h0   = p.h0;
  const S    = p.S;
  const cf   = p.cf;
  const g    = p.gp/100;
  const hh   = zones.reduce((s,z)=>s+z.hh,0);
  const t2   = zones.filter(z=>z.tier===1).reduce((s,z)=>s+z.hh,0)/hh*100;
  const t4   = zones.filter(z=>z.tier===3).reduce((s,z)=>s+z.hh,0)/hh*100;

  // Per-zone peaks and BTM
  const zoneMap = {};
  zones.forEach(z=>{
    const bf   = btmFraction(z.tier, h0);
    const admd = liveADMD(z.tier);
    const kw   = (admd*bf*g + admd*(1-bf)*(S/3.64))*(cf/0.75);
    const pk   = z.hh * kw / 1000;
    const key  = z.tier===1?'A':z.tier===2?'B':'C';
    zoneMap[key] = {pk: pk, btm: z.hh*admd*bf*g/1000};
  });

  const zpeak = {A: zoneMap.A?zoneMap.A.pk:0, B: zoneMap.B?zoneMap.B.pk:0, C: zoneMap.C?zoneMap.C.pk:0};
  const zbtm  = {A: zoneMap.A?zoneMap.A.btm:0, B: zoneMap.B?zoneMap.B.btm:0, C: zoneMap.C?zoneMap.C.btm:0};
  const btmF  = {A: btmFraction(1,h0), B: btmFraction(2,h0), C: btmFraction(3,h0)};

  const total    = zpeak.A + zpeak.B + zpeak.C;
  const totalBtm = zbtm.A  + zbtm.B  + zbtm.C;

  // Stacked decomposition bar chart (Year 0)
  mkChart('ch-decomp-stack',{type:'bar',data:{
    labels:['Zone A\n(MTF 5)','Zone B\n(MTF 4)','Zone C\n(MTF 3)','Ring\nTotal'],
    datasets:[
      {label:'Organic load',
       data:[zpeak.A-zbtm.A, zpeak.B-zbtm.B, zpeak.C-zbtm.C, total-totalBtm],
       backgroundColor:'rgba(88,166,255,.70)',borderColor:'#58a6ff',borderWidth:1,borderRadius:2},
      {label:'BTM migration',
       data:[zbtm.A, zbtm.B, zbtm.C, totalBtm],
       backgroundColor:'rgba(210,153,34,.75)',borderColor:'#d29922',borderWidth:1,borderRadius:2},
    ]
  },options:{...baseOpts('MW'),
    plugins:{legend:{display:true,position:'bottom',labels:{color:'#8b949e',font:{size:9},boxWidth:10}}},
    scales:{x:{...baseOpts().scales.x,stacked:true},y:{...baseOpts('MW').scales.y,stacked:true,min:0}}}});

  // BTM fraction by zone
  mkChart('ch-btm-frac',{type:'bar',data:{
    labels:['Zone A\n(MTF 5)','Zone B\n(MTF 4)','Zone C\n(MTF 3)'],
    datasets:[{
      label:'BTM fraction',
      data:[(btmF.A*100).toFixed(1),(btmF.B*100).toFixed(1),(btmF.C*100).toFixed(1)],
      backgroundColor:['rgba(88,166,255,.7)','rgba(210,153,34,.7)','rgba(63,185,80,.7)'],
      borderColor:['#58a6ff','#d29922','#3fb950'],
      borderWidth:1,borderRadius:3,
    }]
  },options:{...baseOpts('%'),
    plugins:{legend:{display:false},
      tooltip:{callbacks:{label:i=>` ${i.parsed.y}% of zone peak is formerly off-grid`}}},
    scales:{x:{...baseOpts().scales.x},
            y:{min:0,max:100,title:{display:true,text:'BTM fraction (%)',color:'#8b949e',font:{size:9}},
               ticks:{color:'#8b949e',font:{size:9},callback:v=>v+'%'},
               grid:{color:'rgba(255,255,255,0.05)'}}}}});

  // Table
  const rows=[
    {z:'Zone A (MTF 5, 1,000 HH)',pk:zpeak.A,btm:zbtm.A,pct:(btmF.A*100).toFixed(0),kw:(zpeak.A*1000/Math.max(hh*t2/100,1)).toFixed(2)},
    {z:'Zone B (MTF 4, 2,000 HH)',pk:zpeak.B,btm:zbtm.B,pct:(btmF.B*100).toFixed(0),kw:(zpeak.B*1000/(hh*.5)).toFixed(2)},
    {z:'Zone C (MTF 3, 1,000 HH)',pk:zpeak.C,btm:zbtm.C,pct:(btmF.C*100).toFixed(0),kw:(zpeak.C*1000/Math.max(hh*t4/100,1)).toFixed(2)},
    {z:'Ring total',pk:total,btm:totalBtm,pct:((totalBtm/total)*100).toFixed(0),kw:(total*1000/hh).toFixed(2)},
  ];
  document.getElementById('decomp-tbody').innerHTML=rows.map(r=>`<tr>
    <td style="color:var(--text)">${r.z}</td>
    <td style="color:${r.pk>p.cap?'#f85149':'#3fb950'}">${r.pk.toFixed(2)} MW</td>
    <td style="color:#d29922">${r.btm.toFixed(2)} MW</td>
    <td>${r.pct}%</td>
    <td>${r.kw}</td>
    <td><div style="display:flex;gap:2px;align-items:center">
      <div style="width:${Math.min(+r.pct,100)*1.1}px;height:7px;background:#d29922;border-radius:1px"></div>
      <div style="width:${(100-Math.min(+r.pct,100))*1.1}px;height:7px;background:#58a6ff;border-radius:1px"></div>
    </div></td>
  </tr>`).join('');

  // Evolution chart
  const ey=[0,2,4,6,8,10,12,15,20];
  mkChart('ch-btm-evol',{type:'line',data:{
    labels:ey.map(y=>'Y'+y),
    datasets:[
      {label:'BTM migration',data:ey.map(y=>+(totalBtm*pathMult('ct',y)*Math.exp(-y/8)).toFixed(3)),borderColor:'#d29922',backgroundColor:'rgba(210,153,34,.1)',fill:true,tension:.3,pointRadius:3},
      {label:'Organic load',data:ey.map(y=>+(total*pathMult('ct',y)*(1-totalBtm/total*Math.exp(-y/8))).toFixed(3)),borderColor:'#58a6ff',backgroundColor:'rgba(88,166,255,.08)',fill:true,tension:.3,pointRadius:3},
    ]
  },options:{...baseOpts('MW'),plugins:{legend:{display:true,labels:{color:'#8b949e',boxWidth:12,font:{size:10}}}},
    scales:{x:{...baseOpts().scales.x},y:{...baseOpts('MW').scales.y,stacked:false,min:0}}}
  });

  document.getElementById('ins-decomp').innerHTML=
    `<b>${((totalBtm/total)*100).toFixed(0)}% of Year 0 peak (${totalBtm.toFixed(2)} MW) is formerly off-grid demand</b> that was always consumed but was invisible to any DISCO meter. Under franchise reliable supply it becomes fully grid-visible from Day 1. This fraction is price-insensitive: a generator-free household is simply consuming, not voluntarily paying a premium. Zone C's BTM fraction (${(btmF.C*100).toFixed(0)}%) reflects 60% Profile F households who went without electricity rather than self-generating.`;
}


// ── SENSITIVITY ───────────────────────────────────────────────────────────────
function updateSensitivity(p){
  const central=ringPeak(p);
  const params=[
    {lbl:'Coincidence CF',lo:ringPeak({...p,cf:.50}),hi:ringPeak({...p,cf:.85})},
    {lbl:'Generator factor γ',lo:ringPeak({...p,gp:40}),hi:ringPeak({...p,gp:100})},
    {lbl:'Supply scale S',lo:ringPeak({...p,S:2.00}),hi:ringPeak({...p,S:3.64})},
    {lbl:'Scale decay τ=3yr',lo:ringPeak({...p,S:p.S*.85}),hi:central},
    {lbl:'Latent demand λ=1.5',lo:central,hi:ringPeak({...p,S:p.S*1.5})},
    {lbl:'Appliance class scale',lo:ringPeak({...p,S:p.S*.88}),hi:central},
  ].sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo));

  const maxR=Math.max(...params.map(q=>q.hi-q.lo));
  document.getElementById('tornado').innerHTML=params.map(q=>{
    const w=((q.hi-q.lo)/maxR*100).toFixed(1);
    const loOk=q.lo<=p.cap?'#3fb950':'#f85149';
    const hiOk=q.hi<=p.cap?'#3fb950':'#f85149';
    return `<div class="torn-row">
      <div class="torn-lbl">${q.lbl}</div>
      <div class="torn-track"><div class="torn-bar" style="width:${w}%">
        <span class="torn-txt">${q.lo.toFixed(2)} – ${q.hi.toFixed(2)}</span>
      </div></div>
      <div class="torn-rng">${(q.hi-q.lo).toFixed(2)} MW</div>
    </div>`;
  }).join('');

  // Heatmap
  // H₀ axis: three representative NERC service band points
  // Band E (poor): 4h  →  Band D (moderate): 8h  →  Band B/C (high): 16h
  // S = λ × 24/H₀: shows how unlocked demand shrinks as existing service improves
  const H0vals=[4.0, 8.0, 16.0];  // poor / moderate / high service
  const Sv=H0vals.map(h=>+(p.lam*24/h).toFixed(2));
  const CFv=[0.50,0.65,0.85];
  // H0 values represent actual metered supply hours, not DisCo band allocations
  const bandLabels={4.0:'4h actual\n(~Band E)', 8.0:'8h actual\n(~Band D)', 16.0:'16h actual\n(~Band B)'};
  let hm=`<div class="hm-grid" style="grid-template-columns:60px repeat(3,1fr)">
    <div class="hm-ax" style="font-size:8px">CF \\ H₀</div>
    ${H0vals.map((h,i)=>`<div class="hm-ax" style="flex-direction:column;gap:2px">
      <span style="font-size:8px;color:var(--text)">${bandLabels[h]}</span>
      <span style="font-size:8px;color:var(--muted)">S=${Sv[i].toFixed(1)}</span>
    </div>`).join('')}`;
  CFv.forEach(cf=>{
    hm+=`<div class="hm-ax">CF=${cf.toFixed(2)}</div>`;
    Sv.forEach((s,si)=>{
      const v=ringPeak({...p,cf,S:s});
      const over=v>p.cap;
      hm+=`<div class="hm-cell" style="background:${over?'rgba(248,81,73,.22)':'rgba(63,185,80,.18)'};color:${over?'#f85149':'#3fb950'}">${v.toFixed(2)}<br><span style="font-size:8px;opacity:.7">MW</span></div>`;
    });
  });
  hm+=`</div>
  <div style="margin-top:8px;font-size:9px;color:var(--muted);line-height:1.7">
    <span style="color:#f85149">■</span> above ${p.cap.toFixed(1)} MW feeder rating &nbsp;
    <span style="color:#3fb950">■</span> within capacity &nbsp;·&nbsp;
    H₀ = actual metered average supply hours (not DisCo band allocation) · use 12-month rolling average.
    At 4h/day actual, the unsuppressed demand delta is large; at 16h/day actual it shrinks substantially.
    <b style="color:var(--text)">Key insight:</b> even at 16h/day actual supply, overloading persists at CF ≥ 0.65
    because BTM generator migration to the grid is supply-independent — it happens regardless of H₀.
  </div>`;
  document.getElementById('heatmap').innerHTML=hm;

  renderMC(p);

  // Ensemble (stochastic seed check)
  const seeds=Array.from({length:10},(_,i)=>+(central*(1+(Math.sin(i*137.5)*.037))).toFixed(3));
  seeds.sort((a,b)=>a-b);
  mkChart('ch-ensemble',{type:'bar',data:{
    labels:seeds.map((_,i)=>'seed '+i),
    datasets:[{data:seeds,
      backgroundColor:seeds.map(v=>v>p.cap?'rgba(248,81,73,.6)':'rgba(88,166,255,.6)'),
      borderColor:seeds.map(v=>v>p.cap?'#f85149':'#58a6ff'),
      borderWidth:1,borderRadius:2},
      capDataset(p.cap,seeds.length)]
  },options:{...baseOpts('MW'),plugins:{legend:{display:false}},
    scales:{x:{...baseOpts().scales.x,ticks:{maxRotation:45}},y:{...baseOpts('MW').scales.y,min:Math.max(0,central*.9)}}}
  });
}


// ── MC SENSITIVITY CHARTS ────────────────────────────────────────────────────
function renderMC(p){
  const CAP = p.cap;

  // Pre-computed N=50,000 MC histogram (H0~LN(ln7,0.6) clipped [2,22],
  // lambda~U[1,1.3], CF~Beta(7,3)->[0.5,0.9], gamma~U[0.4,1.0])
  const centres = [2.3, 2.9, 3.5, 4.1, 4.7, 5.3, 5.9, 6.5, 7.1, 7.7, 8.3, 8.9, 9.5, 10.1, 10.7, 11.3, 11.9, 12.5, 13.1, 13.7, 14.3, 14.9, 15.5, 16.1, 16.7, 17.3, 17.9, 18.5, 19.1, 19.7];
  const counts  = [0, 75, 706, 1492, 1784, 2281, 2916, 3545, 4067, 4303, 4177, 3850, 3470, 2974, 2477, 2134, 1864, 1569, 1397, 1170, 936, 777, 590, 464, 350, 247, 175, 119, 48, 26];
  const total   = counts.reduce((a,b)=>a+b,0);

  // Colour bars: red if above current cap, else blue
  const barCols = centres.map(c => c > CAP ? 'rgba(248,81,73,.75)' : 'rgba(88,166,255,.65)');

  mkChart('ch-mc-hist',{type:'bar',data:{
    labels: centres.map(c=>c.toFixed(1)),
    datasets:[{
      data: counts,
      backgroundColor: barCols,
      borderColor: barCols,
      borderWidth: 0,
      borderRadius: 1,
    }]
  },options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{callbacks:{
        title:i=>'Peak: '+i[0].label+' MW',
        label:i=>' Draws: '+i.parsed.y.toLocaleString()+' ('+
          (i.parsed.y/total*100).toFixed(1)+'%)'
      }}
    },
    scales:{
      x:{ticks:{color:'#8b949e',font:{size:8},maxTicksLimit:10},
          grid:{color:'rgba(255,255,255,0.04)'},
          title:{display:true,text:'Year 0 ring peak (MW)',color:'#8b949e',font:{size:9}}},
      y:{ticks:{color:'#8b949e',font:{size:8}},
          grid:{color:'rgba(255,255,255,0.04)'},
          title:{display:true,text:'Draw count',color:'#8b949e',font:{size:9}}}
    }
  }});

  // Variance attribution: Spearman rho² (pre-computed)
  const rhoData = [
    {label:'H₀ supply hrs',  rho: -0.961, rho2: 0.923, col:'#f85149'},
    {label:'CF coincidence', rho:  0.192, rho2: 0.037, col:'#58a6ff'},
    {label:'λ latent demand',rho:  0.126, rho2: 0.016, col:'#79c0ff'},
    {label:'γ gen. factor',  rho: -0.043, rho2: 0.002, col:'#8b949e'},
  ];
  mkChart('ch-mc-rho',{type:'bar',data:{
    labels: rhoData.map(d=>d.label),
    datasets:[{
      label:'ρ² (variance explained)',
      data: rhoData.map(d=>+(d.rho2*100).toFixed(1)),
      backgroundColor: rhoData.map(d=>d.col+'bb'),
      borderColor: rhoData.map(d=>d.col),
      borderWidth:1, borderRadius:3,
    }]
  },options:{
    indexAxis:'y',
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{callbacks:{label:i=>' ρ²='+i.parsed.x.toFixed(1)+'% · ρ='+rhoData[i.dataIndex].rho.toFixed(3)}}
    },
    scales:{
      x:{min:0,max:100,ticks:{color:'#8b949e',font:{size:9},callback:v=>v+'%'},
          grid:{color:'rgba(255,255,255,0.04)'},
          title:{display:true,text:'Variance explained (%)',color:'#8b949e',font:{size:9}}},
      y:{ticks:{color:'#8b949e',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}}
    }
  }});

  // Band-stratified P(overloaded)
  // Pre-computed at CAP=5MW; shown as reference bars
  const bands = [
    {label:'Band A\n≥20h',  pct:1,   n:4,  col:'#3fb950'},
    {label:'Band B\n16-20h',pct:37,  n:4,  col:'#79c0ff'},
    {label:'Band C\n12-16h',pct:89,  n:10, col:'#58a6ff'},
    {label:'Band D\n8-12h', pct:100, n:23, col:'#d29922'},
    {label:'Band E\n<8h',   pct:100, n:59, col:'#f85149'},
  ];
  mkChart('ch-mc-band',{type:'bar',data:{
    labels: bands.map(b=>b.label),
    datasets:[{
      label:'P(peak > '+CAP.toFixed(1)+' MW)',
      data: bands.map(b=>b.pct),
      backgroundColor: bands.map(b=>b.col+'bb'),
      borderColor: bands.map(b=>b.col),
      borderWidth:1, borderRadius:3,
    },{
      label:'% of MC draws',
      data: bands.map(b=>b.n),
      backgroundColor: 'rgba(139,148,158,0.25)',
      borderColor: '#8b949e',
      borderWidth:1, borderRadius:3,
      yAxisID:'y2',
    }]
  },options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:true,position:'bottom',labels:{color:'#8b949e',font:{size:9},boxWidth:10}},
      tooltip:{callbacks:{label:i=>i.datasetIndex===0?
        ' P(overloaded): '+i.parsed.y+'%':
        ' Share of MC draws: '+i.parsed.y+'%'}}
    },
    scales:{
      x:{ticks:{color:'#8b949e',font:{size:8},maxRotation:0},grid:{color:'rgba(255,255,255,0.04)'}},
      y:{min:0,max:105,title:{display:true,text:'P(peak > 5 MW) %',color:'#8b949e',font:{size:9}},
          ticks:{color:'#8b949e',font:{size:9},callback:v=>v+'%'},grid:{color:'rgba(255,255,255,0.04)'}},
      y2:{min:0,max:105,position:'right',title:{display:true,text:'% of draws',color:'#8b949e',font:{size:9}},
           ticks:{color:'#8b949e',font:{size:9},callback:v=>v+'%'},grid:{display:false}}
    }
  }});

  // Summary table
  const rows = [
    ['P10', '5.27 MW'],['P25', '6.76 MW'],['Median', '8.55 MW'],
    ['Mean', '8.98 MW'],['P75', '10.84 MW'],['P90', '13.35 MW'],
    ['P(>5MW)', '<span style="color:#f85149;font-weight:600">91.9%</span>'],
    ['P(>7.88MW)', '59.5%'],
  ];
  document.getElementById('mc-summary').innerHTML =
    rows.map(([k,v])=>
      `<div style="display:flex;justify-content:space-between;padding:1px 8px;border-bottom:1px solid var(--border)">
        <span style="color:var(--muted)">${k}</span><span style="color:var(--text)">${v}</span>
      </div>`
    ).join('') +
    `<div style="padding:6px 8px;font-size:9px;color:var(--muted);line-height:1.5">
      H₀ ~ LogNormal(μ=ln7, σ=0.6) · λ ~ U[1.0,1.3]<br>
      CF ~ Beta(7,3)→[0.50,0.90] · γ ~ U[0.40,1.00]<br>
      N = 50,000 draws · central 7.88 MW = 56th %ile
    </div>`;
}

// ── BTM TAXONOMY ──────────────────────────────────────────────────────────────
function buildBTMPanel(){
  const profs=[
    {id:'A',name:'Generator only',desc:'Grid tariff far below diesel cost. Generator stops. Full demand now grid-drawn from Day 1.',tag:'migrates to grid',tc:'rgba(248,81,73,.15)',tx:'#f85149'},
    {id:'B',name:'Generator + inverter',desc:'Generator and inverter both cease netting. Battery charging from reliable grid has no benefit over direct draw.',tag:'migrates to grid',tc:'rgba(248,81,73,.15)',tx:'#f85149'},
    {id:'C',name:'Gen + Solar + BESS',desc:'Generator stops; free solar energy continues netting regardless of grid reliability. Net grid draw reduced.',tag:'partial netting',tc:'rgba(210,153,34,.15)',tx:'#d29922'},
    {id:'D',name:'Solar + BESS only',desc:'Solar continues netting free energy. No generator to switch off. Profile reduces net grid draw throughout concession.',tag:'continues netting',tc:'rgba(63,185,80,.15)',tx:'#3fb950'},
    {id:'E',name:'Inverter only',desc:'No solar, no generator. Inverter ceases netting. Full demand grid-drawn from Day 1.',tag:'migrates to grid',tc:'rgba(248,81,73,.15)',tx:'#f85149'},
    {id:'F',name:'No BTM assets',desc:'Went without electricity during outages. Day 1 contribution is utilisation release of previously suppressed demand, not BTM migration.',tag:'utilisation release',tc:'rgba(88,166,255,.15)',tx:'#58a6ff'},
  ];
  document.getElementById('prof-grid').innerHTML=profs.map(r=>`
    <div class="prof-card">
      <div class="prof-id">${r.id}</div>
      <div class="prof-name">${r.name}</div>
      <div class="prof-desc">${r.desc}</div>
      <span class="prof-tag" style="background:${r.tc};color:${r.tx};border:1px solid ${r.tx}">${r.tag}</span>
    </div>`).join('');

  const pieLabels=['A: Gen only','B: Gen+Inv','C: Gen+Sol+BESS','D: Solar+BESS','E: Inv only','F: None'];
  const pieCols=['rgba(248,81,73,.8)','rgba(248,81,73,.6)','rgba(210,153,34,.75)','rgba(63,185,80,.7)','rgba(248,81,73,.45)','rgba(88,166,255,.6)'];
  const pieOpts={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'right',labels:{color:'#8b949e',boxWidth:11,font:{size:9},padding:6}}},cutout:'52%'};

  mkChart('ch-pie-a',{type:'doughnut',data:{labels:pieLabels,datasets:[{data:[.19,.14,.18,.15,.12,.22],backgroundColor:pieCols,borderColor:'#0d1117',borderWidth:2}]},options:pieOpts});
  mkChart('ch-pie-b',{type:'doughnut',data:{labels:pieLabels,datasets:[{data:[.12,.08,.09,.08,.10,.53],backgroundColor:pieCols,borderColor:'#0d1117',borderWidth:2}]},options:pieOpts});

  const ry=[0,1,2,3,4,5,6,7,8,10,12,15,20];
  mkChart('ch-retire',{type:'line',data:{labels:ry.map(y=>'Y'+y),datasets:[
    {label:'Gen-owning (A+B+C)',data:ry.map(y=>+(.51*Math.exp(-y/4.5)).toFixed(3)),borderColor:'#f85149',fill:false,tension:.3,pointRadius:3},
    {label:'Solar-netting (C+D)',data:ry.map(y=>+(.33*Math.exp(-y/9)).toFixed(3)),borderColor:'#3fb950',fill:false,tension:.3,pointRadius:3,borderDash:[4,2]},
    {label:'New prosumer solar',data:ry.map(y=>+(Math.min(y*.035*.4,.35)).toFixed(3)),borderColor:'#bc8cff',fill:false,tension:.3,pointRadius:3,borderDash:[2,2]},
  ]},options:{...baseOpts('fraction of HH'),plugins:{legend:{display:true,labels:{color:'#8b949e',boxWidth:11,font:{size:9}}}},scales:{x:{...baseOpts().scales.x},y:{...baseOpts().scales.y,min:0,max:.65}}}});
}

// ── CARBON ────────────────────────────────────────────────────────────────────
function updateCarbon(p){
  var mixEl = document.getElementById('c-mix');
  var mixKey = mixEl ? mixEl.value : 'central';

  // Populate all three scenario KPIs
  var keys = ['floor','central','upper'];
  for(var ki=0; ki<keys.length; ki++){
    var k = keys[ki];
    var co2k = co2Lookup(p, k);
    var el = document.getElementById('c-tco2-'+k);
    if(el) el.textContent = Math.round(co2k).toLocaleString()+' t';
  }

  // Main header KPI uses selected mix
  var tco2sel = co2Lookup(p, mixKey);
  var el_tco2 = document.getElementById('c-tco2');
  var el_lo   = document.getElementById('c-lo');
  var el_hi   = document.getElementById('c-hi');
  if(el_tco2) el_tco2.textContent = Math.round(tco2sel).toLocaleString()+' t';
  if(el_lo)   el_lo.textContent   = '$'+(tco2sel*8/1000).toFixed(0)+'k';
  if(el_hi)   el_hi.textContent   = '$'+(tco2sel*15/1000).toFixed(0)+'k';

  var ey=[0,2,4,6,8,10,12,15,20];
  var active=[...activePathways];

  // Carbon trajectory — central line + floor/upper as bounding dashes
  var dsCentral = active.map(function(k){ return {
    label:PNAMES[k],
    data:ey.map(function(y){
      var pkY=trajPeak(k,y,p);
      return +(btmMW(pkY,p.gp)*Math.exp(-y/8)*8760*.52*1000*DEF_EF['central']*1e-3*0.325*15/1000).toFixed(1);
    }),
    borderColor:PCOLORS[k],backgroundColor:'transparent',fill:false,
    tension:.3,pointRadius:3,borderDash:PDASH[k],
  };});
  var dsFloor = active.map(function(k){ return {
    label:PNAMES[k]+' (floor)',
    data:ey.map(function(y){
      var pkY=trajPeak(k,y,p);
      return +(btmMW(pkY,p.gp)*Math.exp(-y/8)*8760*.52*1000*DEF_EF['floor']*1e-3*0.325*15/1000).toFixed(1);
    }),
    borderColor:PCOLORS[k]+'55',backgroundColor:'transparent',fill:false,
    tension:.3,pointRadius:0,borderDash:[3,3],
  };});
  var dsUpper = active.map(function(k){ return {
    label:PNAMES[k]+' (upper)',
    data:ey.map(function(y){
      var pkY=trajPeak(k,y,p);
      return +(btmMW(pkY,p.gp)*Math.exp(-y/8)*8760*.52*1000*DEF_EF['upper']*1e-3*0.325*15/1000).toFixed(1);
    }),
    borderColor:PCOLORS[k]+'55',backgroundColor:PCOLORS[k]+'14',fill:'-1',
    tension:.3,pointRadius:0,borderDash:[2,2],
  };});

  mkChart('ch-carbon-traj',{type:'line',data:{
    labels:ey.map(function(y){return 'Y'+y;}),
    datasets:dsFloor.concat(dsCentral).concat(dsUpper)
  },options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{callbacks:{label:function(i){return ' $'+i.parsed.y+'k/yr';}}}
    },
    scales:{
      x:{ticks:{color:'#8b949e',font:{size:9}},grid:{color:'rgba(255,255,255,0.05)'}},
      y:{min:0,title:{display:true,text:'$k / yr at $15/t · band = floor–upper mix',color:'#8b949e',font:{size:9}},
         ticks:{color:'#8b949e',font:{size:9}},grid:{color:'rgba(255,255,255,0.05)'}}
    }
  }});

  // Emission factor chart — project EF and delta EF for each mix
  mkChart('ch-ef',{type:'bar',data:{
    labels:['Fleet EF (baseline)','Large diesel (LB)','Petrol IPMN 2kVA',
            'Grid CDM ref','Proj EF floor','Proj EF central','Proj EF upper',
            'DEF floor','DEF central','DEF upper'],
    datasets:[{
      data:[EF_FLEET, EF_DIESEL_LB, 1.09, 0.43,
            DEF_PROJ_EF.floor, DEF_PROJ_EF.central, DEF_PROJ_EF.upper,
            DEF_EF.floor, DEF_EF.central, DEF_EF.upper],
      backgroundColor:[
        'rgba(248,81,73,.80)',
        'rgba(248,81,73,.45)',
        'rgba(248,130,73,.55)',
        'rgba(139,148,158,.55)',
        'rgba(139,148,158,.40)',
        'rgba(88,166,255,.60)',
        'rgba(63,185,80,.65)',
        'rgba(248,81,73,.28)',
        'rgba(88,166,255,.38)',
        'rgba(63,185,80,.42)',
      ],borderRadius:3
    }]
  },options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},
      tooltip:{callbacks:{label:function(i){
        return ' '+i.parsed.y.toFixed(3)+' kg CO\u2082/kWh';}}}
    },
    scales:{
      x:{ticks:{color:'#8b949e',font:{size:8},maxRotation:45},
         grid:{color:'rgba(255,255,255,0.05)'}},
      y:{min:0,max:1.40,
         title:{display:true,text:'kg CO\u2082 / kWh',color:'#8b949e',font:{size:9}},
         ticks:{color:'#8b949e',font:{size:9}},
         grid:{color:'rgba(255,255,255,0.05)'}}
    }
  }})
}

// ── PROFILE EXPLORER ──────────────────────────────────────────────────────────
let peOverlay = new Set(['ct']);  // which pathways are overlaid on the main chart

function toggleOverlay(k){
  const el = document.getElementById('pe-overlay-'+k);
  if(peOverlay.has(k)){
    peOverlay.delete(k);
    el.style.borderColor='#30363d'; el.style.color='#8b949e'; el.style.background='transparent';
  } else {
    peOverlay.add(k);
    el.style.borderColor=PCOLORS[k]; el.style.color=PCOLORS[k];
    el.style.background=PCOLORS[k].replace('#','rgba(').replace(/(..)(..)(..)/, (_,r,g,b)=>
      `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`)+',0.12)';
  }
  updateProfileExplorer();
}

function profileData(path, year, season, zone, p){
  // Returns hourly MW array for given pathway/year/season/zone
  const prof = season === 'dry' ? DRY
             : season === 'harm' ? HARM
             : WET;
  const sc = pathMult(path, year);
  // Scale each zone's absolute profile by the peak ratio at this year/path vs Y0
  const y0peak = ringPeak(p);
  const yrPeak = y0peak * sc;
  const scaleRatio = yrPeak / (ringPeak({...p, S:3.64, cf:0.75, gp:100}));

  if(zone === 'A') return HOURS.map(h => +(prof.A[h] * sc).toFixed(3));
  if(zone === 'B') return HOURS.map(h => +(prof.B[h] * sc).toFixed(3));
  if(zone === 'C') return HOURS.map(h => +(prof.C[h] * sc).toFixed(3));
  if(zone === 'AB') return HOURS.map(h => +((prof.A[h]+prof.B[h]) * sc).toFixed(3));
  // ring or all → ring aggregate
  return HOURS.map(h => +((prof.A[h]+prof.B[h]+prof.C[h]) * sc).toFixed(3));
}

function updateProfileExplorer(){
  const p = P();
  const path   = document.getElementById('pe-path').value;
  const year   = +document.getElementById('pe-year').value;
  const season = document.getElementById('pe-season').value;
  const zones  = document.getElementById('pe-zones').value;

  const HR = HOURS.map(h => h+':00');
  const HRLBL = HOURS.map(h => h%3===0 ? h+':00' : '');

  // ── Main chart: overlaid pathways, selected year/season/zone ──
  const overlayPaths = [...peOverlay];
  const datasets = overlayPaths.map(k => ({
    label: PNAMES[k],
    data: profileData(k, year, season, zones==='all'?'ring':zones, p),
    borderColor: PCOLORS[k],
    backgroundColor: 'transparent',
    fill: false,
    tension: 0.35,
    pointRadius: 0,
    borderWidth: k===path ? 2.5 : 1.5,
    borderDash: PDASH[k],
  }));

  // If zones=all, add individual zone lines for selected pathway
  if(zones === 'all'){
    [['A','#58a6ff'],['B','#d29922'],['C','#3fb950']].forEach(([z,col])=>{
      datasets.push({
        label: 'Zone '+z,
        data: profileData(path, year, season, z, p),
        borderColor: col,
        backgroundColor: col.replace('#','rgba(').replace(/(..)(..)(..)/, (_,r,g,b)=>
          `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`)+',0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
        borderDash: [],
      });
    });
    // Ring aggregate for selected pathway on top
    datasets.push({
      label: 'Ring ('+PNAMES[path].split(' ')[0]+')',
      data: profileData(path, year, season, 'ring', p),
      borderColor: '#e6edf3',
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 2.5,
      borderDash: [4,2],
    });
  }

  datasets.push(capDataset(p.cap, 24));

  mkChart('ch-pe-main', {
    type:'line',
    data:{ labels:HRLBL, datasets },
    options:{
      ...baseOpts('MW'),
      plugins:{ legend:{ display:true, labels:{ color:'#8b949e', boxWidth:12, font:{size:9}, padding:8 } } },
      scales:{
        x:{grid:{color:GC}, ticks:{color:'#8b949e', maxRotation:0}},
        y:{grid:{color:GC}, ticks:{color:'#8b949e'}, min:0,
           title:{display:true,text:'MW',color:'#8b949e',font:{size:10}}}
      }
    }
  });

  // ── Year sweep: same pathway, Y0/Y5/Y10/Y15/Y20 ──
  const sweepYrs = [0,5,10,15,20];
  const sweepCols = ['#8b949e','#58a6ff','#d29922','#f85149','#bc8cff'];
  mkChart('ch-pe-sweep',{
    type:'line',
    data:{
      labels: HRLBL,
      datasets: [
        ...sweepYrs.map((y,i)=>({
          label:'Year '+y,
          data: profileData(path, y, season, zones==='all'?'ring':zones, p),
          borderColor: sweepCols[i],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: y===year ? 2.5 : 1.5,
          borderDash: y===year ? [] : (y===0?[3,2]:[]),
        })),
        capDataset(p.cap, 24)
      ]
    },
    options:{
      ...baseOpts('MW'),
      plugins:{legend:{display:true,labels:{color:'#8b949e',boxWidth:10,font:{size:9},padding:6}}},
      scales:{
        x:{grid:{color:GC},ticks:{color:'#8b949e',maxRotation:0}},
        y:{grid:{color:GC},ticks:{color:'#8b949e'},min:0}
      }
    }
  });

  // ── Bar: hourly peak vs capacity ──
  const ringArr = profileData(path, year, season, zones==='all'?'ring':zones, p);
  mkChart('ch-pe-bar',{
    type:'bar',
    data:{
      labels: HOURS.map(h=>h+':00'),
      datasets:[
        {
          label:'Demand',
          data: ringArr,
          backgroundColor: ringArr.map(v => v > p.cap ? 'rgba(248,81,73,0.7)' : 'rgba(88,166,255,0.55)'),
          borderColor: ringArr.map(v => v > p.cap ? '#f85149' : '#58a6ff'),
          borderWidth: 1,
          borderRadius: 1,
        },
        capDataset(p.cap, 24)
      ]
    },
    options:{
      ...baseOpts('MW'),
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{color:GC},ticks:{color:'#8b949e',maxRotation:45,font:{size:8}}},
        y:{grid:{color:GC},ticks:{color:'#8b949e'},min:0,
           title:{display:true,text:'MW',color:'#8b949e',font:{size:10}}}
      }
    }
  });

  // Insight text
  const ringData = profileData(path, year, season, 'ring', p);
  const pkMW = Math.max(...ringData).toFixed(2);
  const pkHr = ringData.indexOf(Math.max(...ringData));
  const overHrs = ringData.filter(v=>v>p.cap).length;
  document.getElementById('ins-pe').innerHTML =
    `<b>${PNAMES[path]} · Year ${year} · ${season==='dry'?'Hot-dry':season==='harm'?'Harmattan':'Wet'} season.</b> `+
    `Ring-aggregate peak: <b>${pkMW} MW</b> at ${pkHr}:00. `+
    (overHrs>0
      ? `<b style="color:#f85149">${overHrs} hours exceed the ${p.cap.toFixed(1)} MW feeder rating</b> — embedded generation required throughout these hours. `
      : `All hours within the ${p.cap.toFixed(1)} MW feeder rating at these parameters. `)+
    `${season==='dry'?'Hot-dry season (Mar–Apr): peak sandcrete nocturnal thermal release 18:00–03:00; highest AC demand. Peak = 5.66 MW.':season==='harm'?'Harmattan (Nov–Feb): cooler and dusty. AC demand ~76% of hot-dry; 25% less solar irradiance (tau_dust=0.75) reduces BESS charging. Peak = 5.40 MW.':'Wet season (Jun–Sep): cloud cover suppresses solar; cooler temperatures reduce AC. Sandcrete nocturnal effect minimal. Peak = 4.84 MW.'} `+
    `Use the year slider to step through the concession and watch the WFH plateau deepen and the evening peak grow as BTM assets age out.`;
}

// ── MAIN UPDATE ───────────────────────────────────────────────────────────────
function updateAll(){
  const p=P();
  // Primary observable labels
  document.getElementById('lbl-hh').textContent=zones.reduce((s,z)=>s+z.hh,0).toLocaleString();
  document.getElementById('lbl-h0').textContent=(+p.h0).toFixed(1)+' h/day';
  document.getElementById('lbl-cap').textContent=(+p.cap).toFixed(1)+' MW';
  document.getElementById('lbl-cf').textContent=(+p.cf).toFixed(2);
  document.getElementById('lbl-lam').textContent=(+p.lam).toFixed(2)+'×';
  document.getElementById('lbl-gp').textContent=p.gp+'%';

  // NERC service band classification from H₀
  const h0 = p.h0;
  let nercBand, nercCol;
  // 'Equiv.' prefix clarifies these are actual metered hours mapped to nearest NERC band
  if      (h0 >= 20) { nercBand = '≈ Band A actual (≥20 h/day)'; nercCol = '#3fb950'; }
  else if (h0 >= 16) { nercBand = '≈ Band B actual (16–20 h/day)'; nercCol = '#79c0ff'; }
  else if (h0 >= 12) { nercBand = '≈ Band C actual (12–16 h/day)'; nercCol = '#58a6ff'; }
  else if (h0 >= 8)  { nercBand = '≈ Band D actual (8–12 h/day)';  nercCol = '#d29922'; }
  else if (h0 >= 4)  { nercBand = '≈ Band E actual (4–8 h/day)';   nercCol = '#f0883e'; }
  else               { nercBand = 'Below Band E actual (<4 h/day)';     nercCol = '#f85149'; }
  const nbEl = document.getElementById('lbl-nerc-band');
  // Compute weighted BTM fraction at current H0 for display
  const totalHH2 = zones.reduce((s,z)=>s+z.hh,0);
  const wtdBtm = zones.reduce((s,z)=>s+z.hh*btmFraction(z.tier,h0),0)/Math.max(totalHH2,1);
  const btmNote = h0>H0_BTM_REF
    ? ` · BTM↓${(wtdBtm*100).toFixed(0)}% (was ${(BTM_F0[3]*100).toFixed(0)}% at 6.6h)`
    : '';
  if(nbEl) nbEl.innerHTML = `<span style="color:${nercCol}">\u25cf ${nercBand} \u00b7 use 12-month avg${btmNote}</span>`;

  // λ anticorrelation warning: λ>1.1 at high H₀ is physically implausible
  const lamEl = document.getElementById('lbl-lam-note');
  if(lamEl){
    if(p.lam <= 1.0){
      lamEl.innerHTML = '<span style="color:var(--muted)">\u03bb = 1: proportional scaling only</span>';
    } else if(p.lam > 1.1 && h0 > 14){
      lamEl.innerHTML = `<span style="color:#f85149">\u26a0 \u03bb>${p.lam.toFixed(2)} with H\u2080=${h0.toFixed(1)}h is implausible — households already near full appliance ownership at ${h0.toFixed(0)} h/day supply</span>`;
    } else if(p.lam > 1.0 && h0 > 14){
      lamEl.innerHTML = `<span style="color:#d29922">\u26a0 \u03bb modest but H\u2080 is high — latent demand effect diminishes above 14 h/day</span>`;
    } else {
      lamEl.innerHTML = `<span style="color:var(--muted)">\u03bb>${p.lam.toFixed(2)}: +${((p.lam-1)*100).toFixed(0)}% latent demand above proportional scaling</span>`;
    }
  }

  // Derived S₀ shown read-only under the H₀ slider
  const Sprop = (24/p.h0).toFixed(2);
  const Seff  = p.S.toFixed(2);
  const SeffNum = +Seff;
  const SderEl  = document.getElementById('lbl-S-derived');
  const SeffEl  = document.getElementById('lbl-S-eff');
  if(SderEl) SderEl.textContent = Sprop;
  if(SeffEl){
    let warn = '';
    if(SeffNum <= 1.05) warn = ' (near-zero delta — feeder near full service)';
    else if(SeffNum < 1.5 && p.lam === 1.0) warn = ' (small delta — high existing service)';
    SeffEl.textContent = '= ' + Seff + warn;
    SeffEl.style.color = SeffNum <= 1.2 ? '#3fb950' : SeffNum <= 2.5 ? '#d29922' : '#f85149';
  }

  updateKPIs(p);
  updateTrajectory(p);
  updateDiurnal(p);
  updateDecomposition(p);
  updateSensitivity(p);
  updateCarbon(p);
  renderTariff();
}

// ── TARIFF SENSITIVITY ────────────────────────────────────────────────────────
(function(){

const BAND_RATES  = {A:225, B:63, C:50, D:45, E:40};
const BAND_LABELS = {A:'A ≥20h', B:'B 16–20h', C:'C 12–16h', D:'D 8–12h', E:'E 4–8h'};
const BAND_COLS   = {A:'#3fb950', B:'#79c0ff', C:'#58a6ff', D:'#d29922', E:'#f0883e'};
const DIESEL_NGN  = 750;
const ETA         = -0.23;
const LF          = 0.62;
const ADMD_T      = {1:2.55, 2:1.934, 3:1.462};
const BTM_F0_T    = {1:0.72, 2:0.617, 3:0.526};
const ZONES_CEN_T = [[1,1000],[2,2000],[3,1000]];

function btmFracT(tier, h0){
  var f0=BTM_F0_T[tier], fl=f0*0.40, HR=6.6;
  if(h0<=HR) return f0 + f0*0.15*Math.max(0,Math.min(1,(HR-h0)/(HR-2)));
  return f0 - (f0-fl)*Math.min(1,(h0-HR)/(24-HR));
}

function peakMWT(h0, cf){
  cf = cf||0.75;
  var S=Math.max(1.0,24/h0), SR=3.636, total=0;
  for(var i=0;i<ZONES_CEN_T.length;i++){
    var t=ZONES_CEN_T[i][0], hh=ZONES_CEN_T[i][1];
    var a=ADMD_T[t], b=btmFracT(t,h0);
    total += hh*(a*b + a*(1-b)*(S/SR))*(cf/0.75)/1000;
  }
  return total;
}

function annualRevBnT(pk, tariff){
  return pk * LF * 8760 * 1000 * tariff / 1e9;
}

function ringBTMfracT(h0){
  var pk=peakMWT(h0), S=Math.max(1.0,24/h0), SR=3.636, btmMW=0;
  for(var i=0;i<ZONES_CEN_T.length;i++){
    var t=ZONES_CEN_T[i][0], hh=ZONES_CEN_T[i][1];
    var a=ADMD_T[t], b=btmFracT(t,h0);
    btmMW += hh*(a*b)*(0.75/0.75)/1000;
  }
  return pk>0 ? btmMW/pk : 0.63;
}

function adjPeakT(h0, tariff, refTariff, btmF){
  var pk=peakMWT(h0);
  var delta = ETA*((tariff-refTariff)/refTariff)*(1-btmF);
  return Math.max(0, pk*(1+delta));
}

var chTrRev=null, chTrDemand=null, chTrHeat=null, chTrCost=null;

window.renderTariff = function(){
  var bandEl = document.getElementById('tr-band');
  if(!bandEl) return;

  var band     = bandEl.value;
  var prem     = parseInt(document.getElementById('tr-prem').value)/100;
  var fx       = parseInt(document.getElementById('tr-fx').value);
  var baseRate = BAND_RATES[band];
  var fracTar  = baseRate * prem;
  var h0el     = document.getElementById('sl-h0');
  var h0       = h0el ? parseFloat(h0el.value) : 6.6;
  var cfel     = document.getElementById('sl-cf');
  var cf       = cfel ? parseFloat(cfel.value) : 0.75;
  var btmF     = ringBTMfracT(h0);
  var pkCen    = peakMWT(h0, cf);
  var MC_P10F  = 5.06/7.88;
  var MC_P90F  = 12.49/7.88;
  var pkP10    = pkCen * MC_P10F;
  var pkP90    = pkCen * MC_P90F;
  var adjPk    = adjPeakT(h0, fracTar, baseRate, btmF);
  var revCen   = annualRevBnT(adjPk, fracTar);
  var revFloor = annualRevBnT(pkCen*btmF, fracTar);
  var saving   = (DIESEL_NGN - fracTar)/DIESEL_NGN*100;

  var kpiT = document.getElementById('tr-kpi-tariff');
  var kpiR = document.getElementById('tr-kpi-rev');
  var kpiF = document.getElementById('tr-kpi-floor');
  var kpiS = document.getElementById('tr-kpi-saving');
  if(kpiT) kpiT.textContent = '₦'+fracTar.toFixed(0);
  if(kpiR) kpiR.textContent = revCen.toFixed(2)+'B';
  if(kpiF) kpiF.textContent = revFloor.toFixed(2)+'B';
  if(kpiS) kpiS.textContent = saving>0 ? saving.toFixed(0)+'%' : 'Above diesel';

  // ── Tariff range ──────────────────────────────────────────────────────────
  var tRange = [];
  for(var t=10; t<=850; t+=10) tRange.push(t);

  // ── Chart 1: Revenue vs tariff ────────────────────────────────────────────
  var revCenData = tRange.map(function(t){
    return {x:t, y:annualRevBnT(Math.max(0,adjPeakT(h0,t,BAND_RATES['B'],btmF)),t)};
  });
  var revP10Data = tRange.map(function(t){
    return {x:t, y:annualRevBnT(Math.max(0,adjPeakT(h0,t,BAND_RATES['B'],btmF))*MC_P10F,t)};
  });
  var revP90Data = tRange.map(function(t){
    return {x:t, y:annualRevBnT(Math.max(0,adjPeakT(h0,t,BAND_RATES['B'],btmF))*MC_P90F,t)};
  });

  // Vertical reference lines as scatter datasets
  var yMax1 = Math.max.apply(null, revP90Data.map(function(d){return d.y;}));
  var vLines1 = [];
  var bandKeys = ['A','B','C','D','E'];
  bandKeys.forEach(function(b){
    vLines1.push({
      label:'Band '+b+' (₦'+BAND_RATES[b]+')',
      data:[{x:BAND_RATES[b],y:0},{x:BAND_RATES[b],y:yMax1*1.05}],
      borderColor: BAND_COLS[b]+'bb',
      borderWidth:1.5, borderDash:[4,3],
      pointRadius:0, showLine:true, fill:false, type:'line',
      parsing:false
    });
  });
  vLines1.push({
    label:'Diesel equiv (₦'+DIESEL_NGN+')',
    data:[{x:DIESEL_NGN,y:0},{x:DIESEL_NGN,y:yMax1*1.05}],
    borderColor:'#f85149bb', borderWidth:1.5, borderDash:[6,3],
    pointRadius:0, showLine:true, fill:false, type:'line', parsing:false
  });
  vLines1.push({
    label:'Franchise (₦'+fracTar.toFixed(0)+')',
    data:[{x:fracTar,y:0},{x:fracTar,y:yMax1*1.05}],
    borderColor:'#e3b341', borderWidth:2,
    pointRadius:0, showLine:true, fill:false, type:'line', parsing:false
  });

  if(chTrRev) chTrRev.destroy();
  var ctx1 = document.getElementById('ch-tr-rev');
  if(!ctx1) return;
  chTrRev = new Chart(ctx1.getContext('2d'),{
    type:'line',
    data:{datasets:[
      {label:'P90 demand',data:revP90Data,borderColor:'transparent',
       backgroundColor:'rgba(88,166,255,0.13)',fill:'+1',pointRadius:0,tension:0.3,parsing:false},
      {label:'Central demand',data:revCenData,borderColor:'#58a6ff',
       backgroundColor:'transparent',fill:false,pointRadius:0,tension:0.3,borderWidth:2.5,parsing:false},
      {label:'P10 demand',data:revP10Data,borderColor:'transparent',
       backgroundColor:'rgba(88,166,255,0.13)',fill:'-1',pointRadius:0,tension:0.3,parsing:false}
    ].concat(vLines1)},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{filter:function(i){return i.datasetIndex<3;},
          callbacks:{
            title:function(items){return '₦'+items[0].parsed.x+'/kWh';},
            label:function(item){return ' Revenue: ₦'+item.parsed.y.toFixed(2)+'B/yr';}
          }}
      },
      scales:{
        x:{type:'linear',min:10,max:850,
           title:{display:true,text:'Franchise tariff (₦/kWh)',color:'#8b949e',font:{size:10}},
           grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#8b949e',font:{size:9}}},
        y:{title:{display:true,text:'Annual revenue (₦B/yr)',color:'#8b949e',font:{size:10}},
           grid:{color:'rgba(255,255,255,0.05)'},
           ticks:{color:'#8b949e',font:{size:9},callback:function(v){return v.toFixed(1)+'B';}}}
      }
    }
  });

  // ── Chart 2: Demand suppression ───────────────────────────────────────────
  var demandData = tRange.map(function(t){
    return {x:t, y:adjPeakT(h0,t,BAND_RATES['B'],btmF)};
  });
  var btmLineData = tRange.map(function(t){
    return {x:t, y: t<=DIESEL_NGN ? pkCen*btmF : 0};
  });
  var capLineData = tRange.map(function(t){return {x:t,y:5.0};});
  var yMax2 = pkP90*1.1;
  var vLines2 = [{
    label:'Franchise',data:[{x:fracTar,y:0},{x:fracTar,y:yMax2}],
    borderColor:'#e3b341',borderWidth:2,pointRadius:0,showLine:true,fill:false,type:'line',parsing:false
  },{
    label:'Diesel',data:[{x:DIESEL_NGN,y:0},{x:DIESEL_NGN,y:yMax2}],
    borderColor:'#f85149bb',borderWidth:1.5,borderDash:[6,3],
    pointRadius:0,showLine:true,fill:false,type:'line',parsing:false
  }];

  if(chTrDemand) chTrDemand.destroy();
  var ctx2 = document.getElementById('ch-tr-demand');
  if(!ctx2) return;
  chTrDemand = new Chart(ctx2.getContext('2d'),{
    type:'line',
    data:{datasets:[
      {label:'Total (elastic)',data:demandData,borderColor:'#58a6ff',
       backgroundColor:'rgba(88,166,255,0.08)',fill:true,pointRadius:0,tension:0.3,borderWidth:2.5,parsing:false},
      {label:'BTM floor (inelastic)',data:btmLineData,borderColor:'#3fb950',
       backgroundColor:'rgba(63,185,80,0.10)',fill:true,pointRadius:0,borderWidth:2,borderDash:[4,3],parsing:false},
      {label:'5 MW capacity',data:capLineData,borderColor:'#f85149',
       pointRadius:0,borderWidth:1.5,borderDash:[6,3],backgroundColor:'transparent',fill:false,parsing:false}
    ].concat(vLines2)},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:true,position:'bottom',
          labels:{color:'#8b949e',font:{size:9},boxWidth:10,
            filter:function(i){return i.dataIndex<3;}}},
        tooltip:{filter:function(i){return i.datasetIndex<3;},
          callbacks:{
            title:function(i){return '₦'+i[0].parsed.x+'/kWh';},
            label:function(i){return i.dataset.label+': '+i.parsed.y.toFixed(2)+' MW';}
          }}
      },
      scales:{
        x:{type:'linear',min:10,max:850,
           title:{display:true,text:'Franchise tariff (₦/kWh)',color:'#8b949e',font:{size:10}},
           grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#8b949e',font:{size:9}}},
        y:{title:{display:true,text:'Effective demand (MW)',color:'#8b949e',font:{size:10}},
           min:0,grid:{color:'rgba(255,255,255,0.05)'},
           ticks:{color:'#8b949e',font:{size:9}}}
      }
    }
  });

  // ── Chart 3: Heatmap Band × H₀ ───────────────────────────────────────────
  var H0_VALS   = [4, 6, 8, 10, 12, 16, 20];
  var BANDS_ORD = ['E','D','C','B','A'];
  var heatData  = [];
  var vMin=99, vMax=0;
  for(var ri=0; ri<H0_VALS.length; ri++){
    for(var ci=0; ci<BANDS_ORD.length; ci++){
      var v = annualRevBnT(peakMWT(H0_VALS[ri]), BAND_RATES[BANDS_ORD[ci]]);
      if(v<vMin) vMin=v; if(v>vMax) vMax=v;
    }
  }
  for(var ri=0; ri<H0_VALS.length; ri++){
    for(var ci=0; ci<BANDS_ORD.length; ci++){
      var v = annualRevBnT(peakMWT(H0_VALS[ri]), BAND_RATES[BANDS_ORD[ci]]);
      var norm = (v-vMin)/(vMax-vMin);
      var rr = Math.round(63  + (227-63)*(1-norm));
      var gg = Math.round(185 + (179-185)*(1-norm));
      var bb = Math.round(80  + (65-80)*(1-norm));
      var alpha = 0.20 + norm*0.72;
      heatData.push({
        x:ci, y:ri, r:16,
        bg:'rgba('+rr+','+gg+','+bb+','+alpha+')',
        v:v, band:BANDS_ORD[ci], h0:H0_VALS[ri]
      });
    }
  }

  if(chTrHeat) chTrHeat.destroy();
  var ctx3 = document.getElementById('ch-tr-heat');
  if(!ctx3) return;
  chTrHeat = new Chart(ctx3.getContext('2d'),{
    type:'bubble',
    data:{datasets:[{
      data:heatData.map(function(p){return {x:p.x,y:p.y,r:p.r};}),
      backgroundColor:heatData.map(function(p){return p.bg;}),
      borderColor:heatData.map(function(p){return p.bg;}),
      borderWidth:1
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          label:function(ctx){
            var pt=heatData[ctx.dataIndex];
            return ' ₦'+pt.v.toFixed(2)+'B/yr  [Band '+pt.band+' / H₀='+pt.h0+'h]';
          }
        }}
      },
      scales:{
        x:{type:'linear',min:-0.6,max:4.6,
           title:{display:true,text:'Service Band (statutory tariff →)',color:'#8b949e',font:{size:10}},
           ticks:{color:'#8b949e',font:{size:9},stepSize:1,
             callback:function(v){var i=Math.round(v);return BANDS_ORD[i]?'Band '+BANDS_ORD[i]:null;}},
           grid:{color:'rgba(255,255,255,0.05)'}},
        y:{type:'linear',min:-0.6,max:H0_VALS.length-0.4,
           title:{display:true,text:'Actual H₀ (supply hrs/day)',color:'#8b949e',font:{size:10}},
           ticks:{color:'#8b949e',font:{size:9},stepSize:1,
             callback:function(v){var i=Math.round(v);return H0_VALS[i]!=null?H0_VALS[i]+'h':null;}},
           grid:{color:'rgba(255,255,255,0.05)'}}
      }
    }
  });

  // ── Chart 4: Consumer cost comparison ────────────────────────────────────
  var costBands    = ['A','B','C','D','E'];
  var costFranchise= costBands.map(function(b){return BAND_RATES[b]*prem;});
  var costStatutory= costBands.map(function(b){return BAND_RATES[b];});
  var costDieselArr= costBands.map(function(){return DIESEL_NGN;});

  if(chTrCost) chTrCost.destroy();
  var ctx4 = document.getElementById('ch-tr-cost');
  if(!ctx4) return;
  chTrCost = new Chart(ctx4.getContext('2d'),{
    type:'bar',
    data:{
      labels:costBands.map(function(b){return BAND_LABELS[b];}),
      datasets:[
        {label:'Diesel generator',data:costDieselArr,
         backgroundColor:'rgba(248,81,73,0.75)',borderRadius:3},
        {label:'Franchise (×'+prem.toFixed(1)+')',data:costFranchise,
         backgroundColor:costBands.map(function(b){return BAND_COLS[b]+'cc';}),borderRadius:3},
        {label:'NERC statutory',data:costStatutory,
         backgroundColor:'rgba(139,148,158,0.45)',borderRadius:3}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:true,position:'bottom',
          labels:{color:'#8b949e',font:{size:9},boxWidth:10}},
        tooltip:{callbacks:{
          label:function(i){return ' ₦'+i.parsed.y.toFixed(0)+'/kWh — '+i.dataset.label;}
        }}
      },
      scales:{
        x:{ticks:{color:'#8b949e',font:{size:9}},grid:{color:'rgba(255,255,255,0.05)'}},
        y:{title:{display:true,text:'Cost (₦/kWh)',color:'#8b949e',font:{size:10}},
           ticks:{color:'#8b949e',font:{size:9}},grid:{color:'rgba(255,255,255,0.05)'}}
      }
    }
  });
};

})();


// ── TAB SWITCHING ─────────────────────────────────────────────────────────────
function switchTab(name){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(pp=>pp.classList.remove('active'));
  document.querySelector(`[onclick="switchTab('${name}')"]`).classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
  if(name==='profile') updateProfileExplorer();
  if(name==='appliances') buildAppliancePanel();
  if(name==='tariff') renderTariff();
}

// ── APPLIANCE PORTFOLIO PANEL ─────────────────────────────────────────────────
const APPLIANCES = [
  // [name, kW, T2pen, T3pen, T4pen, scalingClass, source, isNew]
  ['Lighting',       0.08, 1.00, 0.98, 0.90, 'Full S₀',       'MTF 2018 · Oladipo 2023',false],  // corrected: LED dominant (97% SW Nigeria)
  ['TV / Radio',     0.15, 0.95, 0.82, 0.55, '0.7 × S₀',      'MTF 2018 · Oluwole',    false],
  ['Fans',           0.065,0.75, 0.88, 0.95, 'Full S₀',       'MTF 2018',              false],  // corrected: 65W standing fan
  ['Refrigerator',   0.15, 0.92, 0.72, 0.38, 'Full S₀',       'MTF 2018',              false],
  ['Water Pump',     0.75, 0.82, 0.55, 0.15, 'Task (S=1.0)',   'MTF 2018',              false],  // corrected: 1HP domestic pump
  ['Boiler/Geyser',  2.00, 0.62, 0.25, 0.05, 'Task (S=1.0)',   'MTF 2018',              false],
  ['Pressing Iron',  1.20, 0.82, 0.65, 0.28, 'Task (S=1.0)',   'MTF 2018',              false],
  ['Phone Charging', 0.05, 1.00, 0.95, 0.78, 'Full S₀',       'MTF 2018',              false],
  ['Deep Freezer',   0.15, 0.50, 0.22, 0.05, 'Continuous',     'Uyigue et al. 2015',    true ],
  ['Washing Machine',0.45, 0.28, 0.10, 0.02, '0.65 × S₀',     'BusinessDay/TNS 2013',  true ],  // corrected: semi-auto twin-tub dominant
  ['Microwave Oven', 0.80, 0.50, 0.18, 0.02, 'Task (S=1.0)',   'Olaniyan et al. 2018',  true ],
  ['Elec. Cooking',  1.50, 0.10, 0.04, 0.01, '0.65 × S₀ + growth','Olaniyan 2018 · unlocked',true],
];

const SCALE_COLORS = {
  'Full S₀':       '#58a6ff',
  '0.7 × S₀':     '#79c0ff',
  '0.65 × S₀':    '#d29922',
  '0.65 × S₀ + growth': '#f0883e',
  'Task (S=1.0)':  '#3fb950',
  'Continuous':    '#bc8cff',
  '0.8 × S₀':     '#58a6ff',
};

// Approximate demand contribution (MW) at Year 0, central params
// Pre-computed from simulator v16 appliance contribution table
// APP_CONTRIB: recalculated with corrected kW ratings (Lighting 0.08, Fans 0.065, Pump 0.75, WashMach 0.45)
const APP_CONTRIB = {'Lighting': 0.069, 'TV / Radio': 0.071, 'Fans': 0.067, 'Refrigerator': 0.262, 'Water Pump': 0.058, 'Boiler/Geyser': 0.070, 'Pressing Iron': 0.065, 'Phone Charging': 0.034, 'Deep Freezer': 0.063, 'Washing Machine': 0.010, 'Microwave Oven': 0.021, 'Elec. Cooking': 0.017};

let appPanelBuilt = false;
function buildAppliancePanel(){
  if(appPanelBuilt) return;
  appPanelBuilt = true;

  // Table
  const tbody = document.getElementById('app-table-body');
  tbody.innerHTML = APPLIANCES.map(([name,kw,t2,t3,t4,sc,src,isNew])=>{
    const tag = isNew ? `<span style="background:rgba(210,153,34,.15);color:#d29922;border:1px solid #d29922;border-radius:2px;padding:1px 5px;font-size:8px;margin-left:6px">NEW v7</span>` : '';
    const scCol = SCALE_COLORS[sc] || '#8b949e';
    return `<tr style="border-bottom:1px solid var(--surface2)">
      <td style="padding:7px 10px;color:var(--text);font-weight:${isNew?'600':'400'}">${name}${tag}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--muted)">${kw.toFixed(2)}</td>
      <td style="padding:7px 8px;text-align:center;color:var(--accent)">${(t2*100).toFixed(0)}%</td>
      <td style="padding:7px 8px;text-align:center;color:var(--orange)">${(t3*100).toFixed(0)}%</td>
      <td style="padding:7px 8px;text-align:center;color:var(--green)">${(t4*100).toFixed(0)}%</td>
      <td style="padding:7px 8px;text-align:center"><span style="color:${scCol};font-size:9px">${sc}</span></td>
      <td style="padding:7px 8px;color:var(--muted);font-size:9px">${src}</td>
      <td style="padding:7px 6px;text-align:center">${isNew?'<span style="color:#d29922">✓</span>':'<span style="color:#8b949e">–</span>'}</td>
    </tr>`;
  }).join('');

  // Contribution bar chart
  const names = APPLIANCES.map(a=>a[0]);
  const contribs = APPLIANCES.map(a=>APP_CONTRIB[a[0]]||0);
  const isNewArr = APPLIANCES.map(a=>a[7]);
  mkChart('ch-app-contrib',{
    type:'bar',
    data:{
      labels: names,
      datasets:[{
        data: contribs,
        backgroundColor: isNewArr.map(n=>n?'rgba(210,153,34,.75)':'rgba(88,166,255,.55)'),
        borderColor:     isNewArr.map(n=>n?'#d29922':'#58a6ff'),
        borderWidth:1, borderRadius:2,
      }]
    },
    options:{
      indexAxis:'y',
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{grid:{color:GC},ticks:{color:'#8b949e'},title:{display:true,text:'MW contribution (Year 0)',color:'#8b949e',font:{size:10}}},
        y:{grid:{color:'transparent'},ticks:{color:'#8b949e',font:{size:9}}}
      }
    }
  });

  // Scaling class donut
  const scaleGroups = {};
  APPLIANCES.forEach(([name,,,,, sc])=>{
    const contrib = APP_CONTRIB[name]||0;
    scaleGroups[sc] = (scaleGroups[sc]||0) + contrib;
  });
  const scKeys = Object.keys(scaleGroups);
  mkChart('ch-app-scale',{
    type:'doughnut',
    data:{
      labels: scKeys,
      datasets:[{
        data: scKeys.map(k=>scaleGroups[k].toFixed(3)),
        backgroundColor: scKeys.map(k=>SCALE_COLORS[k]||'#8b949e'),
        borderColor:'#0d1117', borderWidth:2,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      cutout:'55%',
      plugins:{legend:{display:true,position:'right',
        labels:{color:'#8b949e',boxWidth:11,font:{size:9},padding:8}}}
    }
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
buildPWList();
buildBTMPanel();
updateAll();

document.querySelectorAll('input[type=range],select').forEach(el=>el.addEventListener('input',updateAll));
// Note: sl-S removed; S is now derived from sl-h0 and sl-lam
document.getElementById('footer-ts').textContent=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
