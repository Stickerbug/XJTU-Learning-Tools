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
let scheduleView = 'list';
let scheduleWeekCursor = getScheduleMonday(new Date());
let classroomCodes = { campuses: [], buildings: [] };
let classroomData = null;
let classroomLoading = false;

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

async function checkSession() {
  const container = $('#session-status');
  const button = $('#session-check');
  if (button) { button.disabled = true; button.textContent = '检测中…'; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('请先打开校园站点');
    const result = await call({ type: 'GET_SESSION_STATUS', tabId: tab.id });
    const names = { lms: '思源学堂', jwxt: '教务系统', ywtb: '一网通办' };
    container.hidden = false;
    container.textContent = `${names[result.site] || result.site}：${result.loggedIn === true ? '已登录' : result.loggedIn === false ? '未登录' : '当前页暂不支持检测'}`;
    container.className = `session-status ${result.loggedIn === true ? 'is-online' : ''}`;
  } catch (error) {
    showNotice(error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = '检测登录状态'; }
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

function getScheduleMonday(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function scheduleWeekday(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const number = text.match(/[1-7]/)?.[0];
  if (number && !/周|星期|week/.test(text)) return Number(number);
  if (/^(?:0|日|天|星期日|周日|sunday)$/.test(text)) return 7;
  for (const [name, day] of Object.entries({ '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 })) {
    if (text.includes(name)) return day;
  }
  return null;
}

function scheduleSectionRange(value) {
  const values = String(value ?? '').match(/\d+/g)?.map(Number).filter(item => item >= 1 && item <= 11) || [];
  if (!values.length) return null;
  return { start: Math.min(...values), end: Math.max(...values) };
}

function scheduleWeekLabel(date) {
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  const format = value => value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  return `${format(date)} – ${format(end)}`;
}

function renderScheduleList(container, rows) {
  container.replaceChildren();
  for (const row of rows) {
    const day = scheduleWeekday(row.weekday);
    const dayLabel = day ? `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]}` : row.weekday;
    container.append(campusItem(row.course, [dayLabel, row.section, row.classroom, row.teacher, row.weeks]));
  }
  if (!rows.length) container.append(campusEmpty('暂无课表数据'));
}

function syncScheduleView() {
  const list = $('#campus-schedule');
  const week = $('#campus-schedule-week');
  const toolbar = $('#schedule-week-toolbar');
  const label = $('#schedule-week-label');
  if (!list || !week || !toolbar || !label) return;
  const showWeek = scheduleView === 'week';
  for (const button of document.querySelectorAll('[data-schedule-view]')) {
    button.classList.toggle('active', button.dataset.scheduleView === scheduleView);
  }
  list.hidden = showWeek;
  week.hidden = !showWeek;
  toolbar.hidden = !showWeek;
  if (!showWeek) return;
  label.textContent = scheduleWeekLabel(scheduleWeekCursor);
  week.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'schedule-week-grid';
  const corner = document.createElement('div');
  corner.className = 'schedule-week-corner';
  grid.append(corner);
  for (let day = 1; day <= 7; day += 1) {
    const cell = document.createElement('div');
    cell.className = 'schedule-week-day';
    const date = new Date(scheduleWeekCursor);
    date.setDate(date.getDate() + day - 1);
    cell.textContent = `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]} ${date.getMonth() + 1}/${date.getDate()}`;
    grid.append(cell);
  }
  const cells = new Map();
  for (let section = 1; section <= 11; section += 1) {
    const marker = document.createElement('div');
    marker.className = 'schedule-week-section';
    marker.textContent = `第${section}节`;
    grid.append(marker);
    for (let day = 1; day <= 7; day += 1) {
      const cell = document.createElement('div');
      cell.className = 'schedule-week-cell';
      cells.set(`${day}:${section}`, cell);
      grid.append(cell);
    }
  }
  for (const row of campusData?.schedule || []) {
    const day = scheduleWeekday(row.weekday);
    const range = scheduleSectionRange(row.section);
    if (!day || !range) continue;
    const cell = cells.get(`${day}:${range.start}`);
    if (!cell) continue;
    const item = document.createElement('div');
    item.className = 'schedule-week-item';
    const title = document.createElement('strong');
    title.textContent = row.course || '未命名课程';
    const meta = document.createElement('span');
    meta.textContent = [row.classroom, row.teacher, row.weeks].filter(Boolean).join(' · ');
    item.append(title, meta);
    cell.append(item);
  }
  week.append(grid);
}

function icsEscape(value) {
  return String(value || '').replace(/[\\;,]/g, match => `\\${match}`).replace(/\r?\n/g, '\\n');
}

function icsDate(date, minutes) {
  const value = new Date(date);
  value.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  const pad = number => String(number).padStart(2, '0');
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}T${pad(value.getHours())}${pad(value.getMinutes())}00`;
}

async function exportScheduleIcs() {
  const rows = campusData?.schedule || [];
  if (!rows.length) return showNotice('请先读取课表');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//XJTU Learning Tools//Campus//CN', 'CALSCALE:GREGORIAN'];
  for (const [index, row] of rows.entries()) {
    const weekday = scheduleWeekday(row.weekday);
    const range = scheduleSectionRange(row.section);
    if (!weekday || !range) continue;
    const start = PERIOD_STARTS[range.start - 1] ?? PERIOD_STARTS[0];
    const end = (PERIOD_STARTS[Math.min(10, range.end - 1)] ?? start) + 45;
    const date = new Date(scheduleWeekCursor);
    date.setDate(date.getDate() + weekday - 1);
    lines.push('BEGIN:VEVENT', `UID:xjtu-${Date.now()}-${index}@learning-tools`, `DTSTART:${icsDate(date, start)}`, `DTEND:${icsDate(date, end)}`, `SUMMARY:${icsEscape(row.course || '课程')}`);
    const location = [row.classroom, row.teacher].filter(Boolean).join(' · ');
    if (location) lines.push(`LOCATION:${icsEscape(location)}`);
    if (row.weeks) lines.push(`DESCRIPTION:${icsEscape(`周次：${row.weeks}`)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' }));
  try {
    await chrome.downloads.download({ url, filename: `${safeFilePart(state.settings.root || 'XJTU')}/课表_${localDateValue(scheduleWeekCursor)}.ics`, saveAs: true });
    showNotice('课表 ICS 已导出', 'success');
  } catch (error) {
    showNotice(error.message || '导出失败');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function gradeStatus(row, score, gpa) {
  const text = String(row.score ?? '').trim();
  if (!text || /未出|未录|待评|待录|待定|缓考|缺考|取消|免修|无成绩|—|^-$|^n\/?a$/i.test(text)) return 'pending';
  if (/不及格|不合格|挂科/.test(text) || (score != null && score < 60) || (gpa != null && gpa < 1)) return 'low';
  return 'passed';
}

function summarizeGrades(rows) {
  const items = rows.map(row => {
    const score = numericValue(row.score);
    const credit = numericValue(row.credit);
    const gpa = numericValue(row.gpa);
    const status = gradeStatus(row, score, gpa);
    return {
      row,
      score,
      credit,
      gpa,
      status,
      weight: credit != null && credit > 0 ? credit : 1
    };
  });
  const scored = items.filter(item => item.score != null && item.status !== 'pending');
  const gpaItems = items.filter(item => item.gpa != null && item.status !== 'pending');
  const weightedAverage = values => {
    if (!values.length) return null;
    const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
    return totalWeight ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight : null;
  };
  const scoreAverage = weightedAverage(scored.map(item => ({ ...item, value: item.score })));
  const gpaAverage = weightedAverage(gpaItems.map(item => ({ ...item, value: item.gpa })));
  return {
    items,
    total: items.length,
    completed: items.filter(item => item.status !== 'pending').length,
    pending: items.filter(item => item.status === 'pending').length,
    low: items.filter(item => item.status === 'low').length,
    weightedAverage: scoreAverage,
    averageGpa: gpaAverage
  };
}

function renderGradeSummary(container, stats) {
  container.replaceChildren();
  const cards = [
    ['加权平均分', stats.weightedAverage == null ? '—' : stats.weightedAverage.toFixed(2), '按学分加权'],
    ['平均绩点', stats.averageGpa == null ? '—' : stats.averageGpa.toFixed(2), '按学分加权'],
    ['未出成绩', stats.pending, stats.pending ? '门课程待更新' : '暂无待更新'],
    ['低分课程', stats.low, stats.low ? '成绩低于 60 或绩点低于 1' : '暂无低分课程']
  ];
  for (const [label, value, note] of cards) {
    const card = document.createElement('div');
    card.className = 'summary-card grade-summary-card';
    const number = document.createElement('strong');
    number.textContent = String(value);
    const text = document.createElement('span');
    text.textContent = label;
    const hint = document.createElement('small');
    hint.textContent = note;
    card.append(number, text, hint);
    container.append(card);
  }
}

function renderGradeTable(container, stats) {
  container.replaceChildren();
  if (!stats.items.length) {
    container.append(campusEmpty('暂无成绩数据'));
    return;
  }
  const table = document.createElement('table');
  table.className = 'grade-table';
  const caption = document.createElement('caption');
  caption.textContent = '课程成绩明细';
  table.append(caption);
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['课程', '成绩', '学分', '绩点', '学期', '状态']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const item of stats.items) {
    const row = document.createElement('tr');
    if (item.status === 'low') row.className = 'is-low';
    if (item.status === 'pending') row.className = 'is-pending';
    const valueOrDash = value => value == null || String(value).trim() === '' ? '—' : value;
    const values = [
      valueOrDash(item.row.course) === '—' ? '未命名课程' : valueOrDash(item.row.course),
      valueOrDash(item.row.score),
      valueOrDash(item.row.credit),
      valueOrDash(item.row.gpa),
      valueOrDash(item.row.term)
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    const status = document.createElement('td');
    status.className = `grade-status grade-status-${item.status}`;
    status.textContent = item.status === 'pending' ? '未出成绩' : item.status === 'low' ? '低分' : '已计入';
    row.append(status);
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}

const WEEKDAY_NUMBERS = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const PERIOD_STARTS = [480, 535, 610, 665, 840, 895, 970, 1025, 1140, 1195, 1250];

function parseCampusDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value).trim().replace(/(?:星期|周)[一二三四五六日天].*$/, '').replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

function campusWeekday(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  const numeric = text.match(/[0-7]/)?.[0];
  if (numeric != null && !/周|星期|week/.test(text)) return Number(numeric) % 7;
  for (const [name, number] of Object.entries(WEEKDAY_NUMBERS)) if (text.includes(name)) return number;
  return null;
}

function campusSection(row) {
  const value = String(row?.section || row?.period || '').trim();
  const number = value.match(/\d+/)?.[0];
  if (number) return Number(number);
  const chinese = value.match(/[一二三四五六七八九十]+/)?.[0];
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11 };
  return chinese ? (digits[chinese] || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
}

function campusDateMatches(row, date) {
  const explicitDate = parseCampusDate(row?.date || row?.classDate || row?.startDate);
  if (explicitDate) return localDateValue(explicitDate) === localDateValue(date);
  const weekday = campusWeekday(row?.weekday);
  return weekday != null && weekday === date.getDay();
}

function campusCourseMeta(row) {
  return [row?.section && `第 ${row.section} 节`, row?.classroom, row?.teacher, row?.weeks].filter(Boolean).join(' · ');
}

function renderTodayCenter() {
  const dateElement = $('#campus-today-date');
  const sourceElement = $('#campus-today-source');
  const next = $('#today-next-class');
  const nextMeta = $('#today-next-class-meta');
  const courseCount = $('#today-course-count');
  const courseList = $('#today-course-list');
  const examCountdown = $('#today-exam-countdown');
  const examMeta = $('#today-exam-meta');
  const todoCount = $('#today-todo-count');
  const todoMeta = $('#today-todo-meta');
  if (!dateElement || !sourceElement || !next || !nextMeta || !courseCount || !courseList || !examCountdown || !examMeta || !todoCount || !todoMeta) return;
  const today = new Date();
  dateElement.textContent = today.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  sourceElement.textContent = campusData ? `${campusData.site === 'jwxt' ? '教务系统' : '一网通办'}${campusData.term ? ` · ${campusData.term}` : ''}` : '读取校园数据后更新';
  const schedule = Array.isArray(campusData?.schedule) ? campusData.schedule : [];
  const todayCourses = schedule.filter(row => campusDateMatches(row, today)).sort((a, b) => campusSection(a) - campusSection(b));
  courseCount.textContent = campusData ? `${todayCourses.length} 门` : '—';
  courseList.textContent = todayCourses.length ? todayCourses.slice(0, 3).map(row => row.course || '未命名课程').join('、') + (todayCourses.length > 3 ? ` 等 ${todayCourses.length} 门` : '') : campusData ? '今天没有安排课程' : '读取课表后显示';
  if (!campusData) {
    next.textContent = '—';
    nextMeta.textContent = '暂无课表数据';
  } else if (!todayCourses.length) {
    next.textContent = '暂无课程';
    nextMeta.textContent = '今天没有安排课程';
  } else {
    const nowMinutes = today.getHours() * 60 + today.getMinutes();
    const currentPeriod = PERIOD_STARTS.reduce((period, start, index) => nowMinutes >= start ? index + 1 : period, 0);
    const nextCourse = todayCourses.find(row => campusSection(row) >= Math.max(1, currentPeriod)) || todayCourses[0];
    const isLaterDay = todayCourses.every(row => campusSection(row) < currentPeriod);
    next.textContent = isLaterDay ? '今日课程已结束' : (nextCourse.course || '未命名课程');
    nextMeta.textContent = isLaterDay ? `共 ${todayCourses.length} 门课程` : campusCourseMeta(nextCourse) || '时间待定';
  }
  const upcomingExams = (campusData?.exams || []).map(row => ({ row, date: parseCampusDate(row.date) })).filter(item => item.date).sort((a, b) => a.date - b.date);
  const upcomingExam = upcomingExams.find(item => localDateValue(item.date) >= localDateValue(today));
  if (!campusData) {
    examCountdown.textContent = '—';
    examMeta.textContent = '暂无考试数据';
  } else if (!upcomingExam) {
    examCountdown.textContent = '暂无';
    examMeta.textContent = '近期没有考试安排';
  } else {
    const dayDelta = Math.round((new Date(localDateValue(upcomingExam.date)) - new Date(localDateValue(today))) / 86400000);
    examCountdown.textContent = dayDelta === 0 ? '今天' : `D-${dayDelta}`;
    examMeta.textContent = `${upcomingExam.row.course || '未命名考试'}${upcomingExam.row.time ? ` · ${upcomingExam.row.time}` : ''}`;
  }
  const todos = Array.isArray(state.catalog?.todos) ? state.catalog.todos : [];
  const pendingTodos = todos.filter(todo => !['completed', 'done', 'finished'].includes(String(todo.status || '').toLowerCase()));
  todoCount.textContent = `${pendingTodos.length} 项`;
  if (!pendingTodos.length) todoMeta.textContent = todos.length ? '待办已全部完成' : '暂无待办事项';
  else {
    const nearest = [...pendingTodos].sort((a, b) => (parseCampusDate(a.dueAt)?.getTime() || Infinity) - (parseCampusDate(b.dueAt)?.getTime() || Infinity))[0];
    todoMeta.textContent = nearest.title ? `${nearest.courseName ? `${nearest.courseName} · ` : ''}${nearest.title}` : '打开批量下载查看详情';
  }
}

function renderCampus() {
  const status = $('#campus-state');
  const profile = $('#campus-profile');
  const schedule = $('#campus-schedule');
  const exams = $('#campus-exams');
  const grades = $('#campus-grades');
  const gradeSummary = $('#campus-grade-summary');
  if (!status || !profile || !schedule || !exams || !grades || !gradeSummary) return;
  schedule.replaceChildren();
  const scheduleWeek = $('#campus-schedule-week');
  if (scheduleWeek) scheduleWeek.replaceChildren();
  exams.replaceChildren();
  grades.replaceChildren();
  gradeSummary.replaceChildren();
  profile.replaceChildren();
  if (campusLoading) {
    status.textContent = '正在读取当前页面…';
    gradeSummary.hidden = true;
    syncScheduleView();
    renderTodayCenter();
    return;
  }
  if (!campusData) {
    status.textContent = '请打开教务系统或一网通办后读取。';
    profile.hidden = true;
    $('#campus-schedule-count').textContent = '';
    $('#campus-exam-count').textContent = '';
    $('#campus-grade-count').textContent = '';
    gradeSummary.hidden = true;
    schedule.append(campusEmpty('暂无课表数据'));
    exams.append(campusEmpty('暂无考试数据'));
    grades.append(campusEmpty('暂无成绩数据'));
    syncScheduleView();
    renderTodayCenter();
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
  const scheduleRows = Array.isArray(campusData.schedule) ? campusData.schedule : [];
  const examRows = Array.isArray(campusData.exams) ? campusData.exams : [];
  const gradeRows = Array.isArray(campusData.grades) ? campusData.grades : [];
  const gradeStats = summarizeGrades(gradeRows);
  $('#campus-schedule-count').textContent = `${scheduleRows.length} 门`;
  $('#campus-exam-count').textContent = `${examRows.length} 场`;
  $('#campus-grade-count').textContent = `${gradeRows.length} 门${gradeStats.pending ? ` · ${gradeStats.pending} 门未出` : ''}`;
  renderScheduleList(schedule, scheduleRows);
  for (const row of examRows) exams.append(campusItem(row.course, [row.date, row.time, row.classroom, row.seat && `座位 ${row.seat}`]));
  gradeSummary.hidden = false;
  renderGradeSummary(gradeSummary, gradeStats);
  renderGradeTable(grades, gradeStats);
  if (!examRows.length) exams.append(campusEmpty('暂无考试数据'));
  syncScheduleView();
  renderTodayCenter();
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
  renderTodayCenter();
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
  $('#setting-username').value = state.settings.username || '';
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

function localDateValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function campusTab() {
  const tabs = await chrome.tabs.query({});
  const active = tabs.find(tab => tab.active && tab.url?.startsWith('https://jwxt.xjtu.edu.cn/'));
  return active || tabs.find(tab => tab.url?.startsWith('https://jwxt.xjtu.edu.cn/')) || null;
}

function periodOptions() {
  return Array.from({ length: 11 }, (_, index) => ({ value: String(index + 1), label: `第 ${index + 1} 节` }));
}

function fillClassroomSelects() {
  const campusSelect = $('#classroom-campus');
  const buildingSelect = $('#classroom-building');
  if (!campusSelect || !buildingSelect) return;
  const previousCampus = campusSelect.value;
  const previousBuilding = buildingSelect.value;
  campusSelect.replaceChildren();
  for (const campus of classroomCodes.campuses || []) {
    const option = document.createElement('option');
    option.value = campus.code;
    option.textContent = campus.name;
    campusSelect.append(option);
  }
  if (classroomCodes.campuses.some(item => item.code === previousCampus)) campusSelect.value = previousCampus;
  buildingSelect.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部楼栋';
  buildingSelect.append(all);
  for (const building of classroomCodes.buildings || []) {
    const option = document.createElement('option');
    option.value = building.code;
    option.textContent = building.name;
    buildingSelect.append(option);
  }
  if (classroomCodes.buildings.some(item => item.code === previousBuilding)) buildingSelect.value = previousBuilding;
}

function renderClassroomPeriods() {
  const start = $('#classroom-start');
  const end = $('#classroom-end');
  if (!start || !end || start.options.length) return;
  for (const item of periodOptions()) {
    const first = document.createElement('option');
    first.value = item.value;
    first.textContent = item.label;
    const second = first.cloneNode(true);
    start.append(first);
    end.append(second);
  }
  start.value = '1';
  end.value = '1';
  start.addEventListener('change', () => {
    if (Number(end.value) < Number(start.value)) end.value = start.value;
  });
}

function renderClassrooms() {
  const stateElement = $('#classroom-state');
  const summary = $('#classroom-summary');
  const results = $('#classroom-results');
  if (!stateElement || !summary || !results) return;
  results.replaceChildren();
  if (classroomLoading) {
    stateElement.textContent = '正在查询教室状态…';
    summary.hidden = true;
    return;
  }
  if (!classroomData) {
    stateElement.textContent = classroomCodes.campuses.length ? '选择时间后查询。' : '请打开教务系统后加载校区和楼栋。';
    summary.hidden = true;
    return;
  }
  const minCapacity = Number($('#classroom-capacity')?.value || 0);
  const typeQuery = String($('#classroom-type')?.value || '').trim().toLowerCase();
  const rooms = (classroomData.rooms || []).filter(room => {
    if (minCapacity && Number(room.capacity || 0) < minCapacity) return false;
    if (typeQuery && !String(room.type || '').toLowerCase().includes(typeQuery)) return false;
    return true;
  });
  const free = rooms.filter(room => room.status === 'free').length;
  const occupied = rooms.filter(room => room.status === 'occupied').length;
  summary.hidden = false;
  summary.replaceChildren();
  const cards = [
    ['空闲', free],
    ['占用', classroomData.occupied == null ? '—' : occupied],
    ['查询楼栋', classroomData.queriedBuildings || classroomData.codes?.buildings?.length || 0],
    ['筛选结果', rooms.length]
  ];
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'summary-card';
    const number = document.createElement('strong');
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = `${label}${label === '查询楼栋' ? '' : '间'}`;
    card.append(number, caption);
    summary.append(card);
  }
  stateElement.textContent = `${classroomData.campus?.name || ''} · ${classroomData.date} · 第 ${classroomData.startSection}-${classroomData.endSection} 节 · ${classroomData.building?.name || '全部楼栋'}${classroomData.errors?.length ? ` · ${classroomData.errors.length} 个楼栋未返回数据` : ''}`;
  const groups = new Map();
  for (const room of rooms) {
    const key = room.buildingName || '未标注楼栋';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(room);
  }
  for (const [building, buildingRooms] of groups) {
    const section = document.createElement('section');
    section.className = 'classroom-building-group';
    const heading = document.createElement('div');
    heading.className = 'classroom-group-head';
    const title = document.createElement('h2');
    title.textContent = building;
    const freeCount = buildingRooms.filter(room => room.status === 'free').length;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = classroomData.occupied == null ? `${freeCount} 间空闲` : `${freeCount} 空闲 · ${buildingRooms.length - freeCount} 占用`;
    heading.append(title, meta);
    section.append(heading);
    const list = document.createElement('div');
    list.className = 'classroom-room-list';
    for (const room of buildingRooms) {
      const row = document.createElement('div');
      row.className = `classroom-room ${room.status === 'occupied' ? 'is-occupied' : 'is-free'}`;
      const name = document.createElement('strong');
      name.textContent = room.name;
      const details = document.createElement('span');
      details.textContent = [room.type, room.capacity ? `${room.capacity} 座` : '', room.examCapacity ? `考试 ${room.examCapacity} 座` : ''].filter(Boolean).join(' · ');
      const status = document.createElement('span');
      status.className = 'classroom-room-status';
      status.textContent = room.status === 'occupied' ? '占用' : '空闲';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'text-button';
      copy.textContent = '复制';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(`${building} ${room.name}`);
          showNotice('教室名称已复制', 'success');
        } catch { showNotice(`${building} ${room.name}`); }
      });
      row.append(name, details, status, copy);
      list.append(row);
    }
    section.append(list);
    results.append(section);
  }
  if (!rooms.length) results.append(campusEmpty('没有符合筛选条件的教室'));
}

async function loadClassroomCodes() {
  const stateElement = $('#classroom-state');
  const button = $('#classroom-load-codes');
  if (button) { button.disabled = true; button.textContent = '读取中…'; }
  try {
    const tab = await campusTab();
    if (!tab?.id) throw new Error('请先打开并登录教务系统');
    const response = await call({ type: 'GET_CLASSROOM_CODES', tabId: tab.id });
    classroomCodes = response.data || { campuses: [], buildings: [] };
    fillClassroomSelects();
    if (stateElement) stateElement.textContent = `已读取 ${classroomCodes.campuses.length} 个校区、${classroomCodes.buildings.length} 栋教学楼`;
    showNotice('校区和楼栋已更新', 'success');
  } catch (error) {
    if (stateElement) stateElement.textContent = error.message;
    showNotice(error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = '刷新校区和楼栋'; }
  }
}

async function queryClassrooms() {
  if (!classroomCodes.campuses.length) await loadClassroomCodes();
  if (!classroomCodes.campuses.length) return;
  classroomLoading = true;
  renderClassrooms();
  const button = $('#classroom-query');
  if (button) { button.disabled = true; button.textContent = '查询中…'; }
  try {
    const tab = await campusTab();
    if (!tab?.id) throw new Error('请先打开并登录教务系统');
    const response = await call({
      type: 'GET_CLASSROOMS',
      tabId: tab.id,
      query: {
        campusCode: $('#classroom-campus').value,
        buildingCode: $('#classroom-building').value,
        date: $('#classroom-date').value,
        startSection: $('#classroom-start').value,
        endSection: $('#classroom-end').value,
        status: $('#classroom-status').value
      }
    });
    classroomData = response.data;
    if (classroomData?.codes) classroomCodes = classroomData.codes;
    renderClassrooms();
    showNotice(`已查询 ${classroomData?.available ?? 0} 间空闲教室`, 'success');
  } catch (error) {
    classroomData = null;
    showNotice(error.message);
    renderClassrooms();
  } finally {
    classroomLoading = false;
    renderClassrooms();
    if (button) { button.disabled = false; button.textContent = '查询空教室'; }
  }
}

async function loadCampus() {
  campusLoading = true;
  renderCampus();
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = activeTab?.url?.startsWith('https://jwxt.xjtu.edu.cn/') || activeTab?.url?.startsWith('https://ywtb.xjtu.edu.cn/')
      ? activeTab
      : (await chrome.tabs.query({})).find(item => item.url?.startsWith('https://jwxt.xjtu.edu.cn/') || item.url?.startsWith('https://ywtb.xjtu.edu.cn/'));
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
$('#session-check').addEventListener('click', checkSession);
$('#task-search').addEventListener('input', renderTasks);
$('#task-state-filter').addEventListener('change', renderTasks);
$('#campus-refresh').addEventListener('click', loadCampus);
for (const button of document.querySelectorAll('[data-schedule-view]')) button.addEventListener('click', () => {
  scheduleView = button.dataset.scheduleView;
  syncScheduleView();
});
$('#schedule-week-prev').addEventListener('click', () => {
  scheduleWeekCursor.setDate(scheduleWeekCursor.getDate() - 7);
  syncScheduleView();
});
$('#schedule-week-next').addEventListener('click', () => {
  scheduleWeekCursor.setDate(scheduleWeekCursor.getDate() + 7);
  syncScheduleView();
});
$('#schedule-week-today').addEventListener('click', () => {
  scheduleWeekCursor = getScheduleMonday(new Date());
  syncScheduleView();
});
$('#schedule-export-ics').addEventListener('click', exportScheduleIcs);
$('#classroom-load-codes').addEventListener('click', loadClassroomCodes);
$('#classroom-query').addEventListener('click', queryClassrooms);
$('#classroom-date').value = localDateValue();
renderClassroomPeriods();
for (const selector of ['#classroom-capacity', '#classroom-type', '#classroom-status']) $(selector).addEventListener('input', renderClassrooms);
$('#classroom-status').addEventListener('change', renderClassrooms);
document.querySelector('[data-view="classrooms"]').addEventListener('click', () => {
  if (!classroomCodes.campuses.length) loadClassroomCodes();
});
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
        defaultTrack: $('#batch-track').value,
        username: $('#setting-username').value
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
switchView(['resources', 'courses', 'campus', 'classrooms', 'portal', 'zyxf', 'tasks', 'settings'].includes(initialView) ? initialView : 'resources');
renderCampus();
renderClassrooms();
if (initialView === 'classrooms') loadClassroomCodes();
loadState().catch(error => showNotice(error.message));
