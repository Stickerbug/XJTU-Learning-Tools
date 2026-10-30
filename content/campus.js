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
    const response = await fetch(path, { credentials: 'include', ...options });
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

  function overview() {
    if (location.hostname === 'jwxt.xjtu.edu.cn') return jwxtOverview();
    if (location.hostname === 'ywtb.xjtu.edu.cn') return ywtbOverview();
    throw new Error('请打开教务系统或一网通办页面');
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CAMPUS_GET_OVERVIEW') return false;
    overview().then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: textValue(error?.message || error) }));
    return true;
  });
})();
