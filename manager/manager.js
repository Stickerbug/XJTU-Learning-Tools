import { formatBytes, RESOURCE_SOURCES, matchScore } from '../shared/core.js';

const $ = selector => document.querySelector(selector);
let state = { settings: {}, tasks: [], catalog: { courses: [] }, scanState: {} };
let noticeTimer = null;
let selectedCourseId = null;
const selectedKeys = new Set();
const resourceIndex = new Map();
const sourceOrder = [
  RESOURCE_SOURCES.replay,
  RESOURCE_SOURCES.material,
  RESOURCE_SOURCES.homework,
  RESOURCE_SOURCES.bulletin,
  RESOURCE_SOURCES.submission,
  RESOURCE_SOURCES.correct,
  RESOURCE_SOURCES.marked,
  RESOURCE_SOURCES.embedded,
  RESOURCE_SOURCES.direct
];

const STATE_NAMES = {
  queued: '排队中', resolving: '解析地址', downloading: '下载中', paused: '已暂停',
  completed: '已完成', failed: '失败', canceled: '已取消'
};

function showNotice(message, kind = 'error') {
  clearTimeout(noticeTimer);
  const element = $('#notice');
  element.textContent = message;
  element.className = `notice visible ${kind}`;
  noticeTimer = setTimeout(() => { element.className = 'notice'; }, 5000);
}

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失败');
  return response;
}

function switchView(view) {
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== `view-${view}`;
  for (const button of document.querySelectorAll('.nav-button')) button.classList.toggle('active', button.dataset.view === view);
}

function resourcesFor(course) {
  if (Array.isArray(course.resources)) return course.resources;
  const replays = (course.replays || []).map(item => ({
    key: `replay:${item.activityId}`, kind: 'replay', source: RESOURCE_SOURCES.replay,
    courseId: course.id, courseName: course.name, activityId: item.activityId,
    activityTitle: item.title, name: item.title, title: item.title, size: item.size, status: item.status
  }));
  const uploads = (course.materials || []).map(item => ({
    key: `upload:${item.activityId}:${item.uploadId}`, kind: 'upload', source: RESOURCE_SOURCES.material,
    courseId: course.id, courseName: course.name, activityId: item.activityId,
    activityTitle: item.activityTitle, name: item.name, uploadId: item.uploadId,
    referenceId: item.referenceId, size: item.size, status: item.status
  }));
  return [...replays, ...uploads];
}

function updateSelectionButtons() {
  for (const button of document.querySelectorAll('.queue-selected')) {
    button.textContent = selectedKeys.size ? `下载所选文件（${selectedKeys.size}）` : '下载所选文件';
  }
}

function resourceRow(resource) {
  const row = document.createElement('label');
  row.className = 'resource-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'resource-check';
  checkbox.dataset.key = resource.key;
  checkbox.checked = selectedKeys.has(resource.key);
  checkbox.addEventListener('change', () => {
    checkbox.checked ? selectedKeys.add(resource.key) : selectedKeys.delete(resource.key);
    updateSelectionButtons();
  });
  const name = document.createElement('span');
  name.className = 'resource-name';
  const text = document.createElement('span');
  text.textContent = resource.name;
  name.append(text);
  name.title = resource.activityTitle ? `${resource.activityTitle}\n${resource.name}` : resource.name;
  const addLink = (label, href) => {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = label;
    link.addEventListener('click', event => event.stopPropagation());
    name.append(link);
  };
  if (resource.kind === 'upload' && resource.referenceId) {
    addLink('预览', `https://lms.xjtu.edu.cn/api/uploads/reference/document/${resource.referenceId}/url?preview=true`);
  }
  if (resource.kind === 'replay') {
    addLink('打开', `https://lms.xjtu.edu.cn/course/${resource.courseId}/learning-activity#/${resource.activityId}`);
  }
  const kind = document.createElement('span');
  kind.className = 'resource-kind';
  kind.textContent = resource.source;
  const size = document.createElement('span');
  size.className = 'resource-size';
  size.textContent = formatBytes(resource.size);
  row.append(checkbox, name, kind, size);
  return row;
}

function rebuildResourceIndex() {
  resourceIndex.clear();
  for (const course of state.catalog.courses || []) {
    for (const resource of resourcesFor(course)) resourceIndex.set(resource.key, resource);
  }
  for (const key of selectedKeys) if (!resourceIndex.has(key)) selectedKeys.delete(key);
}

function renderCatalog() {
  const { catalog, scanState } = state;
  const courses = catalog.courses || [];
  const query = $('#resource-search').value.trim();
  $('#catalog').replaceChildren();
  $('#catalog-empty').hidden = courses.length > 0;
  const fileCount = [...resourceIndex.values()].length;
  $('#catalog-meta').textContent = scanState.state === 'running'
    ? `正在扫描 ${scanState.done || 0}/${scanState.total || '…'} ${scanState.courseName || ''}`
    : catalog.updatedAt
      ? `${courses.length} 门课程 · ${fileCount} 个文件 · ${new Date(catalog.updatedAt).toLocaleString('zh-CN')}`
      : '尚未扫描课程';
  $('#scan-courses').disabled = scanState.state === 'running';
  for (const course of courses) {
    const resources = resourcesFor(course)
      .map(resource => ({ resource, score: matchScore(query, `${course.name} ${resource.activityTitle || ''} ${resource.name} ${resource.source}`) }))
      .filter(item => item.score != null)
      .sort((a, b) => b.score - a.score)
      .map(item => item.resource);
    if (query && !resources.length) continue;
    const details = document.createElement('details');
    details.className = 'course';
    if (query) details.open = true;
    const summary = document.createElement('summary');
    const title = document.createElement('div');
    title.className = 'course-title';
    title.textContent = course.name;
    const meta = document.createElement('div');
    meta.className = 'course-meta';
    meta.textContent = `${course.code || ''} ${course.semester || ''}`;
    title.append(meta);
    const count = document.createElement('span');
    count.className = 'resource-meta';
    count.textContent = `${resources.length} 个文件`;
    summary.append(title, count);
    details.append(summary);
    const table = document.createElement('div');
    table.className = 'resource-table';
    for (const resource of resources) table.append(resourceRow(resource));
    if (!resources.length) {
      const empty = document.createElement('div');
      empty.className = 'resource-row resource-meta';
      empty.textContent = query ? '无匹配文件' : '未扫描到可保存文件';
      table.append(empty);
    }
    details.append(table);
    $('#catalog').append(details);
  }
}

function renderTodos() {
  const todos = state.catalog.todos || [];
  $('#todo-panel').hidden = todos.length === 0;
  $('#todo-summary').textContent = `学习待办（${todos.length}）`;
  const list = $('#todo-list');
  list.replaceChildren();
  for (const todo of todos) {
    const row = document.createElement('div');
    row.className = 'todo-row';
    const link = document.createElement('a');
    const isActivity = ['homework', 'material', 'lesson', 'lecture_live'].includes(todo.type);
    link.href = isActivity
      ? `https://lms.xjtu.edu.cn/course/${todo.courseId}/learning-activity#/${todo.id}`
      : 'https://lms.xjtu.edu.cn/user/index#/';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = `${todo.courseName} · ${todo.title}`;
    const time = document.createElement('span');
    time.textContent = todo.dueAt ? new Date(todo.dueAt).toLocaleString('zh-CN') : '时间待定';
    row.append(link, time);
    list.append(row);
  }
}

function renderCourseList() {
  const list = $('#course-list');
  list.replaceChildren();
  const courses = state.catalog.courses || [];
  if (!courses.length) {
    list.innerHTML = '<div class="empty-state">暂无课程</div>';
    return;
  }
  if (!courses.some(course => course.id === selectedCourseId)) selectedCourseId = courses[0].id;
  for (const course of courses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `course-list-item${course.id === selectedCourseId ? ' active' : ''}`;
    const name = document.createElement('span');
    name.textContent = course.name;
    const count = document.createElement('small');
    count.textContent = `${resourcesFor(course).length} 个文件`;
    button.append(name, count);
    button.addEventListener('click', () => {
      selectedCourseId = course.id;
      renderCourseList();
      renderCourseFiles();
    });
    list.append(button);
  }
}

function renderCourseFiles() {
  const course = (state.catalog.courses || []).find(item => item.id === selectedCourseId);
  const container = $('#course-files');
  container.replaceChildren();
  if (!course) {
    $('#selected-course-name').textContent = '选择一门课程';
    $('#selected-course-meta').textContent = '文件按来源分类显示';
    container.innerHTML = '<div class="empty-state">请先从左侧选择课程。</div>';
    return;
  }
  const resources = resourcesFor(course);
  $('#selected-course-name').textContent = course.name;
  $('#selected-course-meta').textContent = `${course.code || ''} · ${resources.length} 个文件`;
  for (const source of sourceOrder) {
    const group = resources.filter(resource => resource.source === source);
    if (!group.length) continue;
    const section = document.createElement('section');
    section.className = 'source-group';
    const heading = document.createElement('h2');
    heading.textContent = `${source}（${group.length}）`;
    section.append(heading);
    for (const resource of group) section.append(resourceRow(resource));
    container.append(section);
  }
  if (!resources.length) container.innerHTML = '<div class="empty-state">这门课程未扫描到可保存文件。</div>';
}

function taskAction(task, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary small';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await call({ type: action, taskId: task.id });
      await loadState();
    } catch (error) {
      showNotice(error.message);
      button.disabled = false;
    }
  });
  return button;
}

function renderTasks() {
  const tasks = state.tasks || [];
  $('#tasks').replaceChildren();
  $('#tasks-empty').hidden = tasks.length > 0;
  const active = tasks.filter(task => ['queued', 'resolving', 'downloading'].includes(task.state)).length;
  const completed = tasks.filter(task => task.state === 'completed').length;
  const downloaded = tasks.filter(task => task.state === 'completed').reduce((sum, task) => sum + (Number(task.bytesReceived) || 0), 0);
  $('#nav-task-count').textContent = active ? `(${active})` : '';
  $('#task-summary').textContent = `${active} 个进行中 · ${completed} 个已完成 · 已下载 ${formatBytes(downloaded)}`;
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const file = document.createElement('div');
    file.className = 'task-file';
    const name = document.createElement('div');
    name.className = 'task-name';
    name.title = task.filename || task.activityTitle || task.uploadName;
    name.textContent = task.kind === 'replay' ? `${task.activityTitle} · ${task.label === 'ENCODER' ? '课件' : '教师'}` : task.uploadName;
    const path = document.createElement('div');
    path.className = 'task-path';
    path.textContent = task.source ? `${task.courseName} · ${task.source}` : task.courseName;
    file.append(name, path);
    const status = document.createElement('span');
    status.className = `task-state ${task.state === 'failed' ? 'error' : ''}`;
    status.textContent = STATE_NAMES[task.state] || task.state;
    const progress = document.createElement('div');
    progress.className = 'task-progress';
    const track = document.createElement('div');
    track.className = 'progress-track';
    const value = document.createElement('div');
    value.className = 'progress-value';
    const percent = task.totalBytes > 0 ? Math.min(100, task.bytesReceived / task.totalBytes * 100) : task.state === 'completed' ? 100 : 0;
    value.style.width = `${percent}%`;
    track.append(value);
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.textContent = task.totalBytes > 0
      ? `${formatBytes(task.bytesReceived)} / ${formatBytes(task.totalBytes)}`
      : task.state === 'completed' ? '下载完成' : formatBytes(task.bytesReceived);
    progress.append(track, progressText);
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    if (task.state === 'downloading') actions.append(taskAction(task, '暂停', 'PAUSE_TASK'));
    if (task.state === 'paused') actions.append(taskAction(task, '继续', 'RESUME_TASK'));
    if (['failed', 'canceled'].includes(task.state)) actions.append(taskAction(task, '重试', 'RETRY_TASK'));
    if (!['completed', 'canceled'].includes(task.state)) actions.append(taskAction(task, '取消', 'CANCEL_TASK'));
    if (task.downloadId != null && task.state === 'completed') {
      const show = document.createElement('button');
      show.type = 'button';
      show.className = 'button secondary small';
      show.textContent = '打开位置';
      show.addEventListener('click', () => chrome.downloads.show(task.downloadId));
      actions.append(show);
    }
    row.append(file, status, progress, actions);
    if (task.error) {
      const error = document.createElement('div');
      error.className = 'task-error';
      error.textContent = task.error;
      row.append(error);
    }
    $('#tasks').append(row);
  }
}

function renderSettings() {
  $('#setting-concurrency').value = String(state.settings.concurrency || 1);
  $('#setting-root').value = state.settings.root || 'XJTU';
  if (!$('#batch-track').dataset.initialized) {
    $('#batch-track').value = state.settings.defaultTrack || 'ENCODER';
    $('#batch-track').dataset.initialized = 'true';
  }
}

async function loadState() {
  state = await call({ type: 'GET_STATE' });
  rebuildResourceIndex();
  renderTodos();
  renderCatalog();
  renderCourseList();
  renderCourseFiles();
  renderTasks();
  renderSettings();
  updateSelectionButtons();
}

async function queueSelected() {
  const items = [...selectedKeys].map(key => resourceIndex.get(key)).filter(Boolean);
  if (!items.length) return showNotice('请先勾选文件');
  if (!state.catalog.sourceTabId) return showNotice('课程清单缺少来源页面，请重新扫描');
  try {
    await call({
      type: 'QUEUE_BATCH',
      sourceTabId: state.catalog.sourceTabId,
      items,
      trackPreference: $('#batch-track').value
    });
    selectedKeys.clear();
    switchView('tasks');
    await loadState();
  } catch (error) {
    showNotice(error.message);
  }
}

for (const button of document.querySelectorAll('.nav-button')) button.addEventListener('click', () => switchView(button.dataset.view));
for (const button of document.querySelectorAll('.queue-selected')) button.addEventListener('click', queueSelected);
$('#resource-search').addEventListener('input', renderCatalog);

$('#scan-courses').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.id === state.catalog.sourceTabId && item.url?.startsWith('https://lms.xjtu.edu.cn/')) ||
      tabs.find(item => item.url?.startsWith('https://lms.xjtu.edu.cn/'));
    if (!tab) throw new Error('请先打开并登录思源学堂');
    await call({ type: 'SCAN_COURSES', tabId: tab.id });
    await loadState();
    showNotice('完整文件扫描完成', 'success');
  } catch (error) {
    showNotice(error.message);
  }
});

$('#download-direct').addEventListener('click', async () => {
  const input = $('#direct-url');
  if (!input.value.trim()) return showNotice('请先粘贴媒体文件直链');
  try {
    await call({ type: 'QUEUE_DIRECT', url: input.value.trim(), tabId: state.catalog.sourceTabId });
    input.value = '';
    switchView('tasks');
    await loadState();
  } catch (error) {
    showNotice(error.message);
  }
});

$('#clear-finished').addEventListener('click', async () => { await call({ type: 'CLEAR_FINISHED' }); await loadState(); });
$('#clear-catalog').addEventListener('click', async () => {
  selectedKeys.clear();
  selectedCourseId = null;
  await call({ type: 'CLEAR_CATALOG' });
  await loadState();
});
$('#save-settings').addEventListener('click', async () => {
  try {
    await call({
      type: 'SAVE_SETTINGS',
      settings: {
        concurrency: Number($('#setting-concurrency').value),
        root: $('#setting-root').value,
        defaultTrack: $('#batch-track').value
      }
    });
    await loadState();
    showNotice('设置已保存', 'success');
  } catch (error) {
    showNotice(error.message);
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'STATE_CHANGED' || message.type === 'SCAN_PROGRESS') loadState().catch(() => {});
});

const initialView = new URLSearchParams(location.search).get('view');
switchView(['resources', 'courses', 'tasks', 'settings'].includes(initialView) ? initialView : 'resources');
loadState().catch(error => showNotice(error.message));
