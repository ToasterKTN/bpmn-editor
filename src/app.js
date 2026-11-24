import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule
} from 'bpmn-js-properties-panel';
import { FormEditor } from '@bpmn-io/form-js-editor';
import { Form } from '@bpmn-io/form-js-viewer';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import '@bpmn-io/form-js-viewer/dist/assets/form-js.css';
import '@bpmn-io/form-js-viewer/dist/assets/flatpickr/light.css';
import '@bpmn-io/form-js-editor/dist/assets/form-js-editor.css';
import './app.css';

import NEW_DIAGRAM from './new-diagram.bpmn';
import NEW_FORM from './new-form.json';

const $ = (id) => document.getElementById(id);

const docs = {
  bpmn: { name: null, mtime: null, dirty: false, ownSaveAt: 0, pendingDisk: false },
  form: { name: null, mtime: null, dirty: false, ownSaveAt: 0, pendingDisk: false }
};
const state = { serverMode: false, mode: 'bpmn' };
let skipFormDirty = false;
let formViewer = null;
let previewTimer = null;

function current() { return docs[state.mode]; }

function kindOf(name) {
  return name && /\.form$/i.test(name) ? 'form' : 'bpmn';
}

const modeler = new BpmnModeler({
  container: '#canvas',
  propertiesPanel: { parent: '#properties' },
  additionalModules: [ BpmnPropertiesPanelModule, BpmnPropertiesProviderModule ]
});
window.bpmnModeler = modeler;

const formEditor = new FormEditor({ container: '#form-editor' });
window.formEditor = formEditor;

function setMsg(text, cls) {
  const el = $('status-msg');
  el.textContent = text || '';
  el.className = cls || '';
}

function refreshStatus() {
  const doc = current();
  const untitled = state.mode === 'form' ? 'Unbenanntes Formular' : 'Unbenanntes Diagramm';
  $('status-file').textContent = doc.name || untitled;
  $('status-dirty').textContent = doc.dirty ? '● ungespeichert' : '';
  $('status-dirty').className = doc.dirty ? 'dirty' : '';
  const modeLabel = state.serverMode ? 'Ordner-Modus' : 'Browser-Modus (ohne Server)';
  $('status-mode').textContent = modeLabel + ' · ' + (state.mode === 'form' ? 'Formular' : 'BPMN');
  const titleName = doc.name || 'Unbenannt';
  document.title = (doc.dirty ? '● ' : '') + titleName + ' – Prozess-Editor';
  $('btn-reload').disabled = !(state.serverMode && doc.name);
  document.querySelectorAll('#file-list li').forEach((li) => {
    li.classList.toggle('active', li.dataset.name === doc.name);
  });
}

function setMode(next) {
  if (next !== 'bpmn' && next !== 'form') return;
  state.mode = next;
  $('tab-bpmn').classList.toggle('active', next === 'bpmn');
  $('tab-form').classList.toggle('active', next === 'form');
  $('tab-bpmn').setAttribute('aria-selected', String(next === 'bpmn'));
  $('tab-form').setAttribute('aria-selected', String(next === 'form'));
  $('workspace-bpmn').classList.toggle('is-hidden', next !== 'bpmn');
  $('workspace-form').classList.toggle('is-hidden', next !== 'form');
  $('btn-svg').hidden = next !== 'bpmn';
  document.body.dataset.mode = next;
  if (next === 'bpmn') {
    requestAnimationFrame(() => { try { fitDiagram(); } catch {} });
  } else {
    schedulePreview();
  }
  refreshStatus();
  const doc = current();
  if (doc.name) history.replaceState(null, '', '#' + encodeURIComponent(doc.name));
}

function fitDiagram() {
  const canvas = modeler.get('canvas');
  canvas.zoom('fit-viewport');
  const vb = canvas.viewbox();
  const scale = vb.scale || 1;
  const padL = 90 / scale;
  const padR = 40 / scale;
  const padY = 48 / scale;
  canvas.viewbox({
    x: vb.inner.x - padL,
    y: vb.inner.y - padY,
    width: vb.inner.width + padL + padR,
    height: vb.inner.height + padY * 2
  });
}

function bannerEls() {
  const id = state.mode === 'form' ? 'disk-banner-form' : 'disk-banner-bpmn';
  return $(id);
}

function showBanner(text) {
  const el = bannerEls();
  el.querySelector('.disk-banner-text').textContent = text;
  el.classList.add('visible');
}
function hideBanner(kind) {
  const ids = kind ? [ kind === 'form' ? 'disk-banner-form' : 'disk-banner-bpmn' ] : [ 'disk-banner-form', 'disk-banner-bpmn' ];
  ids.forEach((id) => $(id).classList.remove('visible'));
}

async function importXml(xml, name, mtime) {
  const doc = docs.bpmn;
  try {
    const { warnings } = await modeler.importXML(xml);
    doc.name = name;
    doc.mtime = mtime ?? null;
    doc.dirty = false;
    doc.pendingDisk = false;
    hideBanner('bpmn');
    fitDiagram();
    if (state.mode === 'bpmn') {
      setMsg(warnings.length ? `Geladen mit ${warnings.length} Warnung(en)` : 'Geladen', warnings.length ? 'err' : 'ok');
    }
    if (warnings.length) console.warn(warnings);
  } catch (err) {
    console.error(err);
    setMsg('Fehler beim Laden: ' + err.message, 'err');
    alert('Diagramm konnte nicht geladen werden:\n' + err.message);
  }
  refreshStatus();
}

async function importForm(schema, name, mtime) {
  const doc = docs.form;
  skipFormDirty = true;
  try {
    const schemaObj = typeof schema === 'string' ? JSON.parse(schema) : schema;
    await formEditor.importSchema(schemaObj);
    doc.name = name;
    doc.mtime = mtime ?? null;
    doc.dirty = false;
    doc.pendingDisk = false;
    hideBanner('form');
    await refreshPreview();
    if (state.mode === 'form') setMsg('Geladen', 'ok');
  } catch (err) {
    console.error(err);
    setMsg('Fehler beim Laden: ' + err.message, 'err');
    alert('Formular konnte nicht geladen werden:\n' + err.message);
  } finally {
    skipFormDirty = false;
  }
  refreshStatus();
}

function confirmDiscard(kind = state.mode) {
  return !docs[kind].dirty || confirm('Ungespeicherte Änderungen verwerfen?');
}

async function getXml() {
  const { xml } = await modeler.saveXML({ format: true });
  return xml;
}

function getFormText() {
  return JSON.stringify(formEditor.saveSchema(), null, 2) + '\n';
}

function download(content, fileName, mime) {
  const blob = new Blob([ content ], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function defaultName(kind = state.mode) {
  if (kind === 'form') return docs.form.name || 'neues-formular.form';
  return docs.bpmn.name || 'neues-diagramm.bpmn';
}

function baseName(kind = state.mode) {
  const name = docs[kind].name || (kind === 'form' ? 'formular.form' : 'diagramm.bpmn');
  return name.replace(/\.(bpmn|form)$/i, '');
}

function normalizeName(name, kind = state.mode) {
  name = (name || '').trim().replace(/[\\/]/g, '-');
  if (!name) return null;
  const ext = kind === 'form' ? '.form' : '.bpmn';
  if (kind === 'form' && /\.bpmn$/i.test(name)) name = name.replace(/\.bpmn$/i, ext);
  if (kind === 'bpmn' && /\.form$/i.test(name)) name = name.replace(/\.form$/i, ext);
  if (!new RegExp(ext.replace('.', '\\.') + '$', 'i').test(name)) name += ext;
  return name;
}

async function refreshPreview() {
  const schema = formEditor.saveSchema();
  const host = $('form-preview');
  if (formViewer) {
    try { formViewer.destroy(); } catch {}
    formViewer = null;
    host.innerHTML = '';
  }
  formViewer = new Form({ container: host });
  window.formViewer = formViewer;
  try {
    await formViewer.importSchema(schema, {});
  } catch (err) {
    console.warn('preview', err);
  }
  formViewer.on('submit', (event) => {
    setMsg('Vorschau abgesendet' + (event.errors && Object.keys(event.errors).length ? ' (mit Fehlern)' : ''), 'ok');
  });
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { refreshPreview().catch((e) => console.warn(e)); }, 200);
}

async function api(path, opts) {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

async function refreshFiles() {
  if (!state.serverMode) return;
  const { files } = await (await api('/api/files')).json();
  const list = $('file-list');
  list.innerHTML = '';
  if (!files.length) {
    const li = document.createElement('div');
    li.className = 'file-empty';
    li.textContent = 'Noch keine Dateien. „Speichern" legt eine .bpmn- oder .form-Datei an.';
    list.appendChild(li);
  }
  for (const f of files) {
    const li = document.createElement('li');
    li.dataset.name = f.name;
    li.title = f.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = kindOf(f.name) === 'form' ? 'form' : 'bpmn';
    const n = document.createElement('span');
    n.textContent = f.name;
    n.style.flex = '1';
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = new Date(f.mtimeMs).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
    li.append(kind, n, m);
    li.addEventListener('click', () => openFromServer(f.name));
    list.appendChild(li);
  }
  refreshStatus();
  return files;
}

async function openFromServer(name, { force = false } = {}) {
  const kind = kindOf(name);
  if (!force && name !== docs[kind].name && !confirmDiscard(kind)) return;
  const res = await api('/api/files/' + encodeURIComponent(name));
  const text = await res.text();
  const mtime = Number(res.headers.get('X-File-Mtime'));
  if (kind === 'form') {
    setMode('form');
    await importForm(text, name, mtime);
  } else {
    setMode('bpmn');
    await importXml(text, name, mtime);
  }
  history.replaceState(null, '', '#' + encodeURIComponent(name));
}

async function saveToServer(name) {
  const kind = kindOf(name);
  const body = kind === 'form' ? getFormText() : await getXml();
  const doc = docs[kind];
  doc.ownSaveAt = Date.now();
  const res = await api('/api/files/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Content-Type': kind === 'form' ? 'application/json; charset=utf-8' : 'application/xml; charset=utf-8' },
    body
  });
  const info = await res.json();
  doc.name = name;
  doc.mtime = info.mtimeMs;
  doc.dirty = false;
  doc.pendingDisk = false;
  hideBanner(kind);
  history.replaceState(null, '', '#' + encodeURIComponent(name));
  setMsg('Gespeichert ' + new Date().toLocaleTimeString('de-CH'), 'ok');
  await refreshFiles();
}

async function checkDisk() {
  if (!state.serverMode) return;
  const files = await refreshFiles().catch(() => null);
  if (!files) return;
  for (const kind of [ 'bpmn', 'form' ]) {
    const doc = docs[kind];
    if (!doc.name || Date.now() - doc.ownSaveAt < 1500) continue;
    const f = files.find((x) => x.name === doc.name);
    if (!f || doc.mtime == null || f.mtimeMs === doc.mtime) continue;
    if (!doc.dirty) {
      const prev = state.mode;
      await openFromServer(doc.name, { force: true });
      if (prev !== state.mode) setMode(prev);
      if (kind === state.mode) setMsg('Von Festplatte aktualisiert ' + new Date().toLocaleTimeString('de-CH'), 'ok');
    } else if (kind === state.mode && !doc.pendingDisk) {
      doc.pendingDisk = true;
      showBanner('„' + doc.name + '" wurde auf der Festplatte geändert. Du hast ungespeicherte Änderungen.');
    }
  }
}

function watchServer() {
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(checkDisk, 200); };
  if ('EventSource' in window) {
    const es = new EventSource('/api/events');
    es.onmessage = debounced;
  }
  setInterval(checkDisk, 4000);
}

async function actionNew() {
  if (!confirmDiscard()) return;
  if (state.mode === 'form') {
    await importForm(NEW_FORM, null, null);
  } else {
    await importXml(NEW_DIAGRAM, null, null);
  }
  history.replaceState(null, '', location.pathname + location.search);
}

function actionOpen() {
  if (!confirmDiscard()) return;
  $('open-input').value = '';
  $('open-input').click();
}

$('open-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const kind = kindOf(file.name);
  setMode(kind);
  if (kind === 'form') await importForm(text, file.name, null);
  else await importXml(text, file.name, null);
  if (state.serverMode) {
    current().mtime = null;
    current().dirty = true;
    setMsg('Importiert – „Speichern" legt die Datei im Ordner ab', '');
    refreshStatus();
  }
});

async function actionSave() {
  if (state.serverMode) {
    if (!current().name) return actionSaveAs();
    try { await saveToServer(current().name); } catch (err) { setMsg('Speichern fehlgeschlagen: ' + err.message, 'err'); alert(err.message); }
  } else {
    await actionDownload();
  }
}

function actionSaveAs() {
  if (!state.serverMode) return actionDownload();
  const modal = $('modal-saveas');
  const input = $('saveas-name');
  const ext = state.mode === 'form' ? '.form' : '.bpmn';
  $('saveas-hint').textContent = 'Dateiname im Ordner (endet auf ' + ext + '):';
  input.value = defaultName();
  modal.hidden = false;
  modal.classList.add('visible');
  input.focus();
  input.select();
}

async function confirmSaveAs() {
  const name = normalizeName($('saveas-name').value);
  if (!name) return;
  closeModal('modal-saveas');
  try {
    const files = await (await api('/api/files')).json();
    if (name !== current().name && files.files.some((f) => f.name === name) && !confirm(`„${name}" existiert bereits. Überschreiben?`)) return;
    await saveToServer(name);
  } catch (err) {
    setMsg('Speichern fehlgeschlagen: ' + err.message, 'err');
    alert(err.message);
  }
}

async function actionDownload() {
  if (state.mode === 'form') {
    download(getFormText(), baseName() + '.form', 'application/json');
  } else {
    download(await getXml(), baseName() + '.bpmn', 'application/xml');
  }
  if (!state.serverMode) {
    current().dirty = false;
    refreshStatus();
  }
  setMsg('Heruntergeladen', 'ok');
}

async function actionSvg() {
  if (state.mode !== 'bpmn') return;
  const { svg } = await modeler.saveSVG();
  download(svg, baseName('bpmn') + '.svg', 'image/svg+xml');
  setMsg('SVG exportiert', 'ok');
}

async function actionReload() {
  const doc = current();
  if (!state.serverMode || !doc.name) return;
  if (!confirmDiscard()) return;
  doc.dirty = false;
  await openFromServer(doc.name, { force: true });
}

function closeModal(id) {
  const m = $(id);
  m.classList.remove('visible');
  m.hidden = true;
}

$('tab-bpmn').onclick = () => setMode('bpmn');
$('tab-form').onclick = () => setMode('form');
$('btn-new').onclick = actionNew;
$('btn-open').onclick = actionOpen;
$('btn-save').onclick = actionSave;
$('btn-save-as').onclick = actionSaveAs;
$('btn-download').onclick = actionDownload;
$('btn-svg').onclick = actionSvg;
$('btn-reload').onclick = actionReload;
document.querySelectorAll('.btn-reload-banner').forEach((btn) => {
  btn.onclick = async () => { current().dirty = false; await openFromServer(current().name, { force: true }); };
});
document.querySelectorAll('.btn-dismiss-banner').forEach((btn) => {
  btn.onclick = () => { hideBanner(state.mode); current().mtime = null; };
});
$('btn-help').onclick = () => { $('modal-help').hidden = false; $('modal-help').classList.add('visible'); };
$('help-close').onclick = () => closeModal('modal-help');
$('saveas-cancel').onclick = () => closeModal('modal-saveas');
$('saveas-ok').onclick = confirmSaveAs;
$('saveas-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmSaveAs();
  if (e.key === 'Escape') closeModal('modal-saveas');
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) {
    if (e.key === 'Escape') { closeModal('modal-help'); closeModal('modal-saveas'); }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? actionSaveAs() : actionSave(); }
  else if (k === 'o') { e.preventDefault(); actionOpen(); }
  else if (k === 'n' && e.altKey === false) { e.preventDefault(); actionNew(); }
}, true);

modeler.on('commandStack.changed', () => {
  docs.bpmn.dirty = true;
  if (state.mode === 'bpmn') refreshStatus();
});

formEditor.on('changed', () => {
  if (skipFormDirty) return;
  docs.form.dirty = true;
  if (state.mode === 'form') refreshStatus();
  schedulePreview();
});

window.addEventListener('hashchange', () => {
  const wanted = decodeURIComponent(location.hash.slice(1) || '');
  if (!wanted) return;
  if (state.serverMode) openFromServer(wanted).catch((err) => { setMsg(err.message, 'err'); });
  else setMode(kindOf(wanted));
});

window.addEventListener('beforeunload', (e) => {
  if (docs.bpmn.dirty || docs.form.dirty) { e.preventDefault(); e.returnValue = ''; }
});

window.__editor = {
  mode: () => state.mode,
  setMode,
  getXml,
  getFormText,
  save: actionSave
};

(async function init() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) {
      const st = await res.json();
      state.serverMode = true;
      $('files-dir').textContent = st.dir;
    }
  } catch {}

  if (!state.serverMode) {
    $('files-panel').classList.add('hidden');
    $('btn-reload').style.display = 'none';
    $('btn-save').textContent = 'Speichern (Download)';
    $('btn-save-as').style.display = 'none';
  }

  await importXml(NEW_DIAGRAM, null, null);
  await importForm(NEW_FORM, null, null);

  const wanted = decodeURIComponent(location.hash.slice(1) || '');
  if (state.serverMode) {
    const files = await refreshFiles();
    const pick = files.find((f) => f.name === wanted) || null;
    if (pick) await openFromServer(pick.name, { force: true });
    else if (wanted && kindOf(wanted) === 'form') setMode('form');
    watchServer();
  }
  refreshStatus();
})();
