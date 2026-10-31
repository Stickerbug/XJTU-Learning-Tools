import { TRACKS, formatBytes } from '../shared/core.js';

const $ = selector => document.querySelector(selector);
let currentTab = null;
let current = null;
let noticeTimer = null;

const SITE_LINKS = [
  { host: 'lms.xjtu.edu.cn', title: '思源学堂', links: [['打开首页', 'https://lms.xjtu.edu.cn/'], ['批量下载', 'manager:resources'], ['课程清单', 'manager:courses']] },
  { host: 'jwxt.xjtu.edu.cn', title: '教务系统', links: [['空教室', 'manager:classrooms'], ['读取校园数据', 'manager:campus'], ['打开教务', 'https://jwxt.xjtu.edu.cn/'], ['我的课表', 'https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do'], ['成绩查询', 'https://jwxt.xjtu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do'], ['一网通办', 'https://ywtb.xjtu.edu.cn/']] },
  { host: 'ywtb.xjtu.edu.cn', title: '一网通办', links: [['读取校园数据', 'manager:campus'], ['打开一网通办', 'https://ywtb.xjtu.edu.cn/'], ['教务系统', 'https://jwxt.xjtu.edu.cn/']] },
  { host: 'bk-kq.xjtu.edu.cn', title: '本科考勤', links: [['读取考勤', 'manager:attendance'], ['打开本科考勤', 'https://bk-kq.xjtu.edu.cn/sa/auth/cas/login/student-pc'], ['研究生考勤', 'https://yjs-kq.xjtu.edu.cn/sa/auth/cas/login/student-pc']] },
  { host: 'yjs-kq.xjtu.edu.cn', title: '研究生考勤', links: [['读取考勤', 'manager:attendance'], ['打开研究生考勤', 'https://yjs-kq.xjtu.edu.cn/sa/auth/cas/login/student-pc'], ['本科考勤', 'https://bk-kq.xjtu.edu.cn/sa/auth/cas/login/student-pc']] },
  { host: 'zyxf.top', title: '仲英学辅', links: [['打开资料站', 'https://zyxf.top/'], ['学辅页', 'manager:zyxf']] },
  { host: 'news.xjtu.edu.cn', title: '西交新闻网', links: [['打开新闻网', 'https://news.xjtu.edu.cn/'], ['校园门户', 'https://www.xjtu.edu.cn/']] },
  { host: 'nic.xjtu.edu.cn', title: '网络信息中心', links: [['打开网络中心', 'https://nic.xjtu.edu.cn/'], ['校园 VPN', 'https://webvpn.xjtu.edu.cn/']] },
  { host: 'lib.xjtu.edu.cn', title: '图书馆', links: [['打开图书馆', 'https://www.lib.xjtu.edu.cn/'], ['门户首页', 'https://www.xjtu.edu.cn/']] }
];

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
  for (const element of document.querySelectorAll('main .section:not(#page-links)')) element.hidden = true;
  if (id) $(id).hidden = false;
}

function openManager(view = 'resources') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`manager/manager.html?view=${view}`) });
}


function renderPageLinks(tab) {
  const host = (() => { try { return new URL(tab?.url || '').hostname; } catch { return ''; } })();
  const site = SITE_LINKS.find(item => host === item.host || host.endsWith(`.${item.host}`));
  $('#page-links').hidden = false;
  $('#page-title').textContent = site?.title || (host.endsWith('xjtu.edu.cn') ? '西安交通大学站点' : '当前页面');
  $('#page-host').textContent = host || '无法读取当前页面地址';
  const links = site?.links || [['打开西交官网', 'https://www.xjtu.edu.cn/'], ['校园门户', 'manager:portal'], ['下载任务', 'manager:tasks']];
  $('#quick-links').replaceChildren();
  for (const [label, target] of links) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary small';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (target.startsWith('manager:')) openManager(target.slice(8));
      else chrome.tabs.create({ url: target });
    });
    $('#quick-links').append(button);
  }
}

function renderActivity(payload) {
  current = payload;
  const { activity, course } = payload;
  if (activity.type === 'lesson' || activity.type === 'lecture_live' || activity.type === 'online_video') {
    showSection('#replay');
    $('#replay-title').textContent = activity.title;
    $('#replay-course').textContent = `${course.name} · ${formatBytes(activity.size)}`;
    const tracks = Array.isArray(activity.tracks) ? activity.tracks : [];
    const labels = tracks.length ? tracks.map(track => track.label) : ['ENCODER', 'INSTRUCTOR'];
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
  const pdfs = (activity.uploads || []).filter(upload => upload.type === 'document' && /\.pdf$/i.test(upload.name));
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
    renderPageLinks(tab);
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
