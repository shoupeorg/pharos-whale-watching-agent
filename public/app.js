const $ = (selector) => document.querySelector(selector);
const workspace = localStorage.getItem("pharos-whale-workspace") || crypto.randomUUID().replaceAll("-", "");
localStorage.setItem("pharos-whale-workspace", workspace);
const headers = { "content-type": "application/json", "x-watch-workspace": workspace };
let state = null;
let timer = null;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { throw new Error(`${path}: HTTP ${response.status} returned non-JSON`); }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = String(text); return el; }
function field(labelText, value, onChange) { const label = node("label", "", labelText); const input = node("input"); input.value = value; input.addEventListener("change", () => onChange(input.value)); label.append(input); return label; }
function short(value) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function setStatus(message) { $("#status").textContent = message; }

function renderConfig() {
  const addressRoot = $("#addresses"); addressRoot.replaceChildren();
  state.config.addresses.forEach((item, index) => {
    const row = node("div", "config-row"); const head = node("div", "row-head");
    head.append(node("b", "", `Address ${index + 1}`), node("span", "badge", "USER-SUPPLIED"));
    const remove = node("button", "mini", "Remove"); remove.disabled = state.config.addresses.length <= 5; remove.onclick = () => { state.config.addresses.splice(index, 1); renderConfig(); };
    head.append(remove); row.append(head, field("Full address", item.address, (value) => item.address = value), field("Label", item.label, (value) => item.label = value)); addressRoot.append(row);
  });
  const tokenRoot = $("#tokens"); tokenRoot.replaceChildren();
  state.config.tokens.forEach((item, index) => {
    const row = node("div", "config-row"); const head = node("div", "row-head"); head.append(node("b", "", `Token ${index + 1}`));
    const remove = node("button", "mini", "Remove"); remove.disabled = state.config.tokens.length <= 1; remove.onclick = () => { state.config.tokens.splice(index, 1); renderConfig(); }; head.append(remove);
    row.append(head, field("Contract", item.address, (value) => item.address = value), field("Threshold", item.threshold, (value) => item.threshold = value)); tokenRoot.append(row);
  });
  renderFilters();
}

function renderFilters() {
  const address = $("#filter-address"); const previous = address.value; address.replaceChildren(new Option("All watched addresses", ""));
  state.config.addresses.forEach((item) => address.add(new Option(`${item.label} · ${short(item.address)}`, item.address.toLowerCase()))); address.value = previous;
  const token = $("#filter-token"); const old = token.value; token.replaceChildren(new Option("All tokens", "")); state.config.tokens.forEach((item) => token.add(new Option(item.symbol || short(item.address), item.address.toLowerCase()))); token.value = old;
}

function renderCoverage() {
  const coverage = state.report?.coverage;
  if (!coverage) { $("#coverage").textContent = "No completed scan yet."; return; }
  const root = $("#coverage"); root.replaceChildren();
  const entries = [["Coverage", coverage.status],["Requested range", `${coverage.requestedFromBlock}–${coverage.requestedToBlock}`],["Covered range", `${coverage.coveredFromBlock}–${coverage.coveredToBlock}`],["Finalized through", coverage.finalizedThrough ?? "saved historical interval"],["Last successful scan", coverage.lastSuccessfulScan || state.lastSuccessAt || state.report.createdAt],["Transport", coverage.transport],["Freshness", state.lastSuccessAt ? `${Math.max(0, Math.round((Date.now()-Date.parse(state.lastSuccessAt))/1000))} seconds ago` : "HISTORICAL SAVED EVIDENCE"]];
  entries.forEach(([key,value]) => { const row=node("div","kv"); row.append(node("b","",key),node("span","",value)); root.append(row); });
}

function renderReport() {
  renderCoverage(); const report = state.report;
  const summary = $("#summary"); summary.replaceChildren();
  const values = report ? [["Significant",report.summary.significantEvents],["Below threshold",report.summary.belowThresholdEvents],["Unique events",report.summary.uniqueEvents],["Unknown",report.summary.unknownEvaluations]] : [["Significant",0],["Below threshold",0],["Unique events",0],["Unknown",0]];
  values.forEach(([label,value]) => { const card=node("div","card"); card.append(node("span","",label),node("b","",value)); summary.append(card); });
  const timeline=$("#timeline"); timeline.replaceChildren();
  if (!report?.events?.length) { timeline.textContent="No transfer observations loaded."; timeline.className="empty"; return; }
  timeline.className="";
  const addr=$("#filter-address").value, token=$("#filter-token").value, direction=$("#filter-direction").value, significance=$("#filter-significance").value;
  const events=report.events.filter((event)=>(!addr||event.from===addr||event.to===addr)&&(!token||event.token===token)&&(!direction||event.direction===direction)&&(!significance||event.evaluation===significance));
  if (!events.length) timeline.append(node("div","empty","No events match the current filters."));
  events.forEach((event)=>{
    const card=node("article",`event ${event.evaluation==="BELOW_THRESHOLD"?"below":event.evaluation==="UNKNOWN"?"unknown":""}`); const head=node("div","event-head");
    head.append(node("h3","",`${event.amount ?? event.amountRaw} ${event.symbol}`),node("b",event.evaluation==="SIGNIFICANT"?"SUCCESS":"",event.evaluation)); card.append(head);
    const tags=node("div"); [event.direction,`BLOCK ${event.blockNumber}`,`LOG ${event.logIndex}`].forEach((value)=>tags.append(node("span","tag",value))); card.append(tags);
    card.append(node("p","",event.explanation),node("p","",event.why));
    const from=node("p","address",`FROM ${event.from}${event.watchedFrom?` · ${event.watchedFrom.label} [USER-SUPPLIED]`:""}`); const to=node("p","address",`TO ${event.to} · ${event.destinationLabel}${event.destinationLabelSource==="USER_SUPPLIED"?" [USER-SUPPLIED]":""}`); card.append(from,to);
    const link=node("a","",event.transactionHash); link.href=`https://pharosscan.xyz/tx/${event.transactionHash}`; link.target="_blank"; link.rel="noopener noreferrer"; const tx=node("p","address","TX "); tx.append(link); card.append(tx,node("p","",event.timestamp||"Timestamp unavailable")); timeline.append(card);
  });
  const accounting=$("#accounting"); accounting.replaceChildren();
  Object.values(report.summary.tokens).forEach((item)=>accounting.append(node("div","account-row",`${item.symbol}: external inflow ${item.externalInflowRaw} raw · external outflow ${item.externalOutflowRaw} raw · internal ${item.internalRaw} raw · net external ${item.netExternalRaw} raw · largest ${item.largestRaw} raw`)));
  if (!Object.keys(report.summary.tokens).length) accounting.append(node("div","empty","No significant activity summarized."));
  const wallets=$("#wallets"); wallets.replaceChildren();
  Object.entries(report.summary.perAddress).forEach(([address,item])=>wallets.append(node("div","wallet-row",`${item.label} [USER-SUPPLIED] · ${address} · ${item.events} significant involvement(s)`)));
}

async function refresh() { state=await api("/api/state"); renderConfig(); renderReport(); setMonitoring(state.monitoring); setStatus(state.lastError?`Last scan failed without advancing the cursor: ${state.lastError}`:"Workspace restored. Configuration and history are durable and isolated to this browser workspace."); }
function setMonitoring(active){ $("#start").disabled=active; $("#stop").disabled=!active; $("#monitor-state").textContent=active?"MONITOR RUNNING · 15s":"MONITOR STOPPED"; clearInterval(timer); timer=null; if(active) timer=setInterval(()=>runScan(true),15000); }
async function runScan(automatic=false){ try{ $("#scan").disabled=true; setStatus(automatic?"Monitoring poll: scanning the next confirmed block batch…":"Scanning the next confirmed block batch…"); const result=await api("/api/scan",{method:"POST"}); await refresh(); setStatus(result.message||`Fresh scan complete. ${result.insertedCandidates??0} matching token log candidate(s) observed; unified report deduplicated.`);}catch(error){setStatus(error.message)}finally{$("#scan").disabled=false}}

$("#load-example").onclick=async()=>{try{await api("/api/example",{method:"POST"});await refresh();setStatus("Verified five-address example loaded. Run a fresh scan or inspect the versioned saved evidence.")}catch(e){setStatus(e.message)}};
$("#save-config").onclick=async()=>{try{const result=await api("/api/config",{method:"PUT",body:JSON.stringify(state.config)});state.config=result.config;await refresh();setStatus(result.note)}catch(e){setStatus(e.message)}};
$("#scan").onclick=()=>runScan(false); $("#start").onclick=async()=>{try{const x=await api("/api/monitor/start",{method:"POST"});setMonitoring(true);setStatus(`Monitoring started. Honest client-driven polling interval: ${x.intervalSeconds} seconds; state persists across refresh.`);await runScan(true)}catch(e){setStatus(e.message)}}; $("#stop").onclick=async()=>{try{await api("/api/monitor/stop",{method:"POST"});setMonitoring(false);setStatus("Monitoring stopped. Cursor and saved history are preserved.")}catch(e){setStatus(e.message)}};
$("#add-address").onclick=()=>{if(state.config.addresses.length>=20)return;state.config.addresses.push({address:"",label:"New watched address"});renderConfig()}; $("#add-token").onclick=()=>{if(state.config.tokens.length>=8)return;state.config.tokens.push({address:"",symbol:"UNKNOWN",decimals:null,threshold:"1"});renderConfig()};
for(const id of ["filter-address","filter-token","filter-direction","filter-significance"]) $("#"+id).onchange=renderReport;
async function download(path,name){const response=await fetch(path,{headers:{"x-watch-workspace":workspace}});if(!response.ok){const body=await response.json();throw new Error(body.error||`HTTP ${response.status}`)}const blob=await response.blob();const href=URL.createObjectURL(blob);const link=document.createElement("a");link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000)}
$("#json-export").onclick=async(event)=>{event.preventDefault();try{await download("/api/export/json","whale-watch-report.json")}catch(e){setStatus(e.message)}}; $("#csv-export").onclick=async(event)=>{event.preventDefault();try{await download("/api/export/csv","whale-watch-report.csv")}catch(e){setStatus(e.message)}};
for(const [id,file] of [["evidence-report","v1-live-report.json"],["evidence-raw","v1-live-raw.json"],["evidence-tools","mcp-discovery-v1.json"]]) $("#"+id).onclick=async()=>{try{const response=await fetch(`/evidence/${file}`);const body=await response.json();$("#evidence").textContent=JSON.stringify(body,null,2);if(file.includes("report")){state.report=body;renderReport();setStatus("HISTORICAL SAVED EVIDENCE loaded. It is not relabeled as a fresh scan.")}}catch(e){setStatus(e.message)}};

api("/api/meta").then((meta)=>$("#engine").textContent=`${meta.engineVersion} · chain ${meta.chainId} · ${meta.runtimeTransport}`).catch((e)=>$("#engine").textContent=e.message);
refresh().catch((e)=>setStatus(e.message));
