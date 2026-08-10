/* ============================================================
   CorDex Editor — app.js
   Single-file app logic. No build step, no framework — plain
   DOM + CodeMirror 5, everything persisted to localStorage.
   ============================================================ */
(function(){
"use strict";

/* ---------------------------------------------------------
   0. CONSTANTS / LANGUAGE TABLE
   --------------------------------------------------------- */
const STORAGE_KEY = "cordex_editor_v1";

const LANG = {
  html: { label:"HTML",       mime:"htmlmixed",   cls:"lang-html", icon:"H",  run:"html" },
  css:  { label:"CSS",        mime:"css",         cls:"lang-css",  icon:"C",  run:"css"  },
  js:   { label:"JavaScript", mime:"javascript",  cls:"lang-js",   icon:"J",  run:"js"   },
  py:   { label:"Python",     mime:"python",      cls:"lang-py",   icon:"Py", run:"py"   },
  sql:  { label:"SQL",        mime:"text/x-sql",  cls:"lang-sql",  icon:"Q",  run:"sql"  },
  cs:   { label:"C#",         mime:"text/x-csharp", cls:"lang-cs", icon:"C#", run:"none" },
  kt:   { label:"Kotlin",     mime:"text/x-kotlin", cls:"lang-kt", icon:"Kt", run:"none" },
};
const ALLOWED_EXT = Object.keys(LANG);

const QUICK_FILES = ["index.html","style.css","script.js","main.py","query.sql","Program.cs","Main.kt"];

const STARTERS = {
  html: (n)=>`<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>My Page</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello, world!</h1>\n  <p>Edit me in the Editor tab.</p>\n  <button id="btn">Click me</button>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
  css: (n)=>`body {\n  font-family: sans-serif;\n  background: #101418;\n  color: #eaf3f1;\n  text-align: center;\n  padding-top: 60px;\n}\n\nbutton {\n  padding: 10px 18px;\n  border: none;\n  border-radius: 8px;\n  background: #34f5d4;\n  cursor: pointer;\n}\n`,
  js: (n)=>`console.log("Hello from ${n}");\n\nconst btn = document.getElementById("btn");\nif (btn) {\n  btn.addEventListener("click", () => {\n    console.log("Button was clicked!");\n  });\n}\n`,
  py: (n)=>`print("Hello from ${n}")\n\nfor i in range(3):\n    print("Counting:", i)\n`,
  sql:(n)=>`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO users (name) VALUES ('Ada'), ('Grace');\nSELECT * FROM users;\n`,
  cs: (n)=>`using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello from ${n}");\n    }\n}\n`,
  kt: (n)=>`fun main() {\n    println("Hello from ${n}")\n}\n`,
};

/* ---------------------------------------------------------
   1. STATE + STORAGE
   --------------------------------------------------------- */
let state = null;

function defaultState(){
  return {
    version: 1,
    settings: { theme: "default", autoClose: true, fontSize: 14 },
    projects: [],
    lastProjectId: null,
    lastFileId: null,
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return seedState();
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.projects)) return seedState();
    return Object.assign(defaultState(), parsed);
  }catch(e){
    console.warn("CorDex Editor: failed to load saved state, starting fresh.", e);
    return seedState();
  }
}

function seedState(){
  const s = defaultState();
  const now = Date.now();
  const files = [
    mkFile("index.html", STARTERS.html("index.html")),
    mkFile("style.css", STARTERS.css("style.css")),
    mkFile("script.js", STARTERS.js("script.js")),
  ];
  s.projects.push({
    id: uid(), name: "Welcome Site", createdAt: now, updatedAt: now, files,
  });
  return s;
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  }catch(e){
    console.error("CorDex Editor: could not save — storage may be full or unavailable.", e);
    return false;
  }
}

/* ---------------------------------------------------------
   2. HELPERS
   --------------------------------------------------------- */
function uid(){ return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function mkFile(name, content){
  const now = Date.now();
  return { id: uid(), name, content: content||"", pinned:false, createdAt: now, updatedAt: now };
}

function getExt(filename){
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function getLang(filename){
  return LANG[getExt(filename)] || { label:"Text", mime:"text/plain", cls:"lang-txt", icon:"T", run:"none" };
}

function findProject(id){ return state.projects.find(p => p.id === id) || null; }
function findFile(project, id){ return project ? project.files.find(f => f.id === id) || null : null; }
function findFileByBasename(project, href){
  if(!project) return null;
  const clean = href.split("?")[0].split("#")[0].split("/").pop().trim().toLowerCase();
  return project.files.find(f => f.name.toLowerCase() === clean) || null;
}

function debounce(fn, ms){
  let t = null;
  return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), ms); };
}

function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if(s < 10) return "just now";
  if(s < 60) return s+"s ago";
  const m = Math.floor(s/60); if(m < 60) return m+"m ago";
  const h = Math.floor(m/60); if(h < 24) return h+"h ago";
  const d = Math.floor(h/24); if(d < 30) return d+"d ago";
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function toast(msg, ms){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(()=> el.classList.add("show"));
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{
    el.classList.remove("show");
    setTimeout(()=>{ el.hidden = true; }, 200);
  }, ms||2200);
}

/* ---------------------------------------------------------
   3. TAB NAVIGATION
   --------------------------------------------------------- */
let activeTab = "projects";

function switchTab(name){
  activeTab = name;
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  updateTopbarContext();
  if(name === "files") renderFiles();
  if(name === "projects") renderProjects();
  if(name === "editor") closeFileSwitchMenu();
}

function updateTopbarContext(){
  const el = document.getElementById("topbarContext");
  if(activeTab === "files" && state.lastProjectId){
    const p = findProject(state.lastProjectId);
    el.textContent = p ? p.name : "";
  } else if(activeTab === "editor" && currentFile){
    const p = findProject(state.lastProjectId);
    el.textContent = (p ? p.name+" / " : "") + currentFile.name;
  } else {
    el.textContent = "";
  }
}

document.getElementById("bottomNav").addEventListener("click", (e)=>{
  const btn = e.target.closest(".nav-btn");
  if(!btn) return;
  switchTab(btn.dataset.tab);
});

/* ---------------------------------------------------------
   4. SHEET (bottom modal) SYSTEM
   --------------------------------------------------------- */
const sheetBackdrop = document.getElementById("sheetBackdrop");
const sheetEl = document.getElementById("sheet");
const sheetContent = document.getElementById("sheetContent");

function openSheet(html){
  sheetContent.innerHTML = html;
  sheetEl.hidden = false;
  sheetBackdrop.hidden = false;
  requestAnimationFrame(()=>{
    sheetEl.classList.add("show");
    sheetBackdrop.classList.add("show");
    const firstInput = sheetContent.querySelector("input");
    if(firstInput) setTimeout(()=>firstInput.focus(), 260);
  });
}
function closeSheet(){
  sheetEl.classList.remove("show");
  sheetBackdrop.classList.remove("show");
  setTimeout(()=>{ sheetEl.hidden = true; sheetBackdrop.hidden = true; sheetContent.innerHTML = ""; }, 250);
}
sheetBackdrop.addEventListener("click", closeSheet);

/* ---------------------------------------------------------
   5. PROJECTS TAB
   --------------------------------------------------------- */
function renderProjects(){
  const list = document.getElementById("projectsList");
  const empty = document.getElementById("projectsEmpty");
  const count = document.getElementById("projectsCount");

  count.textContent = state.projects.length === 0 ? "No projects yet"
    : state.projects.length === 1 ? "1 project" : state.projects.length+" projects";

  if(state.projects.length === 0){
    list.innerHTML = "";
    empty.classList.add("show");
    return;
  }
  empty.classList.remove("show");

  const sorted = [...state.projects].sort((a,b)=> b.updatedAt - a.updatedAt);
  list.innerHTML = sorted.map(p => `
    <div class="card" data-project-id="${p.id}">
      <div class="card-icon">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(p.name)}</div>
        <div class="card-meta">${p.files.length} file${p.files.length===1?"":"s"} · updated ${timeAgo(p.updatedAt)}</div>
      </div>
      <div class="card-actions">
        <button class="card-action-btn danger" data-action="delete-project" data-id="${p.id}" aria-label="Delete project">🗑</button>
      </div>
      <span class="card-chevron">›</span>
    </div>
  `).join("");
}

document.getElementById("projectsList").addEventListener("click", (e)=>{
  const delBtn = e.target.closest("[data-action='delete-project']");
  if(delBtn){ sheetDeleteProject(delBtn.dataset.id); return; }
  const card = e.target.closest(".card[data-project-id]");
  if(card){ openProject(card.dataset.projectId); }
});

function openProject(id){
  state.lastProjectId = id;
  saveState();
  switchTab("files");
}

document.getElementById("btnNewProject").addEventListener("click", sheetNewProject);
document.getElementById("btnNewProjectEmpty").addEventListener("click", sheetNewProject);

function sheetNewProject(){
  openSheet(`
    <div class="sheet-title">New project</div>
    <p class="sheet-desc">Give it a name — you can rename by creating a new one and moving files later.</p>
    <input class="sheet-input" id="npInput" placeholder="Project name" maxlength="40" autocomplete="off">
    <div class="sheet-error" id="npError"></div>
    <div class="sheet-actions">
      <button class="sheet-btn cancel" id="npCancel">Cancel</button>
      <button class="sheet-btn confirm" id="npConfirm">Create</button>
    </div>
  `);
  const input = document.getElementById("npInput");
  const err = document.getElementById("npError");
  document.getElementById("npCancel").addEventListener("click", closeSheet);
  const confirm = ()=>{
    const name = input.value.trim();
    if(!name){ err.textContent = "Give your project a name."; return; }
    if(state.projects.some(p => p.name.toLowerCase() === name.toLowerCase())){
      err.textContent = "You already have a project with that name."; return;
    }
    const now = Date.now();
    const project = { id: uid(), name, createdAt: now, updatedAt: now, files: [] };
    state.projects.push(project);
    saveState();
    closeSheet();
    toast(`"${name}" created`);
    openProject(project.id);
  };
  document.getElementById("npConfirm").addEventListener("click", confirm);
  input.addEventListener("keydown", e => { if(e.key === "Enter") confirm(); });
}

function sheetDeleteProject(id){
  const p = findProject(id);
  if(!p) return;
  openSheet(`
    <div class="sheet-title">Delete "${escapeHtml(p.name)}"?</div>
    <p class="sheet-desc">This removes the project and all ${p.files.length} file${p.files.length===1?"":"s"} inside it. This can't be undone.</p>
    <div class="sheet-actions">
      <button class="sheet-btn cancel" id="dpCancel">Cancel</button>
      <button class="sheet-btn confirm danger" id="dpConfirm">Delete</button>
    </div>
  `);
  document.getElementById("dpCancel").addEventListener("click", closeSheet);
  document.getElementById("dpConfirm").addEventListener("click", ()=>{
    p.files.forEach(f => docs.delete(f.id));
    state.projects = state.projects.filter(x => x.id !== id);
    if(state.lastProjectId === id) state.lastProjectId = null;
    if(currentProject && currentProject.id === id){ currentProject = null; currentFile = null; unloadEditor(); }
    saveState();
    closeSheet();
    toast("Project deleted");
    renderProjects();
    renderFiles();
  });
}

/* ---------------------------------------------------------
   6. FILES TAB
   --------------------------------------------------------- */
function renderFiles(){
  const project = state.lastProjectId ? findProject(state.lastProjectId) : null;
  const list = document.getElementById("filesList");
  const empty = document.getElementById("filesEmpty");
  const noProject = document.getElementById("filesNoProject");
  const title = document.getElementById("filesProjectName");
  const count = document.getElementById("filesCount");

  if(!project){
    list.innerHTML = "";
    empty.classList.remove("show");
    noProject.classList.add("show");
    title.textContent = "Files";
    count.textContent = "Select a project";
    return;
  }
  noProject.classList.remove("show");
  title.textContent = project.name;
  count.textContent = project.files.length === 0 ? "No files yet"
    : project.files.length === 1 ? "1 file" : project.files.length + " files";

  if(project.files.length === 0){
    list.innerHTML = "";
    empty.classList.add("show");
    return;
  }
  empty.classList.remove("show");

  const pinned = project.files.filter(f=>f.pinned).sort((a,b)=>a.name.localeCompare(b.name));
  const rest = project.files.filter(f=>!f.pinned).sort((a,b)=>a.name.localeCompare(b.name));
  const ordered = [...pinned, ...rest];

  list.innerHTML = ordered.map(f => {
    const lang = getLang(f.name);
    return `
    <div class="card" data-file-id="${f.id}">
      <div class="card-icon ${lang.cls}">${escapeHtml(lang.icon)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(f.name)}</div>
        <div class="card-meta">${lang.label} · updated ${timeAgo(f.updatedAt)}</div>
      </div>
      <div class="card-actions">
        <button class="card-action-btn ${f.pinned?"pinned":""}" data-action="pin-file" data-id="${f.id}" aria-label="Pin file">${f.pinned?"📌":"📍"}</button>
        <button class="card-action-btn danger" data-action="delete-file" data-id="${f.id}" aria-label="Delete file">🗑</button>
      </div>
      <span class="card-chevron">›</span>
    </div>`;
  }).join("");
}

document.getElementById("filesList").addEventListener("click", (e)=>{
  const project = findProject(state.lastProjectId);
  const pinBtn = e.target.closest("[data-action='pin-file']");
  if(pinBtn){
    const f = findFile(project, pinBtn.dataset.id);
    if(f){ f.pinned = !f.pinned; saveState(); renderFiles(); }
    return;
  }
  const delBtn = e.target.closest("[data-action='delete-file']");
  if(delBtn){ sheetDeleteFile(project, delBtn.dataset.id); return; }
  const card = e.target.closest(".card[data-file-id]");
  if(card){
    const f = findFile(project, card.dataset.fileId);
    if(f) openFileInEditor(project, f, true);
  }
});

document.getElementById("btnGoProjects").addEventListener("click", ()=> switchTab("projects"));
document.getElementById("btnNewFile").addEventListener("click", sheetNewFile);
document.getElementById("btnNewFileEmpty").addEventListener("click", sheetNewFile);

function validateFilename(name, project, excludeId){
  if(!name) return "Enter a file name.";
  const ext = getExt(name);
  if(!ext || !ALLOWED_EXT.includes(ext)){
    return `Use one of: ${ALLOWED_EXT.map(e=>"."+e).join(", ")}`;
  }
  if(/[\/\\]/.test(name)) return "File names can't contain slashes.";
  const dup = project.files.some(f => f.id !== excludeId && f.name.toLowerCase() === name.toLowerCase());
  if(dup) return "A file with that name already exists.";
  return null;
}

function sheetNewFile(){
  const project = findProject(state.lastProjectId);
  if(!project){ toast("Open a project first"); switchTab("projects"); return; }
  openSheet(`
    <div class="sheet-title">New file</div>
    <p class="sheet-desc">Name it with an extension — .html .css .js .py .sql .cs .kt</p>
    <div class="sheet-chip-row" id="nfChips">
      ${QUICK_FILES.map(n=>`<button class="sheet-chip" data-name="${n}">${n}</button>`).join("")}
    </div>
    <input class="sheet-input" id="nfInput" placeholder="filename.ext" autocomplete="off" spellcheck="false">
    <div class="sheet-error" id="nfError"></div>
    <div class="sheet-actions">
      <button class="sheet-btn cancel" id="nfCancel">Cancel</button>
      <button class="sheet-btn confirm" id="nfConfirm">Create</button>
    </div>
  `);
  const input = document.getElementById("nfInput");
  const err = document.getElementById("nfError");
  document.getElementById("nfChips").addEventListener("click", (e)=>{
    const chip = e.target.closest(".sheet-chip");
    if(!chip) return;
    let name = chip.dataset.name;
    if(project.files.some(f=>f.name.toLowerCase()===name.toLowerCase())){
      const [base, ext] = [name.substring(0,name.lastIndexOf(".")), getExt(name)];
      let i = 2;
      while(project.files.some(f=>f.name.toLowerCase() === `${base}${i}.${ext}`.toLowerCase())) i++;
      name = `${base}${i}.${ext}`;
    }
    input.value = name;
    input.focus();
  });
  document.getElementById("nfCancel").addEventListener("click", closeSheet);
  const confirm = ()=>{
    const name = input.value.trim();
    const errMsg = validateFilename(name, project, null);
    if(errMsg){ err.textContent = errMsg; return; }
    const ext = getExt(name);
    const content = STARTERS[ext] ? STARTERS[ext](name) : "";
    const file = mkFile(name, content);
    project.files.push(file);
    project.updatedAt = Date.now();
    saveState();
    closeSheet();
    toast(`${name} created`);
    renderFiles();
    openFileInEditor(project, file, true);
  };
  document.getElementById("nfConfirm").addEventListener("click", confirm);
  input.addEventListener("keydown", e=>{ if(e.key === "Enter") confirm(); });
}

function sheetDeleteFile(project, fileId){
  const f = findFile(project, fileId);
  if(!f) return;
  openSheet(`
    <div class="sheet-title">Delete "${escapeHtml(f.name)}"?</div>
    <p class="sheet-desc">This can't be undone.</p>
    <div class="sheet-actions">
      <button class="sheet-btn cancel" id="dfCancel">Cancel</button>
      <button class="sheet-btn confirm danger" id="dfConfirm">Delete</button>
    </div>
  `);
  document.getElementById("dfCancel").addEventListener("click", closeSheet);
  document.getElementById("dfConfirm").addEventListener("click", ()=>{
    docs.delete(f.id);
    project.files = project.files.filter(x => x.id !== fileId);
    project.updatedAt = Date.now();
    if(currentFile && currentFile.id === fileId){ currentFile = null; unloadEditor(); }
    saveState();
    closeSheet();
    toast("File deleted");
    renderFiles();
  });
}

/* ---------------------------------------------------------
   7. EDITOR TAB (CodeMirror)
   --------------------------------------------------------- */
let cm = null;
const docs = new Map(); // fileId -> CodeMirror.Doc
let currentProject = null;
let currentFile = null;

function initEditor(){
  cm = CodeMirror(document.getElementById("cmHost"), {
    mode: "htmlmixed",
    theme: cmThemeName(),
    lineNumbers: true,
    lineWrapping: true,
    autoCloseBrackets: state.settings.autoClose,
    autoCloseTags: state.settings.autoClose,
    matchBrackets: true,
    styleActiveLine: true,
    tabSize: 2,
    indentUnit: 2,
    scrollbarStyle: "simple",
    value: "",
  });
  document.getElementById("cmHost").style.fontSize = state.settings.fontSize + "px";

  cm.on("changes", ()=>{
    if(!currentFile) return;
    currentFile.content = cm.getValue();
    setSavedStatus("unsaved");
    debouncedPersist();
  });
  cm.on("cursorActivity", ()=>{
    const c = cm.getCursor();
    document.getElementById("statusCursor").textContent = `Ln ${c.line+1}, Col ${c.ch+1}`;
  });
}

const debouncedPersist = debounce(()=>{
  if(currentProject) currentProject.updatedAt = Date.now();
  saveState();
  setSavedStatus("saved");
}, 450);

function setSavedStatus(mode){
  const el = document.getElementById("statusSaved");
  const dot = document.getElementById("fsDirty");
  if(mode === "saved"){ el.textContent = "Saved"; el.className = ""; dot.hidden = true; }
  else if(mode === "unsaved"){ el.textContent = "Saving…"; el.className = "unsaved"; dot.hidden = false; }
  else if(mode === "error"){ el.textContent = "Error"; el.className = "error"; }
}

function getDocForFile(file){
  if(!docs.has(file.id)){
    const lang = getLang(file.name);
    docs.set(file.id, new CodeMirror.Doc(file.content || "", lang.mime));
  }
  return docs.get(file.id);
}

function openFileInEditor(project, file, jumpToTab){
  currentProject = project;
  currentFile = file;
  state.lastProjectId = project.id;
  state.lastFileId = file.id;
  saveState();

  if(!cm) initEditor();
  const lang = getLang(file.name);
  cm.swapDoc(getDocForFile(file));
  cm.setOption("mode", lang.mime);
  cm.refresh();

  document.getElementById("fsIcon").textContent = lang.icon;
  document.getElementById("fsName").textContent = file.name;
  document.getElementById("statusLang").textContent = lang.label;
  setSavedStatus("saved");
  document.getElementById("editorEmpty").classList.remove("show");
  document.getElementById("btnRun").disabled = false;
  updateTopbarContext();

  if(jumpToTab) switchTab("editor");
  else renderEditorChrome();
}

function unloadEditor(){
  document.getElementById("fsIcon").textContent = "◌";
  document.getElementById("fsName").textContent = "No file open";
  document.getElementById("statusLang").textContent = "—";
  document.getElementById("statusCursor").textContent = "Ln 1, Col 1";
  document.getElementById("editorEmpty").classList.add("show");
  document.getElementById("btnRun").disabled = true;
  if(cm) cm.swapDoc(new CodeMirror.Doc("", "text/plain"));
  updateTopbarContext();
}

function renderEditorChrome(){
  if(currentFile){
    const lang = getLang(currentFile.name);
    document.getElementById("fsIcon").textContent = lang.icon;
    document.getElementById("fsName").textContent = currentFile.name;
  }
}

/* file switcher dropdown */
const fileSwitchBtn = document.getElementById("fileSwitchBtn");
const fileSwitchMenu = document.getElementById("fileSwitchMenu");

fileSwitchBtn.addEventListener("click", ()=>{
  if(!currentProject){ toast("Open a project first"); return; }
  if(fileSwitchMenu.hidden){ openFileSwitchMenu(); } else { closeFileSwitchMenu(); }
});
document.addEventListener("click", (e)=>{
  if(!fileSwitchMenu.hidden && !e.target.closest("#fileSwitch")) closeFileSwitchMenu();
});

function openFileSwitchMenu(){
  const files = [...currentProject.files].sort((a,b)=>a.name.localeCompare(b.name));
  fileSwitchMenu.innerHTML = files.map(f=>{
    const lang = getLang(f.name);
    const isCurrent = currentFile && f.id === currentFile.id;
    return `<button class="fs-menu-item ${isCurrent?"current":""}" data-id="${f.id}"><span class="fs-icon">${lang.icon}</span>${escapeHtml(f.name)}</button>`;
  }).join("") || `<div style="padding:12px;font-size:13px;color:var(--text-dim)">No files in this project</div>`;
  fileSwitchMenu.hidden = false;
}
function closeFileSwitchMenu(){ fileSwitchMenu.hidden = true; }

fileSwitchMenu.addEventListener("click", (e)=>{
  const item = e.target.closest(".fs-menu-item");
  if(!item) return;
  const f = findFile(currentProject, item.dataset.id);
  closeFileSwitchMenu();
  if(f) openFileInEditor(currentProject, f, false);
});

/* ---------------------------------------------------------
   8. RUN / EXECUTE
   --------------------------------------------------------- */
const previewFrame = document.getElementById("previewFrame");
const previewEmpty = document.getElementById("previewEmpty");
const consolePanel = document.getElementById("consolePanel");
const consoleBody = document.getElementById("consoleBody");
const previewSub = document.getElementById("previewSub");

let lastRun = null; // {project, file}

document.getElementById("btnRun").addEventListener("click", ()=>{
  if(!currentFile || !currentProject) return;
  runFile(currentProject, currentFile);
});
document.getElementById("btnPreviewRefresh").addEventListener("click", ()=>{
  if(lastRun) runFile(lastRun.project, lastRun.file, true);
  else toast("Nothing to refresh yet");
});
document.getElementById("btnClearConsole").addEventListener("click", ()=>{ consoleBody.innerHTML = ""; });

function clearConsole(){ consoleBody.innerHTML = ""; }
function logLine(kind, text){
  const div = document.createElement("div");
  div.className = "console-line " + kind;
  div.textContent = text;
  consoleBody.appendChild(div);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

function showPreviewFrame(){
  previewEmpty.classList.remove("show");
  previewFrame.hidden = false;
}
function hidePreviewFrame(){
  previewFrame.hidden = true;
}
function showConsole(){ consolePanel.hidden = false; }
function hideConsole(){ consolePanel.hidden = true; }

function runFile(project, file, isRefresh){
  lastRun = { project, file };
  const lang = getLang(file.name);
  previewEmpty.classList.remove("show");

  switch(lang.run){
    case "html": runHtml(project, file); break;
    case "css":  runCssOrJs(project, file); break;
    case "js":   runCssOrJs(project, file); break;
    case "py":   runPython(file); break;
    case "sql":  runSql(file); break;
    default:     runUnsupported(file); break;
  }
  if(!isRefresh) switchTab("preview");
}

/* ---- HTML / CSS / JS (browser-native) ---- */
function replaceLinksAndScripts(html, project, usedNames){
  html = html.replace(/<link\b[^>]*>/gi, (tag)=>{
    const relMatch = /rel=["']?([^"'\s>]+)/i.exec(tag);
    const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
    if(relMatch && /stylesheet/i.test(relMatch[1]) && hrefMatch){
      const f = findFileByBasename(project, hrefMatch[1]);
      if(f){ usedNames.add(f.id); return `<style>\n/* ${f.name} */\n${f.content}\n</style>`; }
    }
    return tag;
  });
  html = html.replace(/<script\b([^>]*)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, pre, src)=>{
    const f = findFileByBasename(project, src);
    if(f){ usedNames.add(f.id); return `<script>\n/* ${f.name} */\n${f.content}\n</script>`; }
    return m;
  });
  return html;
}

const CONSOLE_BRIDGE = `
<script>
(function(){
  function send(kind, args){
    try{
      var msg = Array.prototype.slice.call(args).map(function(a){
        if(a instanceof Error) return a.message;
        if(typeof a === "object") { try { return JSON.stringify(a); } catch(e){ return String(a); } }
        return String(a);
      }).join(" ");
      parent.postMessage({ source:"cordex-console", kind: kind, text: msg }, "*");
    }catch(e){}
  }
  ["log","warn","error","info"].forEach(function(k){
    var orig = console[k];
    console[k] = function(){ send(k, arguments); orig && orig.apply(console, arguments); };
  });
  window.addEventListener("error", function(e){
    send("error", [ (e.message||"Script error") + " (line " + e.lineno + ")" ]);
  });
  window.addEventListener("unhandledrejection", function(e){
    send("error", [ "Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason) ]);
  });
})();
</script>`;

window.addEventListener("message", (e)=>{
  if(e.data && e.data.source === "cordex-console"){
    logLine(e.data.kind === "error" ? "err" : e.data.kind === "warn" ? "warn" : "log", e.data.text);
  }
});

function runHtml(project, htmlFile){
  clearConsole();
  const usedNames = new Set();
  let html = replaceLinksAndScripts(htmlFile.content, project, usedNames);

  // auto-attach any css/js files never referenced, so beginners
  // don't have to wire up <link>/<script> tags to see results.
  const unreferencedCss = project.files.filter(f => getExt(f.name)==="css" && !usedNames.has(f.id));
  const unreferencedJs  = project.files.filter(f => getExt(f.name)==="js"  && !usedNames.has(f.id));
  const extraStyles = unreferencedCss.map(f=>`<style>\n/* ${f.name} */\n${f.content}\n</style>`).join("\n");
  const extraScripts = unreferencedJs.map(f=>`<script>\n/* ${f.name} */\n${f.content}\n</script>`).join("\n");

  if(/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, extraStyles + CONSOLE_BRIDGE + "\n</head>");
  else html = CONSOLE_BRIDGE + extraStyles + html;

  if(/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, extraScripts + "\n</body>");
  else html = html + extraScripts;

  showPreviewFrame();
  showConsole();
  previewFrame.srcdoc = html;
  previewSub.textContent = `Live preview of ${htmlFile.name}`;
}

function runCssOrJs(project, file){
  const htmlFile = project.files.find(f => getExt(f.name)==="html");
  if(htmlFile){
    runHtml(project, htmlFile);
    previewSub.textContent = `${file.name} → previewed via ${htmlFile.name}`;
    return;
  }
  const ext = getExt(file.name);
  clearConsole();
  hidePreviewFrame();
  showConsole();
  if(ext === "css"){
    logLine("info", "This project has no HTML file yet, so there's nothing to attach this stylesheet to.");
    logLine("info", "Add an index.html file to preview styles visually.");
    previewSub.textContent = "No HTML file in this project";
    return;
  }
  // standalone JS — run in a sandboxed iframe with console capture only
  const html = `<!DOCTYPE html><html><head>${CONSOLE_BRIDGE}</head><body><script>\ntry{\n${file.content}\n}catch(err){ console.error(err.message || String(err)); }\n</script></body></html>`;
  previewFrame.srcdoc = html;
  previewSub.textContent = `Console output for ${file.name}`;
}

/* ---- Python (Pyodide) ---- */
let pyodidePromise = null;
function ensurePyodide(){
  if(pyodidePromise) return pyodidePromise;
  logLine("info", "Loading Python runtime (first run only)…");
  pyodidePromise = new Promise((resolve, reject)=>{
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js";
    script.onload = async ()=>{
      try{
        const py = await window.loadPyodide();
        resolve(py);
      }catch(err){ reject(err); }
    };
    script.onerror = ()=> reject(new Error("Couldn't load the Python runtime — check your connection."));
    document.head.appendChild(script);
  });
  return pyodidePromise;
}

async function runPython(file){
  clearConsole();
  hidePreviewFrame();
  showConsole();
  previewSub.textContent = `Running ${file.name}`;
  try{
    const py = await ensurePyodide();
    py.setStdout({ batched: (s)=> logLine("log", s) });
    py.setStderr({ batched: (s)=> logLine("err", s) });
    await py.runPythonAsync(file.content);
    logLine("info", "Finished.");
  }catch(err){
    logLine("err", err && err.message ? err.message : String(err));
  }
}

/* ---- SQL (sql.js) ---- */
let sqlJsPromise = null;
function ensureSqlJs(){
  if(sqlJsPromise) return sqlJsPromise;
  logLine("info", "Loading SQL runtime (first run only)…");
  sqlJsPromise = new Promise((resolve, reject)=>{
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js";
    script.onload = async ()=>{
      try{
        const SQL = await window.initSqlJs({ locateFile: f => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}` });
        resolve(SQL);
      }catch(err){ reject(err); }
    };
    script.onerror = ()=> reject(new Error("Couldn't load the SQL runtime — check your connection."));
    document.head.appendChild(script);
  });
  return sqlJsPromise;
}

function formatTable(columns, values){
  const widths = columns.map((c,i)=> Math.max(c.length, ...values.map(r=>String(r[i]).length), 3));
  const pad = (s,w)=> String(s) + " ".repeat(Math.max(0, w-String(s).length));
  let out = columns.map((c,i)=>pad(c,widths[i])).join(" | ") + "\n";
  out += widths.map(w=>"-".repeat(w)).join("-+-") + "\n";
  values.forEach(r => { out += r.map((v,i)=>pad(v===null?"NULL":v, widths[i])).join(" | ") + "\n"; });
  return out;
}

async function runSql(file){
  clearConsole();
  hidePreviewFrame();
  showConsole();
  previewSub.textContent = `Running ${file.name}`;
  try{
    const SQL = await ensureSqlJs();
    const db = new SQL.Database();
    try{
      const results = db.exec(file.content);
      if(results.length === 0){
        logLine("info", "Statement(s) executed successfully. No rows returned.");
      } else {
        results.forEach(res => logLine("log", formatTable(res.columns, res.values)));
      }
    }catch(err){
      logLine("err", err.message || String(err));
    }finally{
      db.close();
    }
  }catch(err){
    logLine("err", err && err.message ? err.message : String(err));
  }
}

/* ---- C# / Kotlin (no in-browser runtime) ---- */
function runUnsupported(file){
  clearConsole();
  hidePreviewFrame();
  showConsole();
  const lang = getLang(file.name);
  previewSub.textContent = `${lang.label} — editing only`;
  logLine("info", `${lang.label} can't run directly in the browser, so there's no live executor for it here.`);
  logLine("info", `You can still write and organize ${file.name} — copy it into an online compiler (like .NET Fiddle for C#, or the Kotlin Playground) or your own local toolchain to run it.`);
}

/* ---------------------------------------------------------
   9. SETTINGS TAB
   --------------------------------------------------------- */
function cmThemeName(){ return state.settings.theme === "light" ? "eclipse" : "dracula"; }

function applyTheme(name){
  state.settings.theme = name;
  document.body.setAttribute("data-theme", name);
  document.querySelectorAll(".segmented-btn").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === name));
  if(cm) cm.setOption("theme", cmThemeName());
  saveState();
}

document.getElementById("themeSegmented").addEventListener("click", (e)=>{
  const btn = e.target.closest(".segmented-btn");
  if(!btn) return;
  applyTheme(btn.dataset.themeChoice);
});

document.getElementById("toggleAutoClose").addEventListener("change", (e)=>{
  state.settings.autoClose = e.target.checked;
  if(cm){ cm.setOption("autoCloseBrackets", e.target.checked); cm.setOption("autoCloseTags", e.target.checked); }
  saveState();
});

document.getElementById("fontStepper").addEventListener("click", (e)=>{
  const btn = e.target.closest(".stepper-btn");
  if(!btn) return;
  const delta = parseInt(btn.dataset.step, 10);
  state.settings.fontSize = Math.min(22, Math.max(11, state.settings.fontSize + delta));
  document.getElementById("fontSizeVal").textContent = state.settings.fontSize;
  document.getElementById("cmHost").style.fontSize = state.settings.fontSize + "px";
  if(cm) cm.refresh();
  saveState();
});

document.getElementById("btnExportData").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "cordex-editor-export.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Export downloaded");
});

document.getElementById("btnDeleteAll").addEventListener("click", ()=>{
  openSheet(`
    <div class="sheet-title">Delete all projects?</div>
    <p class="sheet-desc">This permanently removes every project and file stored in this browser. This can't be undone.</p>
    <div class="sheet-actions">
      <button class="sheet-btn cancel" id="daCancel">Cancel</button>
      <button class="sheet-btn confirm danger" id="daConfirm">Delete everything</button>
    </div>
  `);
  document.getElementById("daCancel").addEventListener("click", closeSheet);
  document.getElementById("daConfirm").addEventListener("click", ()=>{
    docs.clear();
    state.projects = [];
    state.lastProjectId = null; state.lastFileId = null;
    currentProject = null; currentFile = null;
    unloadEditor();
    saveState();
    closeSheet();
    toast("All projects deleted");
    renderProjects();
    renderFiles();
  });
});

/* ---------------------------------------------------------
   10. INIT
   --------------------------------------------------------- */
function init(){
  state = loadState();
  document.body.setAttribute("data-theme", state.settings.theme);
  document.querySelectorAll(".segmented-btn").forEach(b => b.classList.toggle("active", b.dataset.themeChoice === state.settings.theme));
  document.getElementById("toggleAutoClose").checked = state.settings.autoClose;
  document.getElementById("fontSizeVal").textContent = state.settings.fontSize;

  saveState();
  renderProjects();
  renderFiles();
  switchTab("projects");
}

document.addEventListener("DOMContentLoaded", init);

})();
