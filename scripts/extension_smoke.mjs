import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = path.join(root, '.edge-extension-test');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { return await check(); } catch {}
    await sleep(200);
  }
  throw new Error(`等待超时：${label}`);
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.error ? reject(new Error(data.error.message)) : resolve(data.result);
  });
  return {
    async call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async open() {
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
    },
    close() { socket.close(); }
  };
}

let child;
try {
  if (!existsSync(edge)) throw new Error('未找到 Edge');
  await fs.rm(profile, { recursive: true, force: true });
  child = spawn(edge, [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    `--user-data-dir=${profile}`, `--disable-extensions-except=${root}`, `--load-extension=${root}`,
    '--remote-debugging-port=0', 'about:blank'
  ], { stdio: 'ignore' });

  const portFile = path.join(profile, 'DevToolsActivePort');
  const port = await waitFor(async () => {
    const text = await fs.readFile(portFile, 'utf8');
    return Number(text.split(/\r?\n/)[0]);
  }, 15000, '浏览器调试端口');

  const worker = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    const target = targets.find(item => item.type === 'service_worker' && item.url.endsWith('/background.js'));
    if (!target) throw new Error('后台尚未启动');
    return target;
  }, 15000, 'MV3 后台服务');
  const extensionId = new URL(worker.url).hostname;

  const created = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extensionId}/manager/manager.html`, { method: 'PUT' });
  const manager = await created.json();
  const cdp = connect(manager.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Runtime.enable');
  await waitFor(async () => {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `document.querySelector('.brand strong')?.textContent`,
      returnByValue: true
    });
    if (result.result.value !== '仙交学习工具') throw new Error('管理页尚未加载');
    return true;
  }, 10000, '扩展管理页');
  const state = await cdp.call('Runtime.evaluate', {
    expression: `chrome.runtime.sendMessage({type:'GET_STATE'})`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!state.result.value?.ok) throw new Error(`后台通信失败：${JSON.stringify(state.result)}`);
  const manifest = await cdp.call('Runtime.evaluate', {
    expression: `chrome.runtime.getManifest().name`,
    returnByValue: true
  });
  console.log(JSON.stringify({ loaded: true, extensionId, name: manifest.result.value, background: true, manager: true }));
  cdp.close();

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = connect(version.webSocketDebuggerUrl);
  await browser.open();
  await browser.call('Browser.close');
  browser.close();
} finally {
  if (child && child.exitCode === null && !child.killed) child.kill();
  const cleanupCommand = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*edge-extension-test*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  await new Promise(resolve => {
    const cleaner = spawn('powershell.exe', ['-NoProfile', '-Command', cleanupCommand], { stdio: 'ignore' });
    cleaner.on('error', resolve);
    cleaner.on('exit', resolve);
  });
  await sleep(500);
  let cleanupError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      cleanupError = null;
      break;
    } catch (error) {
      cleanupError = error;
      await sleep(1000);
    }
  }
  if (cleanupError) throw cleanupError;
}
