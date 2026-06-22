
/* ── LOOKUP ENGINE v9 ─────────────────────────────────────────────
   Reads pre-computed outputs.json. No live model runs in browser.
   ──────────────────────────────────────────────────────────────── */
let DB = null;

// ── Nearest-value lookup helpers ──────────────────────────────────
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

// ── Scale profile to current zone HH ─────────────────────────────
function scaleProfile(profile, hhA, hhB, hhC) {
  const refHH = 1000+2000+1000;
  const curHH = hhA+hhB+hhC;
  return profile.map(v=>+(v*curHH/refHH).toFixed(2));
}

// ── P() — current parameter object ───────────────────────────────
function P() {
  return {
    h0:  +document.getElementById('sl-h0').value,
    cf:  +document.getElementById('sl-cf').value,
    lam: +document.getElementById('sl-lam').value,
    gp:  +document.getElementById('sl-gp').value,
    cap: +document.getElementById('sl-cap').value,
    hh:  zones.reduce((s,z)=>s+z.hh,0),
    hhA: zones[0].hh,
    hhB: zones[1].hh,
    hhC: zones[2].hh,
    season: document.getElementById('sl-season').value,
    year: +document.getElementById('sl-year').value,
  };
}

// ── ringPeak — from lookup, scaled to current zones ───────────────
function ringPeak(p, pw, yr) {
  const row = lookupScalar(p.h0, p.cf, pw||'CT', yr||0);
  const zrow = lookupZone(p.hhA, p.hhB, p.hhC);
  // Scale by zone HH ratio vs default (1000/2000/1000 = 4000 HH)
  const hhScale = (p.hhA+p.hhB+p.hhC) / 4000;
  // Scale by lam and gp adjustments (linear approximation)
  const lamScale = 1 + (p.lam-1.0)*0.6;
  const gpScale  = 0.40 + (p.gp/100)*0.60;
  return +(row.peak * hhScale * lamScale * gpScale).toFixed(2);
}

function btmFrac(p, pw, yr) {
  const row = lookupScalar(p.h0, p.cf, pw||'CT', yr||0);
  const gpScale = 0.40 + (p.gp/100)*0.60;
  return +Math.min(0.90, row.btm * gpScale).toFixed(3);
}

function co2(p, pw, yr) {
  const peak = ringPeak(p, pw||'CT', yr||0);
  const btm  = btmFrac(p, pw||'CT', yr||0);
  const btmMW = peak*btm;
  const ef = 0.984;
  const util = 0.325;
  return Math.round(btmMW*1000*util*8760*ef/1000);
}

function pathMult(pw, yr) {
  const traj = lookupTraj(6.6, 0.75, pw);
  const yrn  = nearest([...Array(21).keys()], yr);
  return traj[yrn] / traj[0];
}

function overloadProb(p, pw) {
  const peak = ringPeak(p, pw||'CT', 0);
  // Approximate P(OL) from pre-computed scalar — use h0 to modulate
  const h0n = nearest(DB.meta.h0_vals, p.h0);
  const cfn  = nearest(DB.meta.cf_vals, p.cf);
  const row  = lookupScalar(p.h0, p.cf, pw||'CT', 0);
  // From paper Table I: P(OL) driven primarily by h0 and cf
  if (peak <= p.cap) {
    const excess = peak/p.cap;
    return +(Math.min(0.95, Math.max(0.01, (excess-0.5)*1.8))).toFixed(2);
  }
  const base = 0.91;
  const capAdj = Math.min(0.99, base * (5.0/p.cap));
  const h0adj  = h0n < 6 ? Math.min(0.99, capAdj*1.05) : capAdj*(0.6+h0n/45);
  return +Math.min(0.99, Math.max(0.01, h0adj)).toFixed(2);
}

// ── Pathway meta ──────────────────────────────────────────────────
const PW_META = {
  CT:  {label:'Consumer Transformation',color:'#e6edf3',ls:'-'},
  HG:  {label:'High Growth',            color:'#f85149',ls:'--'},
  MA:  {label:'Moderate Austerity',     color:'#bc8cff',ls:'-.'},
  DSF: {label:'Debt-Service Floor',     color:'#8b949e',ls:':'},
  PT:  {label:'Prosumer Transition',    color:'#39d353',ls:'--'},
};
const PW_KEYS = Object.keys(PW_META);

// ── Existing functions from engine.js (chart rendering, tabs, etc) ─
// These are preserved exactly as-is since they only do rendering.
// updateAll() is redefined below to use lookup results.


// ── Zone definitions (kept from engine) ─────────────────────
const DEFAULT_ZONES = [
  {name:'Zone A (MTF 5)', hh:1000, tier:1},  // MTF 5 — GRA/premium estate
  {name:'Zone B (MTF 4)', hh:2000, tier:2},  // MTF 4 — upper-middle residential
  {name:'Zone C (MTF 3)', hh:1000, tier:3},  // MTF 3 — lower-middle urban (sandcrete)
];
let zones = DEFAULT_ZONES.map(z=>({...z}));



// ── Chart rendering and UI (preserved from engine.js) ───────
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