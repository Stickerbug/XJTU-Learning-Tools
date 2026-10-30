import { formatBytes, RESOURCE_SOURCES, matchScore, safeFilePart } from '../shared/core.js';

const $ = selector => document.querySelector(selector);
let state = { settings: {}, tasks: [], catalog: { courses: [] }, scanState: {} };
let noticeTimer = null;
let selectedCourseId = null;
let resourceView = 'activities';
let calendarCursor = new Date();
calendarCursor.setDate(1);
const selectedKeys = new Set();
const resourceIndex = new Map();
const openDetailKeys = new Set();
const zyxfState = { data: null, query: '', folderId: null, loading: false };
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

const PORTAL_SITES = [
  { category: '学习', name: '思源学堂', description: '课程、回放、课件和作业', url: 'https://lms.xjtu.edu.cn/' },
  { category: '学习', name: '教务系统', description: '课表、成绩、考试和选课', url: 'https://jwxt.xjtu.edu.cn/' },
  { category: '学习', name: '我的课表', description: '教务系统当前学期课程安排', url: 'https://jwxt.xjtu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do' },
  { category: '学习', name: '成绩查询', description: '课程成绩和学分信息', url: 'https://jwxt.xjtu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do' },
  { category: '学习', name: '考试安排', description: '考试时间和地点', url: 'https://jwxt.xjtu.edu.cn/jwapp/sys/studentWdksapApp/modules/wdksap/wdksap.do' },
  { category: '学习', name: '空教室查询', description: '按时间查询可用教室', url: 'https://jwxt.xjtu.edu.cn/jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do' },
  { category: '学习', name: '选课服务', description: '本科生选课与培养方案', url: 'https://xkfw.xjtu.edu.cn/' },
  { category: '学习', name: '教务处', description: '教学通知、校历和教学信息', url: 'https://dean.xjtu.edu.cn/' },
  { category: '学习', name: '一网通办', description: '校园服务统一入口', url: 'https://ywtb.xjtu.edu.cn/' },
  { category: '服务', name: '校园卡', description: '余额、消费和卡片服务', url: 'https://ncard.xjtu.edu.cn/' },
  { category: '服务', name: '学生邮箱', description: '学生电子邮件系统', url: 'https://stu.xjtu.edu.cn/' },
  { category: '服务', name: '网络信息中心', description: '校园网络、VPN和账号服务', url: 'https://nic.xjtu.edu.cn/' },
  { category: '服务', name: 'WebVPN', description: '校外访问校内服务', url: 'https://webvpn.xjtu.edu.cn/' },
  { category: '服务', name: '场馆服务', description: '场馆预约与校园服务', url: 'https://jdfw.xjtu.edu.cn/' },
  { category: '信息', name: '西安交通大学官网', description: '学校新闻、通知和公开信息', url: 'https://www.xjtu.edu.cn/' },
  { category: '信息', name: '交大新闻网', description: '校园新闻和专题报道', url: 'https://news.xjtu.edu.cn/' },
  { category: '信息', name: '信息公开网', description: '学校信息公开内容', url: 'https://xxgk.xjtu.edu.cn/' },
  { category: '信息', name: '学术资源平台', description: '讲座、会议和学术活动', url: 'https://meeting.xjtu.edu.cn/' },
  { category: '信息', name: '图书馆', description: '馆藏检索、数据库和座位服务', url: 'https://www.lib.xjtu.edu.cn/' },
  { category: '信息', name: '科技在线', description: '科研项目、成果和科技服务', url: 'https://std.xjtu.edu.cn/' },
  { category: '信息', name: '思源直播', description: '校园直播和活动回放', url: 'https://zhibo6.xjtu.edu.cn/' },
  { category: '信息', name: '音视频网', description: '校园音视频资源', url: 'https://video.xjtu.edu.cn/' },
  { category: '服务', name: '办公自动化', description: '校内办公与流程服务', url: 'https://oa.xjtu.edu.cn/' },
  { category: '服务', name: '教工邮箱', description: '教职工电子邮件系统', url: 'https://webmail.xjtu.edu.cn/' },
  { category: '工具', name: '仲英学辅', description: '课程资料搜索与下载', url: 'https://zyxf.top/' },
  { category: '工具', name: '完整站点目录', description: '更多校园站点和分类入口', url: 'https://xjtu-links.com/' },
  { category: '工具', name: 'XJTUToolBox', description: '桌面端成绩、考勤和空教室工具', url: 'https://github.com/yan-xiaoo/XJTUToolBox' },
  { category: '工具', name: '岱宗盒子', description: 'Android 综合校园工具', url: 'https://github.com/yeliqin666/xjtu-toolbox-android' },
  { category: '工具', name: 'XJTU Course Genius', description: '选课辅助工具', url: 'https://github.com/Hz162/XJTU-Course-Genius' }
];
const PORTAL_CATEGORIES = ['全部', ...new Set([...PORTAL_SITES.map(site => site.category), '校园服务'])];
let portalCategory = '全部';
let livePortalSites = [];
let portalLoading = false;
let campusData = null;
let campusLoading = false;

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

function renderPortal() {
  const query = String($('#portal-search')?.value || '').trim().toLowerCase();
  const filters = $('#portal-filters');
  const list = $('#portal-list');
  if (!filters || !list) return;
  filters.replaceChildren();
  const switcher = document.createElement('div');
  switcher.className = 'view-switch';
  for (const category of PORTAL_CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = category;
    button.className = category === portalCategory ? 'active' : '';
    button.addEventListener('click', () => {
      portalCategory = category;
      renderPortal();
    });
    switcher.append(button);
  }
  filters.append(switcher);
  const allSites = [...PORTAL_SITES, ...livePortalSites.map(site => ({ ...site, category: site.category || '校园服务' }))];
  const sites = allSites.filter(site => {
    if (portalCategory !== '全部' && site.category !== portalCategory) return false;
    if (!query) return true;
    return `${site.name} ${site.description} ${site.url}`.toLowerCase().includes(query);
  });
  list.replaceChildren();
  for (const site of sites) {
    const link = document.createElement('a');
    link.href = site.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = site.url;
    link.textContent = `${site.name} · ${site.description}`;
    list.append(link);
  }
  $('#portal-empty').hidden = sites.length > 0;
}

async function syncPortal() {
  portalLoading = true;
  const button = $('#portal-sync');
  if (button) { button.disabled = true; button.textContent = '同步中…'; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('请先打开一网通办');
    const response = await call({ type: 'GET_CAMPUS_PORTAL', tabId: tab.id });
    livePortalSites = response.data?.menus || [];
    renderPortal();
    showNotice(`已同步 ${livePortalSites.length} 个门户入口`, 'success');
  } catch (error) {
    showNotice(error.message);
  } finally {
    portalLoading = false;
    if (button) { button.disabled = false; button.textContent = '同步当前门户'; }
  }
}

function campusEmpty(message) {
  const element = document.createElement('div');
  element.className = 'campus-empty';
  element.textContent = message;
  return element;
}

function campusItem(title, details) {
  const row = document.createElement('article');
  row.className = 'campus-item';
  const heading = document.createElement('strong');
  heading.textContent = title || '未命名课程';
  row.append(heading);
  const meta = document.createElement('div');
  meta.className = 'campus-item-meta';
  meta.textContent = details.filter(Boolean).join(' · ');
  if (meta.textContent) row.append(meta);
  return row;
}

function renderCampus() {
  const status = $('#campus-state');
  const profile = $('#campus-profile');
  const schedule = $('#campus-schedule');
  const exams = $('#campus-exams');
  const grades = $('#campus-grades');
  if (!status || !profile || !schedule || !exams || !grades) return;
  schedule.replaceChildren();
  exams.replaceChildren();
  grades.replaceChildren();
  profile.replaceChildren();
  if (campusLoading) {
    status.textContent = '正在读取当前页面…';
    return;
  }
  if (!campusData) {
    status.textContent = '请打开教务系统或一网通办后读取。';
    profile.hidden = true;
    $('#campus-schedule-count').textContent = '';
    $('#campus-exam-count').textContent = '';
    $('#campus-grade-count').textContent = '';
    schedule.append(campusEmpty('暂无课表数据'));
    exams.append(campusEmpty('暂无考试数据'));
    grades.append(campusEmpty('暂无成绩数据'));
    return;
  }
  const errors = campusData.errors || [];
  status.textContent = `${campusData.site === 'jwxt' ? '教务系统' : '一网通办'}${campusData.term ? ` · ${campusData.term}` : ''}${errors.length ? ` · 未读取：${errors.join('、')}` : ''}`;
  const user = campusData.user || {};
  const profileParts = [user.name, user.studentId, user.department].filter(Boolean);
  if (profileParts.length) {
    const label = document.createElement('span');
    label.textContent = '当前用户';
    const value = document.createElement('strong');
    value.textContent = profileParts.join(' · ');
    profile.append(label, value);
    profile.hidden = false;
  } else profile.hidden = true;
  const scheduleRows = campusData.schedule || [];
  const examRows = campusData.exams || [];
  const gradeRows = campusData.grades || [];
  $('#campus-schedule-count').textContent = `${scheduleRows.length} 门`;
  $('#campus-exam-count').textContent = `${examRows.length} 场`;
  $('#campus-grade-count').textContent = `${gradeRows.length} 门`;
  for (const row of scheduleRows) schedule.append(campusItem(row.course, [row.weekday && `周${row.weekday}`, row.section, row.classroom, row.teacher, row.weeks]));
  for (const row of examRows) exams.append(campusItem(row.course, [row.date, row.time, row.classroom, row.seat && `座位 ${row.seat}`]));
  for (const row of gradeRows) grades.append(campusItem(row.course, [row.score && `成绩 ${row.score}`, row.credit && `学分 ${row.credit}`, row.gpa && `绩点 ${row.gpa}`, row.term]));
  if (!scheduleRows.length) schedule.append(campusEmpty('暂无课表数据'));
  if (!examRows.length) exams.append(campusEmpty('暂无考试数据'));
  if (!gradeRows.length) grades.append(campusEmpty('暂无成绩数据'));
}

function resourcesFor(course) {
  if (Array.isArray(course.resources)) return course.resources;
  const replays = (course.replays || []).map(item => ({
    key: `replay:${item.activityId}`, kind: 'replay', source: RESOURCE_SOURCES.replay,
    courseId: course.id, courseName: course.name, activityId: item.activityId,
    activityTitle: item.title, activityType: 'lesson', name: item.title, title: item.title,
    startTime: item.startTime || null, endTime: item.endTime || null, duration: item.duration || null,
    size: item.size, status: item.status
  }));
  const uploads = (course.materials || []).map(item => ({
    key: `upload:${item.activityId}:${item.uploadId}`, kind: 'upload', source: RESOURCE_SOURCES.material,
    courseId: course.id, courseName: course.name, activityId: item.activityId,
    activityTitle: item.activityTitle, activityType: item.activityType || 'material', name: item.name,
    startTime: item.startTime || null, endTime: item.endTime || null, dueAt: item.dueAt || null,
    uploadId: item.uploadId, referenceId: item.referenceId, size: item.size, status: item.status
  }));
  return [...replays, ...uploads];
}

function updateSelectionButtons() {
  for (const button of document.querySelectorAll('.queue-selected')) {
    button.textContent = selectedKeys.size ? `下载所选文件（${selectedKeys.size}）` : '下载所选文件';
  }
  for (const button of document.querySelectorAll('.group-select')) {
    const keys = JSON.parse(button.dataset.keys || '[]');
    const allSelected = keys.length > 0 && keys.every(key => selectedKeys.has(key));
    button.textContent = allSelected ? '取消本组' : '选择本组';
  }
}

function setResourceSelected(resource, checked) {
  checked ? selectedKeys.add(resource.key) : selectedKeys.delete(resource.key);
  updateSelectionButtons();
}

function resourceRow(resource) {
  const row = document.createElement('label');
  row.className = 'resource-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'resource-check';
  checkbox.dataset.key = resource.key;
  checkbox.checked = selectedKeys.has(resource.key);
  checkbox.addEventListener('change', () => setResourceSelected(resource, checkbox.checked));
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

function matchedResources(course, query) {
  return resourcesFor(course)
    .map(resource => ({ resource, score: matchScore(query, `${course.name} ${resource.activityTitle || ''} ${resource.name} ${resource.source}`) }))
    .filter(item => item.score != null)
    .sort((a, b) => b.score - a.score)
    .map(item => item.resource);
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(value) {
  const date = validDate(value);
  return date ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

function makeFold(key, className, forceOpen = false) {
  const details = document.createElement('details');
  details.className = className;
  details.dataset.detailKey = key;
  details.open = forceOpen || openDetailKeys.has(key);
  details.addEventListener('toggle', () => {
    details.open ? openDetailKeys.add(key) : openDetailKeys.delete(key);
  });
  return details;
}

function groupSelectButton(resources) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button group-select';
  button.dataset.keys = JSON.stringify(resources.map(resource => resource.key));
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const keys = JSON.parse(button.dataset.keys);
    const allSelected = keys.length && keys.every(key => selectedKeys.has(key));
    for (const key of keys) allSelected ? selectedKeys.delete(key) : selectedKeys.add(key);
    updateSelectionButtons();
  });
  return button;
}

const ACTIVITY_TYPE_NAMES = {
  homework: '作业', material: '资料', lesson: '课程回放', lecture_live: '直播回放',
  bulletin: '课程公告', courseware: '课件', interaction: '课堂活动', online_video: '在线视频'
};

function activityGroups(resources) {
  const groups = new Map();
  for (const resource of resources) {
    const key = String(resource.activityId ?? 'other');
    if (!groups.has(key)) groups.set(key, { key, resources: [] });
    groups.get(key).resources.push(resource);
  }
  return [...groups.values()].map(group => {
    const first = group.resources[0];
    return {
      ...group,
      title: first.activityTitle || (first.source === RESOURCE_SOURCES.direct ? '媒体直链' : '未分组文件'),
      type: first.activityType || (first.source === RESOURCE_SOURCES.homework ? 'homework' : first.source === RESOURCE_SOURCES.bulletin ? 'bulletin' : ''),
      date: first.dueAt || first.startTime || first.endTime || null
    };
  }).sort((a, b) => {
    const timeA = validDate(a.date)?.getTime() || 0;
    const timeB = validDate(b.date)?.getTime() || 0;
    return timeB - timeA || a.title.localeCompare(b.title, 'zh-CN');
  });
}

function renderActivityGroups(container, resources, courseId, forceOpen = false) {
  for (const group of activityGroups(resources)) {
    const details = makeFold(`activity:${courseId}:${group.key}`, 'activity-group', forceOpen);
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'activity-title';
    title.textContent = group.title;
    const meta = document.createElement('span');
    meta.className = 'activity-meta';
    const type = ACTIVITY_TYPE_NAMES[group.type] || group.resources[0].source;
    const date = formatDateTime(group.date);
    meta.textContent = `${type} · ${group.resources.length} 个文件${date ? ` · ${group.type === 'homework' ? '截止 ' : ''}${date}` : ''}`;
    const text = document.createElement('span');
    text.className = 'activity-summary-text';
    text.append(title, meta);
    summary.append(text, groupSelectButton(group.resources));
    details.append(summary);
    const table = document.createElement('div');
    table.className = 'resource-table';
    for (const resource of group.resources) table.append(resourceRow(resource));
    details.append(table);
    container.append(details);
  }
}

function renderSourceGroups(container, resources, courseId, forceOpen = false) {
  for (const source of sourceOrder) {
    const group = resources.filter(resource => resource.source === source);
    if (!group.length) continue;
    const details = makeFold(`source:${courseId}:${source}`, 'source-group', forceOpen);
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = `${source}（${group.length}）`;
    summary.append(title, groupSelectButton(group));
    details.append(summary);
    const table = document.createElement('div');
    table.className = 'resource-table';
    for (const resource of group) table.append(resourceRow(resource));
    details.append(table);
    container.append(details);
  }
}

function replayChip(resource) {
  const label = document.createElement('label');
  label.className = 'replay-chip';
  label.title = `${resource.courseName} · ${resource.name}`;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedKeys.has(resource.key);
  checkbox.addEventListener('change', () => setResourceSelected(resource, checkbox.checked));
  const text = document.createElement('span');
  const time = validDate(resource.startTime);
  text.textContent = `${time ? time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' ' : ''}${resource.courseName}`;
  label.append(checkbox, text);
  return label;
}

function renderReplayCalendar(courses, query) {
  const container = $('#catalog');
  const replays = courses.flatMap(course => matchedResources(course, query))
    .filter(resource => resource.kind === 'replay')
    .sort((a, b) => (validDate(a.startTime)?.getTime() || 0) - (validDate(b.startTime)?.getTime() || 0));
  const toolbar = document.createElement('div');
  toolbar.className = 'calendar-toolbar';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'button secondary small';
  previous.textContent = '上一月';
  previous.addEventListener('click', () => {
    calendarCursor.setMonth(calendarCursor.getMonth() - 1);
    renderCatalog();
  });
  const label = document.createElement('strong');
  label.textContent = calendarCursor.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'button secondary small';
  next.textContent = '下一月';
  next.addEventListener('click', () => {
    calendarCursor.setMonth(calendarCursor.getMonth() + 1);
    renderCatalog();
  });
  const today = document.createElement('button');
  today.type = 'button';
  today.className = 'text-button';
  today.textContent = '回到本月';
  today.addEventListener('click', () => {
    calendarCursor = new Date();
    calendarCursor.setDate(1);
    renderCatalog();
  });
  toolbar.append(previous, label, next, today);
  container.append(toolbar);

  const byDay = new Map();
  const undated = [];
  for (const resource of replays) {
    const date = validDate(resource.startTime);
    if (!date) {
      undated.push(resource);
      continue;
    }
    const key = dayKey(date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(resource);
  }
  const weekdays = document.createElement('div');
  weekdays.className = 'calendar-weekdays';
  for (const name of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
    const cell = document.createElement('span');
    cell.textContent = name;
    weekdays.append(cell);
  }
  container.append(weekdays);
  const grid = document.createElement('div');
  grid.className = 'calendar-grid';
  const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - (first.getDay() + 6) % 7);
  const todayKey = dayKey(new Date());
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    const cell = document.createElement('div');
    cell.className = `calendar-day${date.getMonth() !== calendarCursor.getMonth() ? ' other-month' : ''}${key === todayKey ? ' today' : ''}`;
    const number = document.createElement('span');
    number.className = 'calendar-date';
    number.textContent = String(date.getDate());
    cell.append(number);
    const items = byDay.get(key) || [];
    for (const resource of items.slice(0, 2)) cell.append(replayChip(resource));
    if (items.length > 2) {
      const more = document.createElement('details');
      more.className = 'day-more';
      const summary = document.createElement('summary');
      summary.textContent = `另有 ${items.length - 2} 个`;
      more.append(summary);
      for (const resource of items.slice(2)) more.append(replayChip(resource));
      cell.append(more);
    }
    grid.append(cell);
  }
  container.append(grid);
  if (!replays.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = query ? '没有匹配的课程回放。' : '当前清单中没有课程回放。';
    container.append(empty);
  }
  if (undated.length) {
    const details = makeFold('replays:undated', 'undated-replays');
    const summary = document.createElement('summary');
    summary.textContent = `未提供日期的回放（${undated.length}）`;
    details.append(summary);
    for (const resource of undated) details.append(resourceRow(resource));
    container.append(details);
  }
}

function renderCatalog() {
  const { catalog, scanState } = state;
  const courses = catalog.courses || [];
  const query = $('#resource-search').value.trim();
  for (const button of document.querySelectorAll('[data-resource-view]')) {
    button.classList.toggle('active', button.dataset.resourceView === resourceView);
  }
  $('#catalog').replaceChildren();
  $('#catalog-empty').hidden = courses.length > 0;
  const fileCount = [...resourceIndex.values()].length;
  const replayCount = [...resourceIndex.values()].filter(item => item.kind === 'replay').length;
  const activeTaskCount = state.tasks.filter(task => ['queued', 'resolving', 'downloading', 'paused'].includes(task.state)).length;
  const summary = $('#catalog-summary');
  if (summary) {
    summary.replaceChildren();
    for (const [label, value] of [['课程', courses.length], ['资源', fileCount], ['回放', replayCount], ['活动任务', activeTaskCount]]) {
      const card = document.createElement('div');
      card.className = 'summary-card';
      const number = document.createElement('strong');
      number.textContent = String(value);
      const caption = document.createElement('span');
      caption.textContent = label;
      card.append(number, caption);
      summary.append(card);
    }
  }
  $('#catalog-meta').textContent = scanState.state === 'running'
    ? `正在扫描 ${scanState.done || 0}/${scanState.total || '…'} ${scanState.courseName || ''}`
    : catalog.updatedAt
      ? `${courses.length} 门课程 · ${fileCount} 个文件 · ${new Date(catalog.updatedAt).toLocaleString('zh-CN')}`
      : '尚未扫描课程';
  $('#scan-courses').disabled = scanState.state === 'running';
  if (resourceView === 'calendar') {
    renderReplayCalendar(courses, query);
    return;
  }
  for (const course of courses) {
    const resources = matchedResources(course, query);
    if (query && !resources.length) continue;
    const details = makeFold(`course:${course.id}`, 'course', Boolean(query));
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
    if (!resources.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = query ? '无匹配文件' : '未扫描到可保存文件';
      details.append(empty);
    } else if (resourceView === 'sources') {
      renderSourceGroups(details, resources, course.id, Boolean(query));
    } else {
      renderActivityGroups(details, resources, course.id, Boolean(query));
    }
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
    $('#selected-course-meta').textContent = '文件按活动分组显示';
    container.innerHTML = '<div class="empty-state">请先从左侧选择课程。</div>';
    return;
  }
  const resources = resourcesFor(course);
  $('#selected-course-name').textContent = course.name;
  $('#selected-course-meta').textContent = `${course.code || ''} · 按活动分组 · ${resources.length} 个文件`;
  renderActivityGroups(container, resources, course.id);
  if (!resources.length) container.innerHTML = '<div class="empty-state">这门课程未扫描到可保存文件。</div>';
}

function renderZyxf() {
  const meta = $('#zyxf-meta');
  const results = $('#zyxf-results');
  const breadcrumb = $('#zyxf-breadcrumb');
  results.replaceChildren();
  breadcrumb.replaceChildren();
  meta.textContent = zyxfState.loading
    ? '正在读取资料库…'
    : zyxfState.data
      ? `${zyxfState.data.folders?.length || 0} 个目录 · ${zyxfState.data.files?.length || 0} 个文件${zyxfState.data.truncated ? ' · 结果较多，请细化关键词' : ''}`
      : '输入关键词搜索，或浏览资料目录。';
  if (zyxfState.folderId !== null && zyxfState.data) {
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'text-button';
    root.textContent = '根目录';
    root.addEventListener('click', () => loadZyxfFolder(0));
    breadcrumb.append(root);
    for (const folder of zyxfState.data.breadcrumb || []) {
      const separator = document.createElement('span');
      separator.textContent = ' / ';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = folder.name;
      button.addEventListener('click', () => loadZyxfFolder(folder.id));
      breadcrumb.append(separator, button);
    }
  }
  if (!zyxfState.data) return;
  for (const folder of zyxfState.data.folders || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'zyxf-folder-row';
    const name = document.createElement('span');
    name.textContent = folder.name;
    const path = document.createElement('small');
    path.textContent = folder.folder_path || '打开目录';
    button.append(name, path);
    button.addEventListener('click', () => loadZyxfFolder(folder.id));
    results.append(button);
  }
  for (const file of zyxfState.data.files || []) {
    const row = document.createElement('div');
    row.className = 'zyxf-file-row';
    const main = document.createElement('div');
    main.className = 'zyxf-file-main';
    const name = document.createElement('span');
    name.textContent = file.name;
    const path = document.createElement('small');
    path.textContent = `${file.folder_path || '根目录'} · ${formatBytes(file.size)}`;
    main.append(name, path);
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button secondary small';
    open.textContent = '打开';
    open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        await call({ type: 'ZYXF_OPEN', fileId: file.id });
      } catch (error) {
        showNotice(error.message);
      } finally {
        open.disabled = false;
      }
    });
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'button secondary small';
    download.textContent = '下载';
    download.addEventListener('click', async () => {
      download.disabled = true;
      try {
        await call({ type: 'QUEUE_ZYXF', items: [file] });
        switchView('tasks');
        await loadState();
        showNotice('已加入下载队列', 'success');
      } catch (error) {
        showNotice(error.message);
      } finally {
        download.disabled = false;
      }
    });
    actions.append(open, download);
    row.append(main, actions);
    results.append(row);
  }
  if (!(zyxfState.data.folders || []).length && !(zyxfState.data.files || []).length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '没有找到匹配资料。';
    results.append(empty);
  }
}

async function runZyxfSearch() {
  const query = $('#zyxf-search').value.trim();
  if (!query) return showNotice('请输入学辅资料关键词');
  zyxfState.loading = true;
  renderZyxf();
  try {
    zyxfState.data = await call({ type: 'ZYXF_SEARCH', query });
    zyxfState.query = query;
    zyxfState.folderId = null;
  } catch (error) {
    showNotice(error.message);
  } finally {
    zyxfState.loading = false;
    renderZyxf();
  }
}

async function loadZyxfFolder(folderId) {
  zyxfState.loading = true;
  renderZyxf();
  try {
    zyxfState.data = await call({ type: 'ZYXF_LIST', folderId });
    zyxfState.folderId = folderId;
    zyxfState.query = '';
    $('#zyxf-search').value = '';
  } catch (error) {
    showNotice(error.message);
  } finally {
    zyxfState.loading = false;
    renderZyxf();
  }
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
  const query = String($('#task-search')?.value || '').trim().toLowerCase();
  const stateFilter = $('#task-state-filter')?.value || 'all';
  const filteredTasks = tasks.filter(task => {
    if (stateFilter === 'active' && !['queued', 'resolving', 'downloading', 'paused'].includes(task.state)) return false;
    if (stateFilter !== 'all' && stateFilter !== 'active' && task.state !== stateFilter) return false;
    if (!query) return true;
    return `${task.activityTitle || ''} ${task.uploadName || ''} ${task.courseName || ''} ${task.source || ''}`.toLowerCase().includes(query);
  });
  $('#tasks-empty').hidden = filteredTasks.length > 0;
  $('#tasks-empty').querySelector('p').textContent = tasks.length && !filteredTasks.length ? '没有匹配的下载任务。' : '还没有下载任务。';
  const active = tasks.filter(task => ['queued', 'resolving', 'downloading', 'paused'].includes(task.state)).length;
  const completed = tasks.filter(task => task.state === 'completed').length;
  const downloaded = tasks.filter(task => task.state === 'completed').reduce((sum, task) => sum + (Number(task.bytesReceived) || 0), 0);
  $('#nav-task-count').textContent = active ? `(${active})` : '';
  $('#task-summary').textContent = `${active} 个进行中 · ${completed} 个已完成 · 已下载 ${formatBytes(downloaded)}`;
  for (const task of filteredTasks) {
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
  renderPortal();
  renderZyxf();
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

async function exportCatalog() {
  const courses = state.catalog.courses || [];
  if (!courses.length) return showNotice('请先扫描课程');
  const payload = {
    exportedAt: new Date().toISOString(),
    courses,
    todos: state.catalog.todos || []
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: `${safeFilePart(state.settings.root || 'XJTU')}/课程清单_${new Date().toISOString().slice(0, 10)}.json`,
      saveAs: true
    });
    showNotice('清单已导出', 'success');
  } catch (error) {
    showNotice(error.message || '导出失败');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function loadCampus() {
  campusLoading = true;
  renderCampus();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('请先打开教务系统或一网通办');
    const response = await call({ type: 'GET_CAMPUS_OVERVIEW', tabId: tab.id });
    campusData = response.data;
    showNotice('校园数据已更新', 'success');
  } catch (error) {
    campusData = null;
    showNotice(error.message);
  } finally {
    campusLoading = false;
    renderCampus();
  }
}

for (const button of document.querySelectorAll('.nav-button')) button.addEventListener('click', () => switchView(button.dataset.view));
for (const button of document.querySelectorAll('.queue-selected')) button.addEventListener('click', queueSelected);
for (const button of document.querySelectorAll('[data-resource-view]')) {
  button.addEventListener('click', () => {
    resourceView = button.dataset.resourceView;
    renderCatalog();
  });
}
$('#expand-resources').addEventListener('click', () => {
  for (const details of document.querySelectorAll('#catalog details, #course-files details')) {
    details.open = true;
    if (details.dataset.detailKey) openDetailKeys.add(details.dataset.detailKey);
  }
});
$('#collapse-resources').addEventListener('click', () => {
  for (const details of document.querySelectorAll('#catalog details, #course-files details')) {
    details.open = false;
    if (details.dataset.detailKey) openDetailKeys.delete(details.dataset.detailKey);
  }
});
$('#resource-search').addEventListener('input', renderCatalog);
$('#export-catalog').addEventListener('click', exportCatalog);
$('#portal-search').addEventListener('input', renderPortal);
$('#portal-sync').addEventListener('click', syncPortal);
$('#task-search').addEventListener('input', renderTasks);
$('#task-state-filter').addEventListener('change', renderTasks);
$('#campus-refresh').addEventListener('click', loadCampus);
$('#zyxf-search-button').addEventListener('click', runZyxfSearch);
$('#zyxf-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') runZyxfSearch();
});
$('#zyxf-browse-root').addEventListener('click', () => loadZyxfFolder(0));

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

const initialParams = new URLSearchParams(location.search);
const initialView = initialParams.get('view');
const initialDisplay = initialParams.get('display');
if (['activities', 'sources', 'calendar'].includes(initialDisplay)) resourceView = initialDisplay;
switchView(['resources', 'courses', 'campus', 'portal', 'zyxf', 'tasks', 'settings'].includes(initialView) ? initialView : 'resources');
renderCampus();
loadState().catch(error => showNotice(error.message));
