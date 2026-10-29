import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const profile = path.join(root, '.edge-ui-test');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
await fs.mkdir(artifacts, { recursive: true });

const demoState = {
  settings: { concurrency: 1, root: 'XJTU', defaultTrack: 'ENCODER' },
  scanState: { state: 'idle', done: 0, total: 0 },
  catalog: {
    updatedAt: Date.now(),
    sourceTabId: 1,
    courses: [
      {
        id: 33122, name: '物质结构与性质-无机篇', code: '202620271CHEM25190902', semester: '第1学期',
        replays: [], materials: [], homework: [],
        resources: [
          { key: 'replay:1299146', kind: 'replay', source: '课程回放', activityId: 1299146, courseId: 33122, courseName: '物质结构与性质-无机篇', activityTitle: '2026-09-14 19:40 回放', name: '2026-09-14 19:40 回放', size: 1269765739 },
          { key: 'upload:1413335:6488594', kind: 'upload', source: '课件附件', activityId: 1413335, courseId: 33122, courseName: '物质结构与性质-无机篇', activityTitle: '第一章', name: '第1章 原子结构(1).pdf', uploadId: 6488594, referenceId: 3214697, size: 16376925 },
          { key: 'upload:1597298:7878878', kind: 'upload', source: '作业附件', activityId: 1597298, courseId: 33122, courseName: '物质结构与性质-无机篇', activityTitle: 'Lecture-2', name: 'Keys_Chapter 4-2(3).png', uploadId: 7878878, referenceId: 3861914, size: 140072 },
          { key: 'embedded:1597298:85308d8c', kind: 'embedded', source: '页面嵌入文件', activityId: 1597298, courseId: 33122, courseName: '物质结构与性质-无机篇', activityTitle: 'Lecture-2', name: '页面示例图片.png', fileKey: '85308d8c', size: null }
        ]
      },
      { id: 33557, name: '计算之美', code: '202620271COMP30102701', semester: '第1学期', replays: [], materials: [], homework: [] }
    ]
  },
  tasks: [
    { id: 'a', kind: 'replay', activityTitle: '物质结构与性质-无机篇 2026-09-14 19:40', courseName: '物质结构与性质-无机篇', label: 'ENCODER', state: 'downloading', bytesReceived: 146800000, totalBytes: 292914261 },
    { id: 'b', kind: 'replay', activityTitle: '物质结构与性质-无机篇 2026-09-14 19:40', courseName: '物质结构与性质-无机篇', label: 'INSTRUCTOR', state: 'queued', bytesReceived: 0, totalBytes: 976851478 },
    { id: 'c', kind: 'pdf', uploadName: '第1章 原子结构(1).pdf', courseName: '物质结构与性质-无机篇', state: 'completed', downloadId: 22, bytesReceived: 16376925, totalBytes: 16376925 },
    { id: 'd', kind: 'replay', activityTitle: '计算之美 2026-09-15 10:00', courseName: '计算之美', label: 'ENCODER', state: 'failed', bytesReceived: 0, totalBytes: 0, error: '登录状态已失效，请重新登录思源学堂' }
  ]
};

const mock = `<script>
const demoState = ${JSON.stringify(demoState)};
const demoActivity = { ok: true, context: { kind: 'activity', courseId: 33122, activityId: 1299146 }, course: { id: 33122, name: '物质结构与性质-无机篇' }, activity: { id: 1299146, type: 'lesson', title: '物质结构与性质-无机篇 中3-3303 2026-09-14 19:40:00-20:30:00', size: 1269765739, tracks: [{ label: 'INSTRUCTOR', mute: true }, { label: 'ENCODER', mute: false }], uploads: [] } };
window.chrome = {
  runtime: {
    sendMessage: async message => {
      if (message.type === 'GET_ACTIVITY_CONTEXT') return demoActivity;
      if (message.type === 'GET_STATE') return { ok: true, ...demoState };
      return { ok: true, ...demoState };
    },
    onMessage: { addListener() {} },
    getURL: value => value,
    openOptionsPage() {}
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://lms.xjtu.edu.cn/course/33122/learning-activity#/1299146' }],
    create() {}, get: async () => ({ id: 1 })
  },
  downloads: { show() {} }
};
</script>`;

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root)) throw new Error('invalid path');
    let body = await fs.readFile(file);
    if (file.endsWith('popup.html') || file.endsWith('manager.html')) {
      body = Buffer.from(body.toString('utf8').replace('<script src=', `${mock}<script src=`));
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

async function screenshot(url, output, size) {
  if (!existsSync(edge)) throw new Error('未找到 Edge，无法执行界面渲染测试');
  const args = [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--force-device-scale-factor=1', '--hide-scrollbars', `--user-data-dir=${profile}`,
    `--window-size=${size}`, `--screenshot=${output}`, url
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(edge, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('界面渲染超时'));
    }, 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Edge 退出码 ${code}`));
    });
  });
  const stat = await fs.stat(output);
  if (stat.size < 1000) throw new Error('界面截图为空');
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await screenshot(`http://127.0.0.1:${port}/popup/popup.html`, path.join(artifacts, 'popup.png'), '384,620');
  await screenshot(`http://127.0.0.1:${port}/manager/manager.html?view=tasks`, path.join(artifacts, 'manager.png'), '1280,850');
  await screenshot(`http://127.0.0.1:${port}/manager/manager.html?view=courses`, path.join(artifacts, 'courses.png'), '1280,850');
  console.log('UI smoke screenshots created');
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(profile, { recursive: true, force: true });
}
