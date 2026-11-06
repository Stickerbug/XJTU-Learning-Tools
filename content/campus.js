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

  function normalizeSchedule(rows) {
    return rows.slice(0, 200).map(row => ({
      course: pick(row, ['KCM', 'KCMC', 'KCMX', 'courseName', 'course_name']),
      teacher: pick(row, ['SKJSCH', 'SKJS', 'JSXM', 'JS', 'teacherName', 'teacher_name']),
      classroom: pick(row, ['JASMC', 'JASMC_DISPLAY', '教室', 'classroom', 'roomName']),
      weekday: pick(row, ['SKXQ', 'XQJ', 'XQJMC', 'weekday', 'weekDay']),
      section: (() => {
        const start = pick(row, ['KSJC', 'JCD', 'JCDMC', 'section', 'period']);
        const end = pick(row, ['JSJC']);
        if (start && end && start !== end) return `${start}-${end}`;
        return start || end;
      })(),
      weeks: pick(row, ['ZCMC', 'ZC', 'SKZC', 'weeks', 'weekRange'])
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

  function normalizeSchoolCourse(row, fallbackTerm = '') {
    return {
      code: pick(row, ['KCH', 'courseCode', 'course_code']),
      name: pick(row, ['KCM', 'KCMC', 'courseName', 'course_name']),
      classCode: pick(row, ['KXH', 'classCode', 'class_code']),
      teachers: pick(row, ['SKJS', 'teachers', 'teacherName']),
      department: pick(row, ['KKDWDM_DISPLAY', 'department', 'deptName']),
      credit: pick(row, ['XF', 'credit', 'coursePoint']),
      hours: pick(row, ['XS', 'hours']),
      campus: pick(row, ['XXXQDM_DISPLAY', 'campus', 'campusName']),
      capacity: pick(row, ['KRL', 'capacity']),
      selected: pick(row, ['XKZRS', 'NSXKRS', 'selected']),
      timePlace: pick(row, ['YPSJDD', 'timePlace', 'time_place']),
      elective: pick(row, ['XGXKLBDM_DISPLAY', 'elective', 'electiveName']),
      term: pick(row, ['XNXQDM', 'XNXQDM_DISPLAY', 'termCode', 'termName']) || fallbackTerm
    };
  }

  async function schoolCourseMeta() {
    await ensureStudentRole();
    await fetch('/jwapp/sys/kcbcx/*default/index.do', { credentials: 'include', headers: { Accept: 'text/html' } });
    const [currentPayload, termPayload, departmentPayload] = await Promise.all([
      api('/jwapp/sys/kcbcx/modules/bjkcb/dqxnxq.do', { method: 'POST' }),
      api('/jwapp/sys/kcbcx/modules/bjkcb/xnxqcx.do', { method: 'POST', body: new URLSearchParams({ '*order': '-DM' }) }),
      api('/jwapp/code/44e02e19-e31b-4916-91b2-0a04380cbd3a.do', { method: 'POST' })
    ]);
    const currentRow = rowsFrom(currentPayload, ['datas.dqxnxq', 'data.dqxnxq', 'dqxnxq'])[0] || {};
    const currentTerm = pick(currentRow, ['DM', 'dm', 'termCode', 'XNXQDM']);
    const terms = rowsFrom(termPayload, ['datas.xnxqcx', 'data.xnxqcx', 'xnxqcx']).map(row => ({
      code: pick(row, ['DM', 'code', 'termCode']), name: pick(row, ['MC', 'name', 'termName']) || pick(row, ['DM', 'code'])
    })).filter(item => item.code);
    const departments = rowsFrom(departmentPayload, ['datas.code', 'data.code', 'code']).map(row => ({
      code: pick(row, ['id', 'code', 'value']), name: pick(row, ['name', 'text', 'label'])
    })).filter(item => item.code && item.name);
    return { currentTerm, terms, departments };
  }

  async function schoolCourses(request = {}) {
    if (location.hostname !== 'jwxt.xjtu.edu.cn') throw new Error('请打开教务系统页面');
    const meta = await schoolCourseMeta();
    const term = String(request.term || meta.currentTerm || meta.terms[0]?.code || '');
    if (request.metaOnly) return { ...meta, total: 0, courses: [] };
    const conditions = [
      { name: 'XNXQDM', value: term, linkOpt: 'and', builder: 'equal' },
      [
        { name: 'RWZTDM', value: '1', linkOpt: 'and', builder: 'equal' },
        { name: 'RWZTDM', linkOpt: 'or', builder: 'isNull' }
      ]
    ];
    const addCondition = (name, value, builder = 'include', builderList = 'cbl_String') => {
      if (!value) return;
      conditions.push({ name, caption: name, linkOpt: 'AND', builderList, builder, value });
    };
    addCondition('KCM', textValue(request.courseName));
    addCondition('KKDWDM', textValue(request.department), 'equal');
    addCondition('XXXQDM', textValue(request.campus), 'equal');
    addCondition('XGXKLBDM', textValue(request.elective), 'm_value_equal', 'cbl_m_List');
    const pageSize = Math.min(100, Math.max(1, Number(request.pageSize) || 30));
    const pageNumber = Math.max(1, Number(request.page) || 1);
    const payload = await api('/jwapp/sys/kcbcx/modules/qxkcb/qxfbkccx.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({
        querySetting: JSON.stringify(conditions),
        '*order': '+KKDWDM,+KCH,+KXH',
        SKXQ: textValue(request.weekday),
        KSJC: textValue(request.startSection),
        JSJC: textValue(request.endSection),
        pageSize: String(pageSize),
        pageNumber: String(pageNumber)
      })
    });
    const block = payload?.datas?.qxfbkccx || payload?.data?.qxfbkccx || payload?.qxfbkccx || {};
    const rows = rowsFrom(payload, ['datas.qxfbkccx', 'data.qxfbkccx', 'qxfbkccx']);
    return {
      ...meta,
      currentTerm: meta.currentTerm || term,
      term,
      total: Number(block.totalSize || block.total || rows.length) || rows.length,
      page: pageNumber,
      pageSize,
      courses: rows.map(row => normalizeSchoolCourse(row, term)).filter(item => item.name || item.code)
    };
  }

  async function jwxtOverview() {
    await ensureStudentRole();
    const termRequest = api('/jwapp/sys/wdkb/modules/jshkcb/dqxnxq.do', {
      method: 'POST',
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    const [termResult] = await Promise.allSettled([termRequest]);
    const termPayload = termResult.status === 'fulfilled' ? termResult.value : null;
    const termRow = rowsFrom(termPayload, ['datas.dqxnxq', 'data.dqxnxq', 'dqxnxq'])[0] || {};
    const term = pick(termRow, ['DM', 'dm', 'termCode', 'XNXQDM']) || pick(termPayload, ['xnxqdm', 'termCode']);
    const errors = [];
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
    const result = { site: 'jwxt', term, schedule: [], exams: [], grades: [], errors };
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
      try {
        await api('/jwapp/sys/jwpubapp/pub/setJwCommonAppRole.do', {
          method: 'POST', body: new URLSearchParams({ ROLEID: String(student.roleId) })
        });
      } catch {
        await api('/jwapp/sys/homeapp/api/home/changeAppRole.do', {
          method: 'POST', body: new URLSearchParams({ appRole: String(student.roleId) })
        });
      }
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
    })).filter(item => item.code && item.name).sort((a, b) => {
      const rank = campus => campus.code === '1' || /兴庆/.test(campus.name) ? 0 : 1;
      return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
    const buildings = codeRows(buildingPayload).map(row => ({
      code: pick(row, ['id', 'code', 'value']),
      name: pick(row, ['name', 'text', 'label']),
      campusCode: pick(row, ['XXXQDM', 'campusCode']) || pick(row?.otherFields, ['XXXQDM', 'campusCode']),
      campusName: pick(row, ['XXXQDM_DISPLAY', 'campusName']) || pick(row?.otherFields, ['XXXQDM_DISPLAY', 'campusName'])
    })).filter(item => item.code && item.name);
    classroomCodeCache = { campuses, buildings, updatedAt: Date.now() };
    return classroomCodeCache;
  }

  async function classroomQuery(campusCode, buildingCode, date, startSection, endSection) {
    const rows = [];
    const pageSize = 500;
    for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
      const payload = await api('/jwapp/sys/kxjas/modules/kxjscx/cxkxjs.do', {
        method: 'POST',
        body: new URLSearchParams({
          XXXQDM: campusCode || '', JXLDM: buildingCode || '', KXRQ: date,
          KSJC: String(startSection), JSJC: String(endSection), pageSize: String(pageSize), pageNumber: String(pageNumber)
        })
      });
      const root = payload?.datas?.cxkxjs || payload?.data?.cxkxjs || payload?.cxkxjs || {};
      const pageRows = rowsFrom(payload, ['datas.cxkxjs', 'data.cxkxjs', 'cxkxjs']);
      rows.push(...pageRows);
      const total = Number(root.totalSize || root.total || 0);
      if (!pageRows.length || (total && rows.length >= total) || pageRows.length < 15) break;
    }
    return normalizeRoomRows(rows, { campusCode });
  }

  async function classrooms(request = {}) {
    if (location.hostname !== 'jwxt.xjtu.edu.cn') throw new Error('请打开教务系统页面');
    await ensureStudentRole();
    const codes = await classroomCodes();
    const defaultCampus = codes.campuses.find(item => item.code === '1' || /兴庆/.test(item.name)) || codes.campuses[0];
    const campus = codes.campuses.find(item => item.code === String(request.campusCode || '')) || defaultCampus;
    if (!campus) throw new Error('未读取到校区列表');
    const selectedBuilding = String(request.buildingCode || '');
    const campusBuildings = codes.buildings.filter(item => !item.campusCode || item.campusCode === String(campus.code));
    const buildings = campusBuildings.filter(item => !selectedBuilding || item.code === selectedBuilding);
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
    if (!['CAMPUS_GET_OVERVIEW', 'CAMPUS_GET_PORTAL', 'CAMPUS_GET_STATUS', 'CAMPUS_GET_CLASSROOM_CODES', 'CAMPUS_GET_CLASSROOMS', 'CAMPUS_GET_SCHOOL_COURSES', 'CAMPUS_GET_TOKEN'].includes(message?.type)) return false;
    if (message.type === 'CAMPUS_GET_TOKEN') {
      sendResponse({ ok: true, token: sessionToken() });
      return false;
    }
    const request = message.type === 'CAMPUS_GET_PORTAL' ? portalMenu()
      : message.type === 'CAMPUS_GET_STATUS' ? loginStatus()
        : message.type === 'CAMPUS_GET_CLASSROOM_CODES' ? classroomCodes()
        : message.type === 'CAMPUS_GET_CLASSROOMS' ? classrooms(message.query || {})
          : message.type === 'CAMPUS_GET_SCHOOL_COURSES' ? schoolCourses(message.query || {}) : overview();
    request.then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: textValue(error?.message || error) }));
    return true;
  });
})();
