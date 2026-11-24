import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const BpmnModdle = require('bpmn-moddle').BpmnModdle || require('bpmn-moddle');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.VERIFY_PORT) || 3456;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const filesDir = process.env.BPMN_FILES || '/workspace/bpmn-files';
const bpmnShot = process.env.SCREENSHOT || '/workspace/bpmn-editor-screenshot.png';
const formShot = process.env.FORM_SCREENSHOT || '/workspace/form-editor-screenshot.png';
const chromePath = process.env.CHROME || '/usr/bin/google-chrome';
const binary = process.env.EDITOR_BIN || path.join(root, 'binaries', 'bpmn-editor-linux-amd64');

function waitFor(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('Server startete nicht: ' + url));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}

async function api(pathname, { method = 'GET', body, type } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: body ? { 'Content-Type': type || 'text/plain; charset=utf-8' } : undefined,
    body
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function parseBpmn(xml) {
  const moddle = new BpmnModdle();
  return moddle.fromXML(xml);
}

function collect(rootEl) {
  const names = [], ids = [];
  (function walk(el) {
    if (!el || typeof el !== 'object') return;
    if (el.id) ids.push(el.id);
    if (el.name) names.push(el.name);
    for (const key of Object.keys(el)) {
      const v = el[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.$type) walk(v);
    }
  })(rootEl);
  return { names, ids };
}

const sampleBpmn = await fs.readFile(path.join(root, 'diagrams', 'bestellprozess.bpmn'), 'utf8');
const sampleForm = await fs.readFile(path.join(root, 'diagrams', 'bestellung.form'), 'utf8');

const server = spawn(binary, [ '-port', String(PORT), filesDir ], {
  cwd: root,
  env: { ...process.env },
  stdio: [ 'ignore', 'pipe', 'pipe' ]
});
server.stdout.on('data', (d) => process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));
const cleanup = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);

try {
  await waitFor(BASE + '/api/status');

  const putB = await api('/api/files/bestellprozess.bpmn', { method: 'PUT', body: sampleBpmn, type: 'application/xml; charset=utf-8' });
  if (putB.status !== 200) throw new Error('PUT bpmn failed: ' + putB.status + ' ' + putB.text);
  const gotB = await api('/api/files/bestellprozess.bpmn');
  if (gotB.status !== 200 || !gotB.text.includes('Process_Bestellprozess')) throw new Error('GET bpmn failed');
  const parsed = await parseBpmn(gotB.text);
  if (parsed.warnings?.length) console.warn('moddle warnings', parsed.warnings);
  const first = collect(parsed.rootElement);
  for (const n of [ 'Bestellprozess', 'Bestellung prüfen', 'Zahlung prüfen' ]) {
    if (!first.names.includes(n)) throw new Error('Missing BPMN name: ' + n);
  }
  console.log('BPMN API+moddle ok');

  const putF = await api('/api/files/bestellung.form', { method: 'PUT', body: sampleForm, type: 'application/json; charset=utf-8' });
  if (putF.status !== 200) throw new Error('PUT form failed: ' + putF.status + ' ' + putF.text);
  const gotF = await api('/api/files/bestellung.form');
  if (gotF.status !== 200) throw new Error('GET form failed');
  const formObj = JSON.parse(gotF.text);
  if (formObj.type !== 'default' || !Array.isArray(formObj.components)) throw new Error('form schema invalid');
  const keys = formObj.components.map((c) => c.key).filter(Boolean);
  for (const k of [ 'name', 'email', 'bestellnummer', 'artikel', 'anzahl', 'kommentar', 'agb' ]) {
    if (!keys.includes(k)) throw new Error('Missing form key: ' + k);
  }
  console.log('form API+JSON ok, keys:', keys.join(', '));

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [ '--no-sandbox', '--disable-gpu', '--window-size=1440,900' ],
    defaultViewport: { width: 1440, height: 900 }
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('pageerror', err));

  await page.goto(BASE + '/#bestellprozess.bpmn', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#canvas .djs-container, #canvas svg, #canvas .bjs-container');
    const file = document.getElementById('status-file');
    const tab = document.getElementById('tab-bpmn');
    return canvas && file && file.textContent.includes('bestellprozess.bpmn') && tab?.classList.contains('active');
  }, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: bpmnShot, fullPage: true });
  console.log('bpmn screenshot:', bpmnShot);

  const savedXml = await page.evaluate(async () => window.__editor.getXml());
  if (!savedXml.includes('Process_Bestellprozess')) throw new Error('Editor saveXML missing process id');
  const putB2 = await api('/api/files/bestellprozess-roundtrip.bpmn', { method: 'PUT', body: savedXml, type: 'application/xml; charset=utf-8' });
  if (putB2.status !== 200) throw new Error('PUT bpmn roundtrip failed');
  const second = collect((await parseBpmn((await api('/api/files/bestellprozess-roundtrip.bpmn')).text)).rootElement);
  for (const n of first.names) {
    if (!second.names.includes(n)) throw new Error('BPMN name lost in round-trip: ' + n);
  }

  await page.goto(BASE + '/#bestellung.form', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Ensure a full load even if a previous hash navigation was same-document.
  await page.waitForFunction(() => document.getElementById('file-list'), { timeout: 20000 });
  const opened = await page.evaluate(async () => {
    const item = document.querySelector('#file-list li[data-name="bestellung.form"]');
    if (item) { item.click(); return 'click'; }
    if (window.__editor) { window.__editor.setMode('form'); return 'mode'; }
    return 'none';
  });
  console.log('open form via', opened);
  await page.waitForFunction(() => {
    const editor = document.querySelector('#form-editor .fjs-container, #form-editor .fjs-editor-container');
    const preview = document.querySelector('#form-preview .fjs-container, #form-preview form, #form-preview input');
    const file = document.getElementById('status-file');
    const tab = document.getElementById('tab-form');
    return editor && preview && file && file.textContent.includes('bestellung.form') && tab?.classList.contains('active');
  }, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: formShot, fullPage: true });
  console.log('form screenshot:', formShot);

  const savedForm = await page.evaluate(() => window.__editor.getFormText());
  const savedObj = JSON.parse(savedForm);
  const savedKeys = savedObj.components.map((c) => c.key).filter(Boolean);
  for (const k of keys) {
    if (!savedKeys.includes(k)) throw new Error('form key lost in editor save: ' + k);
  }
  const putF2 = await api('/api/files/bestellung-roundtrip.form', { method: 'PUT', body: savedForm, type: 'application/json; charset=utf-8' });
  if (putF2.status !== 200) throw new Error('PUT form roundtrip failed: ' + putF2.status + ' ' + putF2.text);
  const back = JSON.parse((await api('/api/files/bestellung-roundtrip.form')).text);
  const backKeys = back.components.map((c) => c.key).filter(Boolean);
  for (const k of keys) {
    if (!backKeys.includes(k)) throw new Error('form key lost in API round-trip: ' + k);
  }

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.getElementById('status-msg')?.textContent?.startsWith('Gespeichert'), { timeout: 5000 });

  // auto-reload: stay on the form tab, change the file on disk
  let onDisk = await fs.readFile(path.join(filesDir, 'bestellung.form'), 'utf8');
  if (!onDisk.includes('"label": "Name"')) throw new Error('unexpected form before auto-reload');
  onDisk = onDisk.replace('"label": "Name"', '"label": "Name (aktualisiert)"');
  await fs.writeFile(path.join(filesDir, 'bestellung.form'), onDisk);
  await page.waitForFunction(() => document.body.innerText.includes('Name (aktualisiert)') ||
    (document.getElementById('status-msg')?.textContent || '').includes('Festplatte'), { timeout: 10000 });
  console.log('form auto-reload ok');
  onDisk = (await fs.readFile(path.join(filesDir, 'bestellung.form'), 'utf8')).replace('"label": "Name (aktualisiert)"', '"label": "Name"');
  await fs.writeFile(path.join(filesDir, 'bestellung.form'), onDisk);

  const status = JSON.parse((await api('/api/status')).text);
  const listed = status.files.map((f) => f.name);
  for (const n of [ 'bestellprozess.bpmn', 'bestellung.form', 'bestellung-roundtrip.form' ]) {
    if (!listed.includes(n)) throw new Error('File list incomplete: ' + listed.join(', '));
  }

  await browser.close();
  console.log('VERIFY OK');
  console.log('files dir:', status.dir);
  console.log('listed:', listed.join(', '));
} finally {
  cleanup();
  await new Promise((r) => setTimeout(r, 300));
}
