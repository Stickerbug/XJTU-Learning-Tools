(() => {
  'use strict';

  const textValue = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  let businessToken = '';
  let businessTokenPromise = null;

  function storedBusinessToken() {
    for (const key of ['X-Business-Token', 'businessToken', 'business_token']) {
      const value = textValue(localStorage.getItem(key) || sessionStorage.getItem(key));
      if (value) return value;
    }
    return '';
  }

  async function exchangeBusinessToken() {
    const params = new URL(location.href).searchParams;
    const loginRequestId = params.get('loginRequestId');
    const ticket = params.get('ticket');
    if (!loginRequestId || !ticket) return '';
    const response = await fetch('/sa/auth/cas/exchange', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ loginRequestId, ticket })
    });
    if (!response.ok) throw new Error('统一认证回调未完成，无法建立考勤会话');
    const payload = await response.json();
    if (Number(payload?.code) !== 0 || !payload?.data?.tokenValue) {
      throw new Error(payload?.message || '考勤业务会话建立失败');
    }
    businessToken = String(payload.data.tokenValue);
    return businessToken;
  }

  async function getBusinessToken() {
    businessToken ||= storedBusinessToken();
    if (businessToken) return businessToken;
    if (!businessTokenPromise) businessTokenPromise = exchangeBusinessToken().finally(() => { businessTokenPromise = null; });
    return businessTokenPromise;
  }

  async function api(path, options = {}) {
    const token = await getBusinessToken();
    const headers = { ...(options.headers || {}) };
    if (token) headers['X-Business-Token'] = token;
    const response = await fetch(path, { credentials: 'include', ...options, headers });
    const type = response.headers.get('content-type') || '';
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('考勤系统登录状态已失效');
      throw new Error(`考勤接口请求失败（${response.status}）`);
    }
    if (!type.includes('json')) throw new Error('当前考勤页面尚未完成登录');
    const payload = await response.json();
    if (payload?.code != null && Number(payload.code) !== 0) {
      if ([401, 403].includes(Number(payload.code)) || /token|登录|认证/i.test(String(payload.message || ''))) {
        throw new Error('考勤业务会话已失效，请从统一认证重新打开考勤页面');
      }
      throw new Error(payload.message || '考勤接口返回失败');
    }
    return payload?.data ?? payload;
  }

  function rowsFrom(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.rows)) return value.rows;
    if (Array.isArray(value?.list)) return value.list;
    if (Array.isArray(value?.records)) return value.records;
    if (Array.isArray(value?.semesters)) return value.semesters;
    return [];
  }

  function normalizeSemester(row) {
    const academicYear = textValue(row?.academicYear || row?.academic_year);
    const semesterName = textValue(row?.semesterName || row?.semester_name);
    return {
      id: textValue(row?.semesterId || row?.semester_id || row?.id),
      name: academicYear && semesterName ? `${academicYear}-${semesterName}` : textValue(row?.name || row?.termName),
      startDate: textValue(row?.startDate || row?.start_date),
      endDate: textValue(row?.endDate || row?.end_date)
    };
  }

  function normalizeRecord(row) {
    return {
      id: textValue(row?.resultId || row?.id),
      date: textValue(row?.attendanceDate || row?.date),
      course: textValue(row?.courseName || row?.course_name || row?.course),
      teacher: textValue(row?.teacherName || row?.teacher_name || row?.teacher),
      classroom: textValue(row?.classroomName || row?.classroom_name || row?.classroom),
      week: row?.courseWeek ?? row?.week ?? '',
      startSection: row?.startSection ?? row?.start_section ?? '',
      endSection: row?.endSection ?? row?.end_section ?? '',
      status: textValue(row?.attendanceStatus || row?.status).toUpperCase(),
      semesterId: textValue(row?.semesterId || row?.semester_id)
    };
  }

  async function getOverview() {
    const semesterPayload = await api('/sa/student/service/timetable/semesters');
    const semesters = rowsFrom(semesterPayload).map(normalizeSemester).filter(item => item.id || item.name);
    const current = semesters[0] || {};
    if (!current.startDate || !current.endDate) throw new Error('考勤系统未返回当前学期日期');
    const records = [];
    const pageSize = 500;
    let pageNum = 1;
    let total = Infinity;
    while (records.length < total && pageNum <= 20) {
      const payload = await api('/sa/student/pc/attendance-records/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-System': 'WEB' },
        body: JSON.stringify({ pageNum, pageSize, data: {
          startDate: current.startDate,
          endDate: current.endDate,
          semesterId: current.id,
          courseName: '',
          courseCode: '',
          attendanceStatus: ''
        } })
      });
      const rows = rowsFrom(payload);
      records.push(...rows.map(normalizeRecord));
      const reportedTotal = Number(payload?.total ?? payload?.totalCount ?? payload?.total_count);
      total = Number.isFinite(reportedTotal) && reportedTotal >= 0 ? reportedTotal : records.length;
      if (!rows.length) break;
      pageNum += 1;
      if (rows.length < pageSize) break;
    }
    return { semesters, currentSemester: current, records: records.slice(0, 2000) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ATTENDANCE_GET_OVERVIEW') return false;
    getOverview().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || '读取考勤失败' }));
    return true;
  });
})();
