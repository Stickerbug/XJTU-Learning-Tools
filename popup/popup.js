import { TRACKS, formatBytes } from '../shared/core.js';

const $ = selector => document.querySelector(selector);
let currentTab = null;
let current = null;
let noticeTimer = null;

function showNotice(message, kind = 'error', persistent = false) {
  clearTimeout(noticeTimer);
  const element = $('#notice');
  element.textContent = message;
  element.className = `notice visible ${kind}`;
  if (!persistent) noticeTimer = setTimeout(() => { element.className = 'notice'; }, 4500);
}

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '操作失败');
  return response;
}

function showSection(id) {
  for (const element of document.querySelectorAll('main .section')) element.hidden = true;
  if (id) $(id).hidden = false;
}

function openManager(view = 'resources') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`manager/manager.html?view=${view}`) });
}

function renderActivity(payload) {
  current = payload;
  const { activity, course } = payload;
  if (activity.type === 'lesson') {
    showSection('#replay');
    $('#replay-title').textContent = activity.title;
    $('#replay-course').textContent = `${course.name} · ${formatBytes(activity.size)}`;
    const labels = activity.tracks.length ? activity.tracks.map(track => track.label) : ['ENCODER', 'INSTRUCTOR'];
    $('#track-list').replaceChildren();
    for (const [index, label] of labels.entries()) {
      if (!TRACKS[label]) continue;
      const row = document.createElement('label');
      row.className = 'track-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = label;
      checkbox.checked = label === 'ENCODER' || (labels.length === 1 && index === 0);
      const name = document.createElement('span');
      name.className = 'track-name';
      name.textContent = TRACKS[label].name;
      const meta = document.createElement('small');
      meta.textContent = label === 'ENCODER' ? '通常含主音频' : '通常默认静音';
      row.append(checkbox, name, meta);
      $('#track-list').append(row);
    }
    return;
  }
  const pdfs = activity.uploads.filter(upload => upload.type === 'document' && /\.pdf$/i.test(upload.name));
  if (pdfs.length) {
    showSection('#materials');
    $('#material-list').replaceChildren();
    for (const upload of pdfs) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const main = document.createElement('div');
      main.className = 'file-row-main';
      const info = document.createElement('div');
      info.className = 'file-name';
      info.textContent = upload.name;
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = `${formatBytes(upload.size)} · ${upload.status === 'ready' ? '可预览' : upload.status}`;
      info.append(meta);
      const button = document.createElement('button');
      button.className = 'button secondary small';
      button.type = 'button';
      button.textContent = '保存 PDF';
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = '解析中…';
        try {
          await call({
            type: 'QUEUE_PDF',
            tabId: currentTab.id,
            originTabId: currentTab.id,
            courseId: course.id,
            courseName: course.name,
            activityId: activity.id,
            activityTitle: activity.title,
            uploadId: upload.id,
            referenceId: upload.referenceId,
            fileKey: upload.fileKey,
            uploadName: upload.name,
            size: upload.size,
            source: activity.type === 'homework' ? '作业附件' : '课件附件'
          });
          showNotice('已加入下载队列', 'success');
        } catch (error) {
          showNotice(error.message);
        } finally {
          button.disabled = false;
          button.textContent = '保存 PDF';
        }
      });
      main.append(info, button);
      row.append(main);
      $('#material-list').append(row);
    }
    return;
  }
  showSection('#unsupported');
  $('#unsupported p').textContent = '该活动不是可识别的回放或 PDF 资料。';
}

async function load() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    const response = await call({ type: 'GET_ACTIVITY_CONTEXT', tabId: tab.id });
    if (!response.context || response.context.kind === 'lms') {
      showSection('#unsupported');
    } else if (response.context.kind === 'course') {
      showSection('#course-only');
    } else {
      renderActivity(response);
    }
    const state = await call({ type: 'GET_STATE' });
    const active = state.tasks.filter(task => ['queued', 'resolving', 'downloading'].includes(task.state)).length;
    $('#task-count').textContent = active ? `(${active})` : '';
  } catch (error) {
    showSection('#unsupported');
    showNotice(error.message, 'error', true);
  }
}

$('#download-replay').addEventListener('click', async () => {
  const labels = [...document.querySelectorAll('#track-list input:checked')].map(input => input.value);
  if (!labels.length) return showNotice('请至少选择一路画面');
  const button = $('#download-replay');
  button.disabled = true;
  try {
    await call({
      type: 'QUEUE_REPLAY',
      tabId: currentTab.id,
      originTabId: currentTab.id,
      courseId: current.course.id,
      courseName: current.course.name,
      activityId: current.activity.id,
      activityTitle: current.activity.title,
      labels
    });
    showNotice('已加入下载队列', 'success');
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
  }
});

$('#open-manager').addEventListener('click', () => openManager());
$('#show-tasks').addEventListener('click', () => openManager('tasks'));
$('#open-lms').addEventListener('click', () => chrome.tabs.create({ url: 'https://lms.xjtu.edu.cn/' }));
$('#scan-courses').addEventListener('click', async () => {
  try {
    await call({ type: 'SCAN_COURSES', tabId: currentTab.id });
    showNotice('课程扫描完成', 'success');
    openManager();
  } catch (error) {
    showNotice(error.message, 'error', true);
  }
});

load();
