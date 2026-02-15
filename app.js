/* EV Cost & Trip Simulator - PWA (offline)
   Tutti i dati restano sul dispositivo (localStorage).
*/
const LS_KEY = "ev_cost_pwa_v1";

const DEFAULTS = {
  car: {
    name: "EV",
    usableBatteryKWh: 75,
    consumptionBaseKWh100: 18,
    consumption90KWh100: 16,
    consumption110KWh100: 18,
    consumption130KWh100: 22,
    chargeLossHomePct: 12,
    chargeLossAcPct: 8,
    chargeLossHpcPct: 5,
  },
  energy: {
    priceHome: 0.30,
    priceAC: 0.55,
    priceHPC: 0.75,
    shareHomePct: 70,
    shareAcPct: 20,
    shareHpcPct: 10,
  },
  usage: { kmPerYear: 20000 },
  fixed: {
    insurancePerYear: 900,
    roadTaxPerYear: 0,
    inspectionPerYear: 40,
    subscriptionsPerYear: 0,
    financingPerMonth: 0,
    parkingGaragePerMonth: 0,
  },
  tires: {
    tireSetCost: 800,
    tireLifeKm: 40000,
    mountingPerChange: 60,
    changesPerYear: 2,
    alignmentPerYear: 50,
  },
  maintenance: [
    { name: "Filtro abitacolo", cost: 30, intervalKm: null, intervalMonths: 12 },
    { name: "Liquido freni", cost: 80, intervalKm: null, intervalMonths: 24 },
    { name: "Spazzole", cost: 40, intervalKm: null, intervalMonths: 12 },
    { name: "Check generale/tagliando", cost: 120, intervalKm: null, intervalMonths: 24 },
    { name: "Freni (stima)", cost: 300, intervalKm: 60000, intervalMonths: null },
  ],
  trips: []
};

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return deepClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      ...deepClone(DEFAULTS),
      ...parsed,
      car: { ...deepClone(DEFAULTS.car), ...(parsed.car||{}) },
      energy: { ...deepClone(DEFAULTS.energy), ...(parsed.energy||{}) },
      usage: { ...deepClone(DEFAULTS.usage), ...(parsed.usage||{}) },
      fixed: { ...deepClone(DEFAULTS.fixed), ...(parsed.fixed||{}) },
      tires: { ...deepClone(DEFAULTS.tires), ...(parsed.tires||{}) },
      maintenance: Array.isArray(parsed.maintenance) ? parsed.maintenance : deepClone(DEFAULTS.maintenance),
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    };
  } catch(e){
    return deepClone(DEFAULTS);
  }
}
function saveState(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function num(v, fallback=0){
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function fmtEUR(x){
  if(!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(x);
}
function fmtNum(x, d=2){
  if(!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits:d, maximumFractionDigits:d }).format(x);
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>{ t.style.display="none"; }, 2600);
}

function normalizeShares(energy){
  const a = Math.max(0, num(energy.shareHomePct));
  const b = Math.max(0, num(energy.shareAcPct));
  const c = Math.max(0, num(energy.shareHpcPct));
  const s = a+b+c;
  if(s <= 0) return { shareHomePct: 100, shareAcPct: 0, shareHpcPct: 0 };
  return {
    shareHomePct: (a/s)*100,
    shareAcPct: (b/s)*100,
    shareHpcPct: (c/s)*100,
  };
}

function lossAdjustedPrice(price, lossPct){
  const lp = clamp(num(lossPct), 0, 95) / 100;
  return price / (1 - lp);
}

function avgEnergyPrice(car, energy){
  const shares = normalizeShares(energy);
  const sh = shares.shareHomePct/100;
  const sa = shares.shareAcPct/100;
  const sp = shares.shareHpcPct/100;

  const pHome = lossAdjustedPrice(num(energy.priceHome), num(car.chargeLossHomePct));
  const pAC   = lossAdjustedPrice(num(energy.priceAC),   num(car.chargeLossAcPct));
  const pHPC  = lossAdjustedPrice(num(energy.priceHPC),  num(car.chargeLossHpcPct));

  return pHome*sh + pAC*sa + pHPC*sp;
}

function maintenanceCostPerYear(maintenance, kmPerYear){
  let total = 0;
  for(const it of maintenance){
    const cost = Math.max(0, num(it.cost));
    const intervalKm = it.intervalKm != null ? Math.max(1, num(it.intervalKm)) : null;
    const intervalMonths = it.intervalMonths != null ? Math.max(1, num(it.intervalMonths)) : null;

    if(intervalKm){
      total += cost * (kmPerYear / intervalKm);
    } else if(intervalMonths){
      total += cost * (12 / intervalMonths);
    } else {
      // se non ha intervallo, ignoralo (o consideralo 0)
      total += 0;
    }
  }
  return total;
}

function computeTotals(){
  const car = state.car;
  const energy = state.energy;
  const usage = state.usage;
  const fixed = state.fixed;
  const tires = state.tires;

  const kmPerYear = Math.max(1, num(usage.kmPerYear, 1));

  const avgP = avgEnergyPrice(car, energy);
  const kWhPerKm = Math.max(0, num(car.consumptionBaseKWh100)) / 100;
  const energyCostPerKm = kWhPerKm * avgP;
  const energyCostPerYear = energyCostPerKm * kmPerYear;

  const fixedCostPerYear =
    Math.max(0, num(fixed.insurancePerYear)) +
    Math.max(0, num(fixed.roadTaxPerYear)) +
    Math.max(0, num(fixed.inspectionPerYear)) +
    Math.max(0, num(fixed.subscriptionsPerYear)) +
    Math.max(0, num(fixed.financingPerMonth)) * 12 +
    Math.max(0, num(fixed.parkingGaragePerMonth)) * 12;

  const tiresDepPerKm = Math.max(0, num(tires.tireSetCost)) / Math.max(1, num(tires.tireLifeKm, 1));
  const tiresCostPerYear =
    (tiresDepPerKm * kmPerYear) +
    Math.max(0, num(tires.mountingPerChange)) * Math.max(0, num(tires.changesPerYear)) +
    Math.max(0, num(tires.alignmentPerYear));

  const maintPerYear = maintenanceCostPerYear(state.maintenance, kmPerYear);

  const totalPerYear = energyCostPerYear + fixedCostPerYear + tiresCostPerYear + maintPerYear;

  return {
    kmPerYear,
    avgEnergyPrice: avgP,
    energyCostPerKm,
    energyCostPerYear,
    fixedCostPerYear,
    tiresCostPerYear,
    maintCostPerYear: maintPerYear,
    totalPerYear,
    totalPerKm: totalPerYear / kmPerYear,
    totalPerMonth: totalPerYear / 12,
  };
}

function selectedTripConsumption(mode){
  const car = state.car;
  if(mode === "90" && num(car.consumption90KWh100) > 0) return num(car.consumption90KWh100);
  if(mode === "110" && num(car.consumption110KWh100) > 0) return num(car.consumption110KWh100);
  if(mode === "130" && num(car.consumption130KWh100) > 0) return num(car.consumption130KWh100);
  return num(car.consumptionBaseKWh100);
}

function tripEnergyPrice(source){
  const car = state.car;
  const e = state.energy;
  if(source === "home") return lossAdjustedPrice(num(e.priceHome), num(car.chargeLossHomePct));
  if(source === "ac") return lossAdjustedPrice(num(e.priceAC), num(car.chargeLossAcPct));
  return lossAdjustedPrice(num(e.priceHPC), num(car.chargeLossHpcPct));
}

function computeTrip(input){
  const car = state.car;
  const dist = Math.max(0, num(input.distanceKm));
  const mode = input.mode;
  const base = mode === "custom" ? Math.max(0, num(input.customConsumption)) : Math.max(0, selectedTripConsumption(mode));
  const factor = 1 + (Math.max(0, num(input.tempFactorPct)) + Math.max(0, num(input.hvacFactorPct))) / 100;
  const cons = base * factor;

  const tripKWh = (cons/100) * dist;

  const p = tripEnergyPrice(input.source);
  const tripCost = tripKWh * p;

  const batt = Math.max(1e-6, num(car.usableBatteryKWh, 1));
  const neededPct = (tripKWh / batt) * 100;

  const start = clamp(num(input.startSoCPct), 0, 100);
  const end = clamp(num(input.endSoCPctTarget), 0, 100);
  const available = Math.max(0, start - end);

  const ok = neededPct <= available + 1e-9;
  const extraPct = ok ? 0 : (neededPct - available);
  const extraKWh = (extraPct/100) * batt;
  const extraCost = extraKWh * p;

  return {
    dist, cons, factor, tripKWh, p, tripCost,
    neededPct, start, end, available,
    ok, extraPct, extraKWh, extraCost
  };
}

function setTab(tab){
  document.querySelectorAll(".tab").forEach(b=>{
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tabpane").forEach(sec=>sec.style.display="none");
  document.getElementById("tab-"+tab).style.display = "block";
}

function bindTabs(){
  document.querySelectorAll(".tab").forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.dataset.tab));
  });
}

function fillInputs(){
  // Profilo auto
  document.getElementById("car-name").value = state.car.name ?? "";
  document.getElementById("car-batt").value = state.car.usableBatteryKWh;
  document.getElementById("car-cons-base").value = state.car.consumptionBaseKWh100;
  document.getElementById("car-cons-90").value = state.car.consumption90KWh100 ?? "";
  document.getElementById("car-cons-110").value = state.car.consumption110KWh100 ?? "";
  document.getElementById("car-cons-130").value = state.car.consumption130KWh100 ?? "";
  document.getElementById("loss-home").value = state.car.chargeLossHomePct;
  document.getElementById("loss-ac").value = state.car.chargeLossAcPct;
  document.getElementById("loss-hpc").value = state.car.chargeLossHpcPct;

  // Uso+energia
  document.getElementById("km-year").value = state.usage.kmPerYear;
  document.getElementById("p-home").value = state.energy.priceHome;
  document.getElementById("p-ac").value = state.energy.priceAC;
  document.getElementById("p-hpc").value = state.energy.priceHPC;
  document.getElementById("s-home").value = state.energy.shareHomePct;
  document.getElementById("s-ac").value = state.energy.shareAcPct;
  document.getElementById("s-hpc").value = state.energy.shareHpcPct;

  // Fissi
  document.getElementById("c-ins").value = state.fixed.insurancePerYear;
  document.getElementById("c-tax").value = state.fixed.roadTaxPerYear;
  document.getElementById("c-rev").value = state.fixed.inspectionPerYear;
  document.getElementById("c-sub").value = state.fixed.subscriptionsPerYear;
  document.getElementById("c-fin").value = state.fixed.financingPerMonth;
  document.getElementById("c-park").value = state.fixed.parkingGaragePerMonth;

  // Gomme
  document.getElementById("t-set").value = state.tires.tireSetCost;
  document.getElementById("t-life").value = state.tires.tireLifeKm;
  document.getElementById("t-mount").value = state.tires.mountingPerChange;
  document.getElementById("t-changes").value = state.tires.changesPerYear;
  document.getElementById("t-align").value = state.tires.alignmentPerYear;

  // Viaggio defaults
  document.getElementById("trip-km").value = 250;
  document.getElementById("trip-mode").value = "base";
  document.getElementById("trip-custom").value = "";
  document.getElementById("trip-temp").value = 0;
  document.getElementById("trip-hvac").value = 0;
  document.getElementById("trip-source").value = "hpc";
  document.getElementById("trip-start").value = 80;
  document.getElementById("trip-end").value = 10;
}

function renderMaintenance(){
  const ul = document.getElementById("maint-list");
  ul.innerHTML = "";
  state.maintenance.forEach((it, idx)=>{
    const li = document.createElement("li");
    li.className = "li";
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.innerHTML = `<strong>${escapeHtml(it.name||"Voce")}</strong><div class="muted" style="font-size:12px;margin-top:4px;">
      ${fmtEUR(num(it.cost))} • ${it.intervalKm? (fmtNum(num(it.intervalKm),0)+" km"): (it.intervalMonths? (fmtNum(num(it.intervalMonths),0)+" mesi") : "—")}
    </div>`;
    right.innerHTML = `<button class="danger" data-del="${idx}" style="padding:8px 10px;border-radius:12px;">X</button>`;
    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  });
  ul.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.del);
      if(Number.isFinite(i)){
        state.maintenance.splice(i,1);
        saveState();
        renderMaintenance();
        recalc();
      }
    });
  });
}

function renderTrips(){
  const ul = document.getElementById("trip-history");
  ul.innerHTML = "";
  const trips = state.trips.slice().reverse();
  if(trips.length === 0){
    const li = document.createElement("li");
    li.className = "li";
    li.innerHTML = `<span class="muted">Nessun viaggio salvato.</span><span></span>`;
    ul.appendChild(li);
    return;
  }
  trips.forEach((t, idxRev)=>{
    const idx = state.trips.length - 1 - idxRev;
    const li = document.createElement("li");
    li.className = "li";
    const dt = new Date(t.ts);
    li.innerHTML = `
      <span>
        <strong>${fmtNum(t.dist,0)} km</strong>
        <div class="muted" style="font-size:12px;margin-top:4px;">
          ${fmtEUR(t.cost)} • ${fmtNum(t.kwh,1)} kWh • ${dt.toLocaleString("it-IT")}
        </div>
      </span>
      <span>
        <button class="ghost" data-load="${idx}" style="padding:8px 10px;border-radius:12px;">Apri</button>
        <button class="danger" data-del="${idx}" style="padding:8px 10px;border-radius:12px;margin-left:6px;">X</button>
      </span>
    `;
    ul.appendChild(li);
  });

  ul.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.del);
      if(Number.isFinite(i)){
        state.trips.splice(i,1);
        saveState();
        renderTrips();
      }
    });
  });
  ul.querySelectorAll("button[data-load]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.load);
      const t = state.trips[i];
      if(!t) return;
      document.getElementById("trip-km").value = t.dist;
      document.getElementById("trip-mode").value = t.mode;
      document.getElementById("trip-custom").value = t.custom || "";
      document.getElementById("trip-temp").value = t.temp || 0;
      document.getElementById("trip-hvac").value = t.hvac || 0;
      document.getElementById("trip-source").value = t.source;
      document.getElementById("trip-start").value = t.start;
      document.getElementById("trip-end").value = t.end;
      setTab("viaggi");
      toast("Viaggio caricato.");
    });
  });
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function recalc(){
  const totals = computeTotals();
  document.getElementById("kpi-eurkm").textContent = fmtEUR(totals.totalPerKm);
  document.getElementById("kpi-month").textContent = fmtEUR(totals.totalPerMonth);
  document.getElementById("kpi-year").textContent = fmtEUR(totals.totalPerYear);

  const breakdown = [
    ["Energia", totals.energyCostPerYear],
    ["Costi fissi", totals.fixedCostPerYear],
    ["Gomme", totals.tiresCostPerYear],
    ["Manutenzione", totals.maintCostPerYear]
  ];
  const ul = document.getElementById("breakdown-list");
  ul.innerHTML = "";
  for(const [name, val] of breakdown){
    const li = document.createElement("li");
    li.className = "li";
    li.innerHTML = `<span>${name}</span><span><strong>${fmtEUR(val)}</strong> <span class="muted">/anno</span></span>`;
    ul.appendChild(li);
  }
}

function bindButtons(){
  document.getElementById("btn-recalc").addEventListener("click", ()=>{
    recalc(); toast("Ricalcolato.");
  });

  document.getElementById("btn-save-profile").addEventListener("click", ()=>{
    state.car.name = document.getElementById("car-name").value.trim() || "EV";
    state.car.usableBatteryKWh = num(document.getElementById("car-batt").value, DEFAULTS.car.usableBatteryKWh);
    state.car.consumptionBaseKWh100 = num(document.getElementById("car-cons-base").value, DEFAULTS.car.consumptionBaseKWh100);
    state.car.consumption90KWh100 = num(document.getElementById("car-cons-90").value, DEFAULTS.car.consumption90KWh100);
    state.car.consumption110KWh100 = num(document.getElementById("car-cons-110").value, DEFAULTS.car.consumption110KWh100);
    state.car.consumption130KWh100 = num(document.getElementById("car-cons-130").value, DEFAULTS.car.consumption130KWh100);
    state.car.chargeLossHomePct = num(document.getElementById("loss-home").value, DEFAULTS.car.chargeLossHomePct);
    state.car.chargeLossAcPct = num(document.getElementById("loss-ac").value, DEFAULTS.car.chargeLossAcPct);
    state.car.chargeLossHpcPct = num(document.getElementById("loss-hpc").value, DEFAULTS.car.chargeLossHpcPct);
    saveState(); recalc(); toast("Profilo auto salvato.");
  });

  document.getElementById("btn-save-energy").addEventListener("click", ()=>{
    state.usage.kmPerYear = num(document.getElementById("km-year").value, DEFAULTS.usage.kmPerYear);
    state.energy.priceHome = num(document.getElementById("p-home").value, DEFAULTS.energy.priceHome);
    state.energy.priceAC = num(document.getElementById("p-ac").value, DEFAULTS.energy.priceAC);
    state.energy.priceHPC = num(document.getElementById("p-hpc").value, DEFAULTS.energy.priceHPC);
    state.energy.shareHomePct = num(document.getElementById("s-home").value, DEFAULTS.energy.shareHomePct);
    state.energy.shareAcPct = num(document.getElementById("s-ac").value, DEFAULTS.energy.shareAcPct);
    state.energy.shareHpcPct = num(document.getElementById("s-hpc").value, DEFAULTS.energy.shareHpcPct);

    // normalizza e rimetti nei campi
    const ns = normalizeShares(state.energy);
    state.energy.shareHomePct = ns.shareHomePct;
    state.energy.shareAcPct = ns.shareAcPct;
    state.energy.shareHpcPct = ns.shareHpcPct;
    document.getElementById("s-home").value = fmtNum(ns.shareHomePct,0);
    document.getElementById("s-ac").value = fmtNum(ns.shareAcPct,0);
    document.getElementById("s-hpc").value = fmtNum(ns.shareHpcPct,0);

    saveState(); recalc(); toast("Energia/uso salvati.");
  });

  document.getElementById("btn-save-fixed").addEventListener("click", ()=>{
    state.fixed.insurancePerYear = num(document.getElementById("c-ins").value, DEFAULTS.fixed.insurancePerYear);
    state.fixed.roadTaxPerYear = num(document.getElementById("c-tax").value, DEFAULTS.fixed.roadTaxPerYear);
    state.fixed.inspectionPerYear = num(document.getElementById("c-rev").value, DEFAULTS.fixed.inspectionPerYear);
    state.fixed.subscriptionsPerYear = num(document.getElementById("c-sub").value, DEFAULTS.fixed.subscriptionsPerYear);
    state.fixed.financingPerMonth = num(document.getElementById("c-fin").value, DEFAULTS.fixed.financingPerMonth);
    state.fixed.parkingGaragePerMonth = num(document.getElementById("c-park").value, DEFAULTS.fixed.parkingGaragePerMonth);
    saveState(); recalc(); toast("Costi fissi salvati.");
  });

  document.getElementById("btn-save-tires").addEventListener("click", ()=>{
    state.tires.tireSetCost = num(document.getElementById("t-set").value, DEFAULTS.tires.tireSetCost);
    state.tires.tireLifeKm = num(document.getElementById("t-life").value, DEFAULTS.tires.tireLifeKm);
    state.tires.mountingPerChange = num(document.getElementById("t-mount").value, DEFAULTS.tires.mountingPerChange);
    state.tires.changesPerYear = num(document.getElementById("t-changes").value, DEFAULTS.tires.changesPerYear);
    state.tires.alignmentPerYear = num(document.getElementById("t-align").value, DEFAULTS.tires.alignmentPerYear);
    saveState(); recalc(); toast("Gomme salvate.");
  });

  document.getElementById("btn-add-maint").addEventListener("click", ()=>{
    const name = document.getElementById("m-name").value.trim();
    const cost = num(document.getElementById("m-cost").value, 0);
    const km = document.getElementById("m-km").value.trim();
    const months = document.getElementById("m-months").value.trim();

    if(!name){ toast("Inserisci un nome voce."); return; }
    if(!(cost > 0)){ toast("Inserisci un costo > 0."); return; }

    const intervalKm = km ? Math.max(1, num(km)) : null;
    const intervalMonths = (!intervalKm && months) ? Math.max(1, num(months)) : (months ? Math.max(1, num(months)) : null);

    state.maintenance.push({ name, cost, intervalKm, intervalMonths });
    document.getElementById("m-name").value = "";
    document.getElementById("m-cost").value = "";
    document.getElementById("m-km").value = "";
    document.getElementById("m-months").value = "";
    saveState(); renderMaintenance(); recalc(); toast("Voce aggiunta.");
  });

  document.getElementById("btn-reset-maint").addEventListener("click", ()=>{
    state.maintenance = deepClone(DEFAULTS.maintenance);
    saveState(); renderMaintenance(); recalc(); toast("Manutenzione ripristinata.");
  });

  document.getElementById("btn-trip").addEventListener("click", ()=>{
    const input = {
      distanceKm: document.getElementById("trip-km").value,
      mode: document.getElementById("trip-mode").value,
      customConsumption: document.getElementById("trip-custom").value,
      tempFactorPct: document.getElementById("trip-temp").value,
      hvacFactorPct: document.getElementById("trip-hvac").value,
      source: document.getElementById("trip-source").value,
      startSoCPct: document.getElementById("trip-start").value,
      endSoCPctTarget: document.getElementById("trip-end").value
    };
    const r = computeTrip(input);
    window._lastTrip = { input, r };
    renderTripResult(r);
    toast("Viaggio calcolato.");
  });

  document.getElementById("btn-trip-save").addEventListener("click", ()=>{
    if(!window._lastTrip){ toast("Prima calcola un viaggio."); return; }
    const { input, r } = window._lastTrip;
    state.trips.push({
      ts: Date.now(),
      dist: r.dist,
      kwh: r.tripKWh,
      cost: r.tripCost,
      mode: input.mode,
      custom: input.customConsumption ? num(input.customConsumption) : null,
      temp: num(input.tempFactorPct),
      hvac: num(input.hvacFactorPct),
      source: input.source,
      start: clamp(num(input.startSoCPct),0,100),
      end: clamp(num(input.endSoCPctTarget),0,100)
    });
    saveState(); renderTrips(); toast("Viaggio salvato.");
  });

  document.getElementById("btn-clear-trips").addEventListener("click", ()=>{
    state.trips = [];
    saveState(); renderTrips(); toast("Storico cancellato.");
  });

  // Export / import / wipe
  document.getElementById("btn-export").addEventListener("click", ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ev-cost-backup.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Export avviato.");
  });

  document.getElementById("import-file").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const parsed = JSON.parse(text);
      // merge safe
      state = {
        ...deepClone(DEFAULTS),
        ...parsed,
        car: { ...deepClone(DEFAULTS.car), ...(parsed.car||{}) },
        energy: { ...deepClone(DEFAULTS.energy), ...(parsed.energy||{}) },
        usage: { ...deepClone(DEFAULTS.usage), ...(parsed.usage||{}) },
        fixed: { ...deepClone(DEFAULTS.fixed), ...(parsed.fixed||{}) },
        tires: { ...deepClone(DEFAULTS.tires), ...(parsed.tires||{}) },
        maintenance: Array.isArray(parsed.maintenance) ? parsed.maintenance : deepClone(DEFAULTS.maintenance),
        trips: Array.isArray(parsed.trips) ? parsed.trips : [],
      };
      saveState();
      fillInputs();
      renderMaintenance();
      renderTrips();
      recalc();
      toast("Import completato.");
    } catch(err){
      toast("Import fallito: JSON non valido.");
    } finally {
      e.target.value = "";
    }
  });

  document.getElementById("btn-wipe").addEventListener("click", ()=>{
    localStorage.removeItem(LS_KEY);
    state = deepClone(DEFAULTS);
    saveState();
    fillInputs();
    renderMaintenance();
    renderTrips();
    recalc();
    toast("Reset completo eseguito.");
  });
}

function renderTripResult(r){
  const ul = document.getElementById("trip-result");
  ul.innerHTML = "";
  const items = [
    ["Energia richiesta", `${fmtNum(r.tripKWh,1)} kWh`],
    ["Costo stimato", `${fmtEUR(r.tripCost)}`],
    ["Consumo usato", `${fmtNum(r.cons,1)} kWh/100km`],
    ["Prezzo energia (con perdite)", `${fmtEUR(r.p)} /kWh`],
    ["Batteria necessaria", `${fmtNum(r.neededPct,1)} %`],
    ["Disponibile (da SOC)", `${fmtNum(r.available,1)} %`],
    ["Esito", r.ok ? "OK senza ricaricare" : "Serve ricarica extra"]
  ];
  if(!r.ok){
    items.push(["Extra necessario", `${fmtNum(r.extraKWh,1)} kWh (${fmtNum(r.extraPct,1)}%)`]);
    items.push(["Costo extra", `${fmtEUR(r.extraCost)}`]);
  }
  for(const [k,v] of items){
    const li = document.createElement("li");
    li.className = "li";
    li.innerHTML = `<span>${k}</span><span><strong>${v}</strong></span>`;
    ul.appendChild(li);
  }
}

function registerSW(){
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
}

// Install prompt (Chrome/Edge Android)
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("btn-install");
  btn.style.display = "inline-block";
  document.getElementById("install-hint").textContent = "Installazione disponibile: premi “Installa app”.";
  btn.addEventListener("click", async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.style.display = "none";
    toast(choice.outcome === "accepted" ? "Installazione avviata." : "Installazione annullata.");
  }, { once:true });
});

let state = loadState();

document.addEventListener("DOMContentLoaded", ()=>{
  bindTabs();
  fillInputs();
  renderMaintenance();
  renderTrips();
  bindButtons();
  recalc();
  registerSW();
});
