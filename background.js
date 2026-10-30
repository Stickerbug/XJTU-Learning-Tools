import {
  TRACKS,
  parseLmsUrl,
  parsePlayerUrl,
  selectVideos,
  summarizeCourse,
  normalizeTodos,
  parseMediaUrl,
  findEmbeddedMedia,
  buildReplayFilename,
  buildUploadFilename,
  assertDownloadUrl,
  assertZyxfFileUrl,
  normalizeMarkedRules,
  cleanError
} from './shared/core.js';

const DEFAULT_SETTINGS = { concurrency: 1, root: 'XJTU', defaultTrack: 'ENCODER' };
let settings = { ...DEFAULT_SETTINGS };
let tasks = [];
let catalog = { courses: [], updatedAt: null, sourceTabId: null };
let scanState = { state: 'idle', done: 0, total: 0, courseName: '' };
let pumping = false;
let saveTimer = null;

async function initialize() {
  const stored = await chrome.storage.local.get(['settings', 'tasks', 'catalog']);
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  tasks = Array.isArray(stored.tasks) ? stored.tasks : [];
  catalog = stored.catalog || catalog;
  for (const task of tasks) {
    if (task.state === 'resolving') {
      task.state = 'queued';
      task.error = '';
    }
  }
}
const ready = initialize();

function publicState() {
  return { settings, tasks, catalog, scanState };
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED' }).catch(() => {});
}

function saveTasksSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ tasks });
    broadcast();
  }, 250);
}

async function sendToLms(tabId, message) {
  if (!tabId) throw new Error('请先打开思源学堂课程页面');
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (!response?.ok) throw new Error(response?.error || '无法读取思源学堂页面，请刷新后重试');
  return response;
}

async function sendToCampus(tabId) {
  if (!tabId) throw new Error('请先打开教务系统或一网通办');
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url || '');
  if (!['jwxt.xjtu.edu.cn', 'ywtb.xjtu.edu.cn'].includes(url.hostname)) {
    throw new Error('请先打开教务系统或一网通办页面');
  }
  const response = await chrome.tabs.sendMessage(tabId, { type: 'CAMPUS_GET_OVERVIEW' });
  if (!response?.ok) throw new Error(response?.error || '无法读取当前校园页面，请刷新后重试');
  return response;
}

function publicActivity(activity, course) {
  return {
    activity: {
      id: activity.id,
      type: activity.type,
      title: activity.title,
      courseId: activity.course_id,
      startTime: activity.start_time,
      endTime: activity.end_time,
      duration: activity.data?.duration || null,
      size: activity.lesson_resource?.size || null,
      status: activity.lesson_resource?.properties?.status || null,
      tracks: (activity.video_suite?.videos || []).map(video => ({
        label: video.label || video.camera_type,
        mute: Boolean(video.mute)
      })),
      uploads: (activity.uploads || []).map(upload => ({
        id: upload.id,
        referenceId: upload.reference_id || null,
        fileKey: upload.key || null,
        name: upload.name,
        size: upload.size,
        status: upload.status,
        type: upload.type,
        allowDownload: upload.allow_download
      }))
    },
    course: { id: course.id, name: course.name, code: course.course_code }
  };
}

function taskKey(kind, activityId, discriminator) {
  return `${kind}:${activityId}:${discriminator}`;
}

function createTask({ kind, originTabId, courseId, courseName, activityId, activityTitle, label, uploadId, referenceId, uploadName, fileKey, source, size, replayCode, liveDirect, submissionId, originUploadName, zyxfId }) {
  const discriminator = kind === 'replay' ? label : kind === 'upload' || kind === 'pdf' ? uploadId : kind === 'marked' ? originUploadName : kind === 'zyxf' ? zyxfId : fileKey;
  const key = taskKey(kind, activityId, discriminator);
  const existing = tasks.find(task => task.key === key && !['completed', 'canceled'].includes(task.state));
  if (existing) return existing;
  const now = Date.now();
  const task = {
    id: `${now}:${Math.random().toString(36).slice(2, 9)}`,
    key,
    kind,
    originTabId,
    courseId,
    courseName,
    activityId,
    activityTitle,
    label: label || null,
    uploadId: uploadId || null,
    referenceId: referenceId || null,
    uploadName: uploadName || null,
    fileKey: fileKey || null,
    source: source || null,
    size: Number(size) || 0,
    replayCode: replayCode || null,
    liveDirect: Boolean(liveDirect),
    submissionId: submissionId || null,
    originUploadName: originUploadName || null,
    zyxfId: zyxfId || null,
    state: 'queued',
    downloadId: null,
    bytesReceived: 0,
    totalBytes: Number(size) || 0,
    error: '',
    createdAt: now,
    updatedAt: now
  };
  tasks.unshift(task);
  return task;
}

async function queueReplay(message) {
  const labels = message.labels?.length ? message.labels : ['ENCODER'];
  for (const label of labels) {
    if (!TRACKS[label]) throw new Error('未知视频轨道');
    createTask({ ...message, kind: 'replay', label });
  }
  await chrome.storage.local.set({ tasks });
  broadcast();
  await pump();
  return { ok: true };
}

async function queuePdf(message) {
  createTask({ ...message, kind: 'upload', source: message.source || '课件附件' });
  await chrome.storage.local.set({ tasks });
  broadcast();
  await pump();
  return { ok: true };
}

const directUrls = new Map();

async function queueDirect(message) {
  const media = parseMediaUrl(message.url);
  const task = createTask({
    kind: 'direct',
    originTabId: message.tabId || catalog.sourceTabId,
    courseId: 0,
    courseName: '媒体直链',
    activityId: 0,
    activityTitle: '',
    uploadName: media.name,
    fileKey: media.fileKey,
    source: '媒体直链'
  });
  directUrls.set(task.id, media.url);
  await chrome.storage.local.set({ tasks });
  broadcast();
  await pump();
  return { ok: true };
}

async function zyxfJson(path) {
  const response = await fetch(`https://zyxf.top${path}`, {
    credentials: 'omit',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) {
    let message = `学辅请求失败（${response.status}）`;
    try {
      const payload = await response.json();
      if (payload?.error) message = String(payload.error);
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function zyxfFileLink(fileId, download = false) {
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的学辅文件 ID');
  const payload = await zyxfJson(`/api/files/${id}/url${download ? '?download=1' : ''}`);
  return { ...payload, url: assertZyxfFileUrl(payload.url) };
}

async function queueZyxf(message) {
  for (const item of message.items || []) {
    const id = Number(item.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    createTask({
      kind: 'zyxf',
      originTabId: null,
      courseId: 0,
      courseName: '仲英学辅',
      activityId: id,
      activityTitle: item.folder_path || '资料库',
      uploadName: item.name,
      source: '仲英学辅',
      size: item.size,
      zyxfId: id
    });
  }
  await chrome.storage.local.set({ tasks });
  broadcast();
  await pump();
  return { ok: true };
}

async function queueBatch(message) {
  const labels = message.trackPreference === 'BOTH' ? ['ENCODER', 'INSTRUCTOR'] : [message.trackPreference || 'ENCODER'];
  for (const item of message.items || []) {
    if (item.kind === 'replay') {
      for (const label of labels) {
        createTask({
          kind: 'replay',
          originTabId: message.sourceTabId,
          courseId: item.courseId,
          courseName: item.courseName,
          activityId: item.activityId,
          activityTitle: item.activityTitle || item.title,
          replayCode: item.replayCode,
          liveDirect: item.liveDirect,
          label
        });
      }
    } else {
      createTask({
        kind: item.kind,
        originTabId: message.sourceTabId,
        courseId: item.courseId,
        courseName: item.courseName,
        activityId: item.activityId,
        activityTitle: item.activityTitle,
        uploadId: item.uploadId,
        referenceId: item.referenceId,
        uploadName: item.name,
        fileKey: item.fileKey,
        source: item.source,
        size: item.size,
        submissionId: item.submissionId,
        originUploadName: item.originUploadName
      });
    }
  }
  await chrome.storage.local.set({ tasks });
  broadcast();
  await pump();
  return { ok: true };
}

async function rmsJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include'
  });
  if (!response.ok) throw new Error(`资源平台请求失败（${response.status}）`);
  const payload = await response.json();
  if (payload.error && payload.error.code !== 0) throw new Error(payload.error.message || '资源平台拒绝了请求');
  return payload;
}

async function resolveReplay(task) {
  if (task.liveDirect) {
    const response = await sendToLms(task.originTabId, {
      type: 'LMS_GET_ACTIVITY',
      courseId: task.courseId,
      activityId: task.activityId
    });
    const videos = response.activity.data?.external_live_detail?.replay_videos || [];
    const video = selectVideos(videos, task.trackId, task.label);
    return {
      url: assertDownloadUrl(video.download_url || video.url),
      filename: buildReplayFilename({ root: settings.root, courseName: task.courseName, activityTitle: task.activityTitle, label: TRACKS[task.label].name }),
      totalBytes: Number(video.size) || 0
    };
  }
  const player = await sendToLms(task.originTabId, {
    type: 'LMS_GET_PLAYER_URL',
    activityId: task.activityId
  });
  const parsed = parsePlayerUrl(player.url);
  const replayCode = task.replayCode || parsed.replayCode;
  const auth = await rmsJson(`https://rms-v5.xjtu.edu.cn/api/v1/auth/embed-token?token=${encodeURIComponent(parsed.token)}`);
  if (!auth.data) throw new Error('资源平台未返回临时访问凭证');
  const detail = await rmsJson(
    `https://rms-v5.xjtu.edu.cn/api/embed/lesson-activities/captures/${replayCode}?lesson_activity_id=${task.activityId}`,
    auth.data
  );
  const video = selectVideos(detail.data?.videos || detail.data?.lesson_videos || detail.lesson_videos || [], task.trackId, task.label);
  return {
    url: assertDownloadUrl(video.download_url),
    filename: buildReplayFilename({
      root: settings.root,
      courseName: task.courseName,
      activityTitle: task.activityTitle,
      label: TRACKS[task.label].name
    }),
    totalBytes: Number(video.size) || 0
  };
}

async function extractPdfInPage(args) {
  const { uploadId, uploadName, timeoutMs } = args;
  const readFileUrl = () => {
    for (const frame of document.querySelectorAll('iframe[src*="note-bene/pdf-viewer"]')) {
      const url = new URL(frame.src, location.href);
      if (Number(url.searchParams.get('upload_id')) !== Number(uploadId)) continue;
      const file = url.searchParams.get('file');
      if (file) return file;
    }
    return null;
  };
  const existing = readFileUrl();
  if (existing) return existing;
  const rows = [...document.querySelectorAll('.attachment-row')];
  let targetRow = null;
  let targetScope = null;
  for (const row of rows) {
    const angular = window.angular;
    if (!angular) break;
    let scope = angular.element(row).scope();
    while (scope) {
      if (Number(scope.upload?.id) === Number(uploadId)) {
        targetRow = row;
        targetScope = scope;
        break;
      }
      scope = scope.$parent;
    }
    if (targetRow) break;
  }
  if (targetScope) {
    let scope = targetScope;
    let activity = null;
    let downloadBlob = null;
    while (scope) {
      activity = activity || scope.activity;
      downloadBlob = downloadBlob || scope.downloadBlob;
      scope = scope.$parent;
    }
    if (typeof downloadBlob === 'function' && activity) {
      downloadBlob(activity, targetScope.upload, 'view');
    } else {
      targetRow.click();
    }
  } else {
    const normalizedName = String(uploadName || '').replace(/\.pdf$/i, '');
    const row = rows.find(item => normalizedName && item.textContent.includes(normalizedName));
    (targetRow || row || rows[0])?.click();
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const file = readFileUrl();
    if (file) return file;
  }
  throw new Error('预览文件地址获取超时，请手动打开资料预览后重试');
}

async function resolvePdf(task) {
  const result = await chrome.scripting.executeScript({
    target: { tabId: task.originTabId },
    world: 'MAIN',
    func: extractPdfInPage,
    args: [{ uploadId: task.uploadId, uploadName: task.uploadName, timeoutMs: 15000 }]
  });
  const value = result[0]?.result;
  if (!value) throw new Error('未能从资料预览中取得文件地址');
  return {
    url: assertDownloadUrl(value),
    filename: buildUploadFilename({ root: settings.root, courseName: task.courseName, uploadName: task.uploadName }),
    totalBytes: 0
  };
}

function resourceFilename(task) {
  return buildUploadFilename({
    root: settings.root,
    courseName: task.courseName,
    uploadName: task.uploadName,
    source: task.source,
    activityTitle: task.activityTitle
  });
}

async function resolveUpload(task) {
  if (task.referenceId) {
    return {
      url: assertDownloadUrl(`https://lms.xjtu.edu.cn/api/uploads/reference/${task.referenceId}/blob`),
      filename: resourceFilename(task),
      totalBytes: task.size || 0
    };
  }
  if (task.uploadId && !/\.pdf$/i.test(task.uploadName || '')) {
    return {
      url: assertDownloadUrl(`https://lms.xjtu.edu.cn/api/uploads/${task.uploadId}/blob`),
      filename: resourceFilename(task),
      totalBytes: task.size || 0
    };
  }
  const resolved = await resolvePdf(task);
  return { ...resolved, filename: resourceFilename(task), totalBytes: task.size || resolved.totalBytes };
}

async function resolveEmbedded(task) {
  const response = await sendToLms(task.originTabId, {
    type: 'LMS_GET_ACTIVITY',
    courseId: task.courseId,
    activityId: task.activityId
  });
  const media = findEmbeddedMedia(response.activity).find(item => item.fileKey === task.fileKey);
  if (!media) throw new Error('页面中的媒体文件已不存在，请重新扫描');
  return {
    url: assertDownloadUrl(media.url),
    filename: resourceFilename(task),
    totalBytes: task.size || 0
  };
}

async function resolveDirect(task) {
  const url = directUrls.get(task.id);
  if (!url) throw new Error('媒体直链只在本次添加时有效，请重新添加');
  return { url: assertDownloadUrl(url), filename: resourceFilename(task), totalBytes: 0 };
}

async function resolveMarked(task) {
  const response = await sendToLms(task.originTabId, { type: 'LMS_GET_MARKED', submissionId: task.submissionId });
  const rule = normalizeMarkedRules(response.data).find(item => item.origin_upload_name === task.originUploadName);
  if (!rule?.url) throw new Error('批注附件已不存在，请重新扫描');
  return { url: assertDownloadUrl(rule.url), filename: resourceFilename(task), totalBytes: task.size || 0 };
}

async function resolveZyxf(task) {
  const link = await zyxfFileLink(task.zyxfId, true);
  return {
    url: link.url,
    filename: resourceFilename(task),
    totalBytes: Number(link.size) || task.size || 0
  };
}

async function resolveTask(task) {
  if (task.kind === 'replay') return resolveReplay(task);
  if (task.kind === 'embedded') return resolveEmbedded(task);
  if (task.kind === 'direct') return resolveDirect(task);
  if (task.kind === 'marked') return resolveMarked(task);
  if (task.kind === 'zyxf') return resolveZyxf(task);
  return resolveUpload(task);
}

async function preflightDownload(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Range: 'bytes=0-255' },
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) throw new Error('文件访问已失效或当前账号无权下载');
    if (!response.ok) throw new Error(`文件请求失败（${response.status}）`);
    const mime = (response.headers.get('content-type') || '').toLowerCase();
    if (mime.includes('text/html') || mime.includes('application/xhtml')) {
      throw new Error('服务器返回了网页而不是文件，请重新登录后重试');
    }
    if (!response.body) return;
    const reader = response.body.getReader();
    const first = await reader.read();
    await reader.cancel().catch(() => {});
    const head = new TextDecoder().decode(first.value || new Uint8Array()).trimStart().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
      throw new Error('服务器返回了网页而不是文件，请重新登录后重试');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAndStart(taskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task) return;
  const generation = (task.generation || 0) + 1;
  task.generation = generation;
  const stale = () => task.generation !== generation || task.state === 'canceled';
  try {
    const resolved = await resolveTask(task);
    if (stale()) return;
    // 学辅签名地址由只读接口即时签发，避免额外跨域预检和消耗二次请求。
    if (task.kind !== 'zyxf') await preflightDownload(resolved.url);
    if (stale()) return;
    task.totalBytes = resolved.totalBytes || task.totalBytes;
    task.filename = resolved.filename;
    task.error = '';
    task.updatedAt = Date.now();
    const downloadId = await chrome.downloads.download({
      url: resolved.url,
      filename: resolved.filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
    if (stale()) {
      await chrome.downloads.cancel(downloadId);
      return;
    }
    task.downloadId = downloadId;
    task.state = 'downloading';
    task.updatedAt = Date.now();
    await chrome.storage.local.set({ tasks });
    broadcast();
  } catch (error) {
    if (stale()) return;
    task.state = 'failed';
    task.error = cleanError(error);
    task.updatedAt = Date.now();
    await chrome.storage.local.set({ tasks });
    broadcast();
    await pump();
  }
}

async function pump() {
  await ready;
  if (pumping) return;
  pumping = true;
  try {
    const active = () => tasks.filter(task => ['resolving', 'downloading'].includes(task.state)).length;
    while (active() < Number(settings.concurrency || 1)) {
      const task = [...tasks].sort((a, b) => a.createdAt - b.createdAt).find(item => item.state === 'queued');
      if (!task) break;
      task.state = 'resolving';
      task.error = '';
      task.updatedAt = Date.now();
      await chrome.storage.local.set({ tasks });
      broadcast();
      resolveAndStart(task.id);
    }
  } finally {
    pumping = false;
  }
}

async function scanCourses(tabId) {
  scanState = { state: 'running', done: 0, total: 0, courseName: '' };
  broadcast();
  try {
    const response = await sendToLms(tabId, { type: 'LMS_SCAN_COURSES' });
    const courses = response.courses.map(item => summarizeCourse(item.course, item.activities, item.details || {}, { bulletins: item.bulletins || [] }));
    catalog = { version: 3, courses, todos: normalizeTodos(response.todos), updatedAt: Date.now(), sourceTabId: tabId };
    scanState = { ...scanState, state: 'done', done: courses.length, total: courses.length };
    await chrome.storage.local.set({ catalog });
    broadcast();
    return { ok: true, count: courses.length };
  } catch (error) {
    scanState.state = 'failed';
    scanState.error = cleanError(error);
    broadcast();
    throw error;
  }
}

async function syncDownloads() {
  const downloadItems = await chrome.downloads.search({});
  const byId = new Map(downloadItems.map(item => [item.id, item]));
  for (const task of tasks) {
    if (task.downloadId == null || !byId.has(task.downloadId)) continue;
    const item = byId.get(task.downloadId);
    task.bytesReceived = item.bytesReceived || 0;
    task.totalBytes = item.totalBytes > 0 ? item.totalBytes : task.totalBytes;
    task.filename = item.filename || task.filename;
    if (item.state === 'complete') task.state = 'completed';
    if (item.state === 'interrupted' && !['paused', 'canceled'].includes(task.state)) {
      task.state = 'failed';
      task.error = item.error || '下载中断';
    }
  }
}

chrome.downloads.onChanged.addListener(async delta => {
  await ready;
  const task = tasks.find(item => item.downloadId === delta.id);
  if (!task) return;
  if (delta.bytesReceived) task.bytesReceived = delta.bytesReceived.current;
  if (delta.totalBytes && delta.totalBytes.current > 0) task.totalBytes = delta.totalBytes.current;
  if (delta.filename) task.filename = delta.filename.current;
  if (delta.paused) task.state = delta.paused.current ? 'paused' : 'downloading';
  if (delta.state) {
    if (delta.state.current === 'complete') task.state = 'completed';
    if (delta.state.current === 'interrupted' && task.state !== 'canceled') task.state = 'failed';
  }
  if (delta.error && task.state !== 'canceled') task.error = delta.error.current || '下载失败';
  task.updatedAt = Date.now();
  saveTasksSoon();
  if (['completed', 'failed', 'canceled'].includes(task.state)) pump();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SCAN_PROGRESS') {
    scanState = { ...scanState, ...message, state: 'running' };
    broadcast();
    sendResponse({ ok: true });
    return false;
  }
  if (!message?.type) return false;
  (async () => {
    await ready;
    switch (message.type) {
      case 'GET_STATE':
        await syncDownloads();
        return { ok: true, ...publicState() };
      case 'GET_ACTIVITY_CONTEXT': {
        const tab = await chrome.tabs.get(message.tabId);
        const parsed = parseLmsUrl(tab.url);
        if (!parsed) return { ok: true, context: null };
        if (parsed.kind !== 'activity') return { ok: true, context: parsed };
        const response = await sendToLms(message.tabId, {
          type: 'LMS_GET_ACTIVITY',
          courseId: parsed.courseId,
          activityId: parsed.activityId
        });
        return { ok: true, ...publicActivity(response.activity, response.course), context: parsed };
      }
      case 'GET_CAMPUS_OVERVIEW':
        return { ok: true, ...(await sendToCampus(message.tabId)) };
      case 'QUEUE_REPLAY':
        return queueReplay(message);
      case 'QUEUE_PDF':
        return queuePdf(message);
      case 'QUEUE_DIRECT':
        return queueDirect(message);
      case 'QUEUE_BATCH':
        return queueBatch(message);
      case 'QUEUE_ZYXF':
        return queueZyxf(message);
      case 'ZYXF_SEARCH': {
        const query = String(message.query || '').trim();
        if (!query) return { ok: true, folders: [], files: [], truncated: false };
        if (query.length > 64) throw new Error('搜索关键词最多 64 个字符');
        return { ok: true, ...(await zyxfJson(`/api/search?q=${encodeURIComponent(query)}`)) };
      }
      case 'ZYXF_LIST': {
        const folderId = Number(message.folderId);
        if (!Number.isInteger(folderId) || folderId < 0) throw new Error('无效的学辅目录 ID');
        return { ok: true, ...(await zyxfJson(`/api/folders/${folderId}/contents?sort=manual&order=asc`)) };
      }
      case 'ZYXF_OPEN': {
        const link = await zyxfFileLink(message.fileId);
        await chrome.tabs.create({ url: link.url });
        return { ok: true };
      }
      case 'SCAN_COURSES':
        return scanCourses(message.tabId);
      case 'SAVE_SETTINGS':
        settings = {
          ...settings,
          concurrency: [1, 2, 3, 4].includes(Number(message.settings?.concurrency)) ? Number(message.settings.concurrency) : 1,
          root: String(message.settings?.root || 'XJTU').trim() || 'XJTU',
          defaultTrack: ['ENCODER', 'INSTRUCTOR', 'BOTH'].includes(message.settings?.defaultTrack) ? message.settings.defaultTrack : 'ENCODER'
        };
        await chrome.storage.local.set({ settings });
        broadcast();
        return { ok: true };
      case 'PAUSE_TASK': {
        const task = tasks.find(item => item.id === message.taskId);
        if (task?.downloadId != null) await chrome.downloads.pause(task.downloadId);
        if (task) task.state = 'paused';
        await chrome.storage.local.set({ tasks });
        await pump();
        return { ok: true };
      }
      case 'RESUME_TASK': {
        const task = tasks.find(item => item.id === message.taskId);
        if (task?.downloadId != null) {
          await chrome.downloads.resume(task.downloadId);
          task.state = 'downloading';
        } else if (task) {
          task.state = 'queued';
          await pump();
        }
        await chrome.storage.local.set({ tasks });
        return { ok: true };
      }
      case 'CANCEL_TASK': {
        const task = tasks.find(item => item.id === message.taskId);
        if (task) task.generation = (task.generation || 0) + 1;
        if (task?.downloadId != null) await chrome.downloads.cancel(task.downloadId);
        if (task) {
          task.state = 'canceled';
          task.updatedAt = Date.now();
        }
        await chrome.storage.local.set({ tasks });
        await pump();
        return { ok: true };
      }
      case 'RETRY_TASK': {
        const task = tasks.find(item => item.id === message.taskId);
        if (!task) throw new Error('任务不存在');
        task.generation = (task.generation || 0) + 1;
        task.state = 'queued';
        task.downloadId = null;
        task.bytesReceived = 0;
        task.error = '';
        await chrome.storage.local.set({ tasks });
        await pump();
        return { ok: true };
      }
      case 'CLEAR_FINISHED':
        tasks = tasks.filter(task => !['completed', 'canceled', 'failed'].includes(task.state));
        await chrome.storage.local.set({ tasks });
        broadcast();
        return { ok: true };
      case 'CLEAR_CATALOG':
        catalog = { courses: [], updatedAt: null, sourceTabId: null };
        await chrome.storage.local.set({ catalog });
        broadcast();
        return { ok: true };
      default:
        throw new Error('不支持的扩展请求');
    }
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: cleanError(error) }));
  return true;
});

ready.then(() => pump()).catch(() => {});
