(() => {
  'use strict';

  const textValue = value => {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim();
  };

  const pick = (object, keys) => {
    for (const key of keys) {
      const value = textValue(object?.[key]);
      if (value) return value;
    }
    return '';
  };

  const rowsFrom = (payload, names) => {
    for (const name of names) {
      const value = name.split('.').reduce((current, key) => current?.[key], payload);
      if (Array.isArray(value)) return value;
      if (Array.isArray(value?.rows)) return value.rows;
    }
    return [];
  };

  async function api(path, options = {}) {
    const headers = {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {})
    };
    const response = await fetch(path, { credentials: 'include', ...options, headers });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('当前页面登录状态已失效');
      throw new Error(`校园服务请求失败（${response.status}）`);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('当前页面需要先完成登录');
    return response.json();
  }

  function currentUser(payload) {
    const source = payload?.datas?.currentUser?.rows?.[0] || payload?.datas?.currentUser ||
      payload?.data?.user || payload?.data || payload?.user || payload;
    return {
      name: pick(source, ['XM', 'xm', 'name', 'realName', 'userName', 'username']),
      studentId: pick(source, ['XH', 'xh', 'studentNo', 'studentId', 'account']),
      department: pick(source, ['YXSMC', 'YXSMC_DISPLAY', 'department', 'deptName', 'orgName'])
    };
  }

  function normalizeSchedule(rows) {
    return rows.slice(0, 200).map(row => ({
      course: pick(row, ['KCM', 'KCMC', 'KCMX', 'courseName', 'course_name']),
      teacher: pick(row, ['JSXM', 'JS', 'teacherName', 'teacher_name']),
      classroom: pick(row, ['JASMC', 'JASMC_DISPLAY', '教室', 'classroom', 'roomName']),
      weekday: pick(row, ['XQJ', 'XQJMC', 'weekday', 'weekDay']),
      section: pick(row, ['JCD', 'JCDMC', 'section', 'period']),
      weeks: pick(row, ['ZC', 'ZCMC', 'weeks', 'weekRange'])
    })).filter(item => item.course || item.classroom || item.teacher);
  }

  function normalizeExams(rows) {
    return rows.slice(0, 100).map(row => ({
      course: pick(row, ['KCM', 'KCMC', 'courseName', 'course_name']),
      date: pick(row, ['KSRQ', 'examDate', 'date']),
      time: pick(row, ['KSSJMS', 'KSSJ', 'examTime', 'time']),
      classroom: pick(row, ['JASMC', 'JASMC_DISPLAY', 'classroom', 'roomName']),
      seat: pick(row, ['ZWH', 'seat', 'seatNo'])
    })).filter(item => item.course || item.date || item.classroom);
  }

  function normalizeGrades(rows) {
    return rows.slice(0, 200).map(row => ({
      course: pick(row, ['KCM', 'KCMC', 'courseName', 'course_name']),
      score: pick(row, ['ZCJ', 'score', 'totalScore', 'grade']),
      credit: pick(row, ['XF', 'coursePoint', 'credit']),
      gpa: pick(row, ['XFJD', 'gpa', 'GPA']),
      term: pick(row, ['XNXQDM', 'XNXQDM_DISPLAY', 'termCode', 'termName'])
    })).filter(item => item.course || item.score);
  }

  async function jwxtOverview() {
    await ensureStudentRole();
    const userRequest = api('/jwapp/sys/homeapp/api/home/currentUser.do');
    const termRequest = api('/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do', {
      method: 'POST',
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    const [userResult, termResult] = await Promise.allSettled([userRequest, termRequest]);
    const user = userResult.status === 'fulfilled' ? currentUser(userResult.value) : {};
    const termPayload = termResult.status === 'fulfilled' ? termResult.value : null;
    const termRow = rowsFrom(termPayload, ['datas.dqxnxq', 'data.dqxnxq', 'dqxnxq'])[0] || {};
    const term = pick(termRow, ['DM', 'dm', 'termCode', 'XNXQDM']) || pick(termPayload, ['xnxqdm', 'termCode']);
    const errors = [];
    if (userResult.status === 'rejected') errors.push('用户信息');
    if (termResult.status === 'rejected') errors.push('当前学期');
    const requests = [
      ['schedule', api('/jwapp/sys/wdkb/modules/xskcb/xskcb.do', { method: 'POST', body: new URLSearchParams({ XNXQDM: term || '' }) })],
      ['exams', api('/jwapp/sys/studentWdksapApp/modules/wdksap/wdksap.do', { method: 'POST', body: new URLSearchParams({ XNXQDM: term || '', '*order': '-KSRQ,-KSSJMS' }) })],
      ['grades', api('/jwapp/sys/cjcx/modules/cjcx/xscjcx.do', {
        method: 'POST',
        body: new URLSearchParams({
          pageSize: '1000',
          pageNumber: '1',
          querySetting: JSON.stringify([{ name: 'SFYX', caption: '是否有效', linkOpt: 'AND', builderList: 'cbl_m_List', builder: 'm_value_equal', value: '1', value_display: '是' }])
        })
      })]
    ];
    const settled = await Promise.allSettled(requests.map(item => item[1]));
    const result = { site: 'jwxt', user, term, schedule: [], exams: [], grades: [], errors };
    for (let index = 0; index < settled.length; index += 1) {
      const [name] = requests[index];
      const response = settled[index];
      if (response.status === 'rejected') {
        result.errors.push(name === 'schedule' ? '课表' : name === 'exams' ? '考试安排' : '成绩');
        continue;
      }
      const rows = name === 'schedule'
        ? rowsFrom(response.value, ['datas.xskcb', 'data.xskcb', 'xskcb'])
        : name === 'exams'
          ? rowsFrom(response.value, ['datas.wdksap', 'data.wdksap', 'wdksap'])
          : rowsFrom(response.value, ['datas.xscjcx', 'data.xscjcx', 'xscjcx']);
      result[name] = name === 'schedule' ? normalizeSchedule(rows) : name === 'exams' ? normalizeExams(rows) : normalizeGrades(rows);
    }
    return result;
  }

  async function ywtbOverview() {
    const payload = await api('/portal-api/v1/calendar/share/schedule/getWeekOfTeaching');
    const rows = rowsFrom(payload, ['data.list', 'data.rows', 'data', 'rows', 'list']);
    return { site: 'ywtb', user: {}, term: pick(payload, ['xnxqdm', 'termCode']), schedule: normalizeSchedule(rows), exams: [], grades: [], errors: [] };
  }

  function codeRows(payload) {
    return rowsFrom(payload, ['datas.code', 'data.code', 'code', 'rows']);
  }

  function normalizeRoomRows(rows, defaults = {}) {
    return rows.map(row => ({
      name: pick(row, ['JASMC', 'JASMC_DISPLAY', 'roomName', 'name']),
      buildingName: pick(row, ['JXLDM_DISPLAY', 'buildingName', 'building']),
      buildingCode: pick(row, ['JXLDM', 'buildingCode']),
      type: pick(row, ['JASLXDM_DISPLAY', 'type', 'roomType']),
      capacity: pick(row, ['SKZWS', 'capacity', 'seatCount']),
      examCapacity: pick(row, ['KSZWS', 'exam_capacity', 'examCapacity']),
      campusName: pick(row, ['XXXQDM_DISPLAY', 'campusName', 'campus']) || defaults.campusName,
      campusCode: pick(row, ['XXXQDM', 'campusCode']) || defaults.campusCode
    })).filter(room => room.name && room.type && !room.name.includes('测试专用'));
  }

  async function ensureStudentRole() {
    const payload = await api('/jwapp/sys/homeapp/api/home/currentUser.do');
    const groups = payload?.datas?.userGroups || payload?.data?.userGroups || [];
    const current = groups.find(item => item.currentRole);
    if (current?.roleName === '学生') return;
    const student = groups.find(item => item.roleName === '学生');
    if (student?.roleId) {
      await api('/jwapp/sys/homeapp/api/home/changeAppRole.do', {
        method: 'POST', body: new URLSearchParams({ appRole: String(student.roleId) })
      });
    }
  }

  let classroomCodeCache = null;

  async function classroomCodes() {
    if (classroomCodeCache && Date.now() - classroomCodeCache.updatedAt < 7 * 24 * 60 * 60 * 1000) {
      return classroomCodeCache;
    }
    const [campusPayload, buildingPayload] = await Promise.all([
      api('/jwapp/code/83a986fc-e677-400e-99a4-c7bb39c2ca35.do', { method: 'POST' }),
      api('/jwapp/code/551fbcc3-cf07-4566-af1e-fc7ce272ddc1.do', { method: 'POST' })
    ]);
    const campuses = codeRows(campusPayload).map(row => ({
      code: pick(row, ['id', 'code', 'value']), name: pick(row, ['name', 'text', 'label'])
    })).filter(item => item.code && item.name);
    const buildings = codeRows(buildingPayload).map(row => ({
      code: pick(row, ['id', 'code', 'value']), name: pick(row, ['name', 'text', 'label'])
    })).filter(item => item.code && item.name);
    classroomCodeCache = { campuses, buildings, updatedAt: Date.now() };
    return classroomCodeCache;
  }

  async function classroomQuery(campusCode, buildingCode, date, startSection, endSection) {
    const payload = await api('/jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do', {
      method: 'POST',
      body: new URLSearchParams({
        XXXQDM: campusCode || '', JXLDM: buildingCode || '', KXRQ: date,
        KSJC: String(startSection), JSJC: String(endSection), pageSize: '500', pageNumber: '1'
      })
    });
    return normalizeRoomRows(rowsFrom(payload, ['datas.cxkxjs', 'data.cxkxjs', 'cxkxjs']), { campusCode });
  }

  async function classrooms(request = {}) {
    if (location.hostname !== 'jwxt.xjtu.edu.cn') throw new Error('请打开教务系统页面');
    await ensureStudentRole();
    const codes = await classroomCodes();
    const campus = codes.campuses.find(item => item.code === String(request.campusCode || '')) || codes.campuses[0];
    if (!campus) throw new Error('未读取到校区列表');
    const selectedBuilding = String(request.buildingCode || '');
    const buildings = codes.buildings.filter(item => !selectedBuilding || item.code === selectedBuilding);
    const date = String(request.date || new Date().toISOString().slice(0, 10));
    const startSection = Math.max(1, Math.min(11, Number(request.startSection) || 1));
    const endSection = Math.max(startSection, Math.min(11, Number(request.endSection) || startSection));
    const chunks = [];
    const errors = [];
    for (let index = 0; index < buildings.length; index += 5) {
      const batch = buildings.slice(index, index + 5);
      const results = await Promise.all(batch.map(building => classroomQuery(campus.code, building.code, date, startSection, endSection)
        .then(rows => ({ rows }))
        .catch(error => ({ rows: [], error }))));
      results.forEach((result, offset) => {
        if (result.error) errors.push(`${batch[offset].name}：${textValue(result.error.message || result.error)}`);
        chunks.push(...result.rows);
      });
    }
    const free = chunks.map(room => ({ ...room, status: 'free' }));
    const result = {
      date, campus: { code: campus.code, name: campus.name },
      building: selectedBuilding ? (buildings[0] || null) : null,
      startSection, endSection, rooms: free, total: free.length,
      available: free.length, occupied: null, queriedBuildings: buildings.length, errors, codes
    };
    if (String(request.status || 'free') === 'all') {
      const inventoryRows = [];
      for (let index = 0; index < buildings.length; index += 5) {
        const batch = buildings.slice(index, index + 5);
        const results = await Promise.all(batch.map(building => classroomQuery(campus.code, building.code, date, 0, 0)
          .then(rows => ({ rows }))
          .catch(error => ({ rows: [], error }))));
        results.forEach((result, offset) => {
          if (result.error) errors.push(`${batch[offset].name}：全楼名录${textValue(result.error.message || result.error)}`);
          inventoryRows.push(...result.rows);
        });
      }
      const freeKeys = new Set(free.map(room => `${room.buildingName}|${room.name}`));
      const inventory = new Map();
      for (const room of inventoryRows) inventory.set(`${room.buildingName}|${room.name}`, room);
      const occupied = [...inventory.values()].filter(room => !freeKeys.has(`${room.buildingName}|${room.name}`))
        .map(room => ({ ...room, status: 'occupied' }));
      result.rooms = [...free, ...occupied];
      result.total = result.rooms.length;
      result.available = free.length;
      result.occupied = occupied.length;
    }
    return result;
  }

  function sessionToken() {
    const keys = ['idToken', 'id_token', 'access_token', 'token', 'X-Id-Token'];
    for (const key of keys) {
      const value = textValue(localStorage.getItem(key) || sessionStorage.getItem(key));
      if (value) return value;
    }
    return '';
  }

  function normalizeMenu(payload) {
    const result = [];
    const seen = new Set();
    const walk = value => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== 'object') return;
      const name = pick(value, ['name', 'title', 'serviceName', 'appName', 'label']);
      const url = pick(value, ['url', 'link', 'serviceUrl', 'appUrl', 'redirectUrl', 'h5Url']);
      if (name && url && /^https?:\/\//i.test(url) && !seen.has(url)) {
        seen.add(url);
        result.push({ name, url, category: pick(value, ['categoryName', 'typeName', 'groupName']) || '校园服务' });
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(payload);
    return result.slice(0, 200);
  }

  async function portalMenu() {
    if (location.hostname !== 'ywtb.xjtu.edu.cn') throw new Error('请打开一网通办页面');
    const token = sessionToken();
    const headers = token ? { 'X-Id-Token': token } : {};
    const results = await Promise.allSettled([
      api('/portal-api/api/open/app/menu', { headers }),
      api('/portal-api/v1/config/getDetail', { headers }),
      api('/portal-api/v1/config/system/getAppSystemConf', { headers }),
      api('/portal-api/v1/service/list', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}'
      })
    ]);
    const payloads = results.filter(item => item.status === 'fulfilled').map(item => item.value);
    if (!payloads.length) throw new Error('当前一网通办页面无法读取门户菜单');
    return { menus: normalizeMenu(payloads), sources: payloads.length };
  }

  function listFrom(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.list)) return value.list;
    if (Array.isArray(value?.rows)) return value.rows;
    if (Array.isArray(value?.records)) return value.records;
    if (Array.isArray(value?.items)) return value.items;
    return [];
  }

  async function personalDigest() {
    if (location.hostname !== 'ywtb.xjtu.edu.cn') throw new Error('请打开一网通办页面');
    const headers = sessionToken() ? { 'X-Id-Token': sessionToken() } : {};
    const results = await Promise.allSettled([
      api('/portal-api/v2/personalData/getMyBooks', { headers }),
      api('/portal-api/v2/personalData/getMailbox', { headers }),
      api('/portal-api/v1/intranet/getDetail', { headers })
    ]);
    const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
    const bookData = value(0)?.data ?? value(0) ?? {};
    const mailboxData = value(1)?.data ?? value(1) ?? {};
    const intranetData = value(2)?.data ?? value(2) ?? {};
    const books = listFrom(bookData).map(item => ({
      title: pick(item, ['bookName', 'title', 'name', 'book_title']),
      author: pick(item, ['author', 'authorName']),
      dueDate: pick(item, ['returnDate', 'dueDate', 'endDate', 'shouldReturnDate']),
      status: pick(item, ['status', 'state'])
    })).filter(item => item.title);
    return {
      books,
      unreadMail: Number(mailboxData.mailboxUnreadSum ?? mailboxData.unreadCount ?? mailboxData.count ?? 0) || 0,
      network: { enableVpn: Boolean(intranetData.enableVpn ?? intranetData.enableVPN), autoConnectAtLogin: Boolean(intranetData.autoConnectAtLogin), autoConnectAtIntranet: Boolean(intranetData.autoConnectAtIntranet) },
      errors: results.map(item => item.status === 'rejected' ? textValue(item.reason?.message || '部分数据读取失败') : '').filter(Boolean),
      fetchedAt: new Date().toISOString()
    };
  }

  async function loginStatus() {
    try {
      if (location.hostname === 'jwxt.xjtu.edu.cn') {
        await api('/jwapp/sys/homeapp/api/home/currentUser.do');
        return { site: 'jwxt', loggedIn: true };
      }
      if (location.hostname === 'ywtb.xjtu.edu.cn') {
        await api('/portal-api/api/open/app/menu', { headers: sessionToken() ? { 'X-Id-Token': sessionToken() } : {} });
        return { site: 'ywtb', loggedIn: true };
      }
    } catch {}
    return { site: location.hostname, loggedIn: false };
  }

  function overview() {
    if (location.hostname === 'jwxt.xjtu.edu.cn') return jwxtOverview();
    if (location.hostname === 'ywtb.xjtu.edu.cn') return ywtbOverview();
    throw new Error('请打开教务系统或一网通办页面');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!['CAMPUS_GET_OVERVIEW', 'CAMPUS_GET_PORTAL', 'CAMPUS_GET_STATUS', 'CAMPUS_GET_CLASSROOM_CODES', 'CAMPUS_GET_CLASSROOMS', 'CAMPUS_GET_TOKEN', 'CAMPUS_GET_PERSONAL_DIGEST'].includes(message?.type)) return false;
    if (message.type === 'CAMPUS_GET_TOKEN') {
      sendResponse({ ok: true, token: sessionToken() });
      return false;
    }
    const request = message.type === 'CAMPUS_GET_PORTAL' ? portalMenu()
      : message.type === 'CAMPUS_GET_PERSONAL_DIGEST' ? personalDigest()
      : message.type === 'CAMPUS_GET_STATUS' ? loginStatus()
        : message.type === 'CAMPUS_GET_CLASSROOM_CODES' ? classroomCodes()
        : message.type === 'CAMPUS_GET_CLASSROOMS' ? classrooms(message.query || {}) : overview();
    request.then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: textValue(error?.message || error) }));
    return true;
  });
})();
