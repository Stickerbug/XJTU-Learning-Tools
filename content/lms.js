(() => {
  'use strict';

  const messageError = error => String(error?.message || error || '未知错误')
    .replace(/([?&](?:token|previewToken|X-Amz-Signature|X-Amz-Credential)=)[^&\s]+/gi, '$1[已隐藏]')
    .slice(0, 300);

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, credentials: 'include' });
    if (response.status === 401) throw new Error('登录状态已失效，请重新登录思源学堂');
    if (response.status === 403) throw new Error('当前账号无权读取该课程资源');
    if (!response.ok) throw new Error(`课程接口请求失败（${response.status}）`);
    return response.json();
  }

  function context() {
    const course = location.pathname.match(/\/course\/(\d+)\/learning-activity(?:\/|$)/);
    const activity = location.hash.match(/^#\/(\d+)(?:[/?]|$)/);
    return {
      kind: activity ? 'activity' : course ? 'course' : 'lms',
      courseId: course ? Number(course[1]) : null,
      activityId: activity ? Number(activity[1]) : null,
      url: location.href
    };
  }

  async function activityContext(courseId, activityId) {
    const [activity, course] = await Promise.all([
      api(`/api/activities/${activityId}?sub_course_id=0`),
      api(`/api/courses/${courseId}`)
    ]);
    return { context: context(), activity, course };
  }

  async function myCourses() {
    try {
      return await api('/api/my-courses');
    } catch {
      return api('/api/my-courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    }
  }

  let cachedUserId = null;
  async function userId() {
    if (cachedUserId) return cachedUserId;
    const response = await fetch('/user/index', { credentials: 'include' });
    const html = await response.text();
    const userBlock = html.match(/user\s*:\s*\{([\s\S]*?)\}\s*,\s*dept\s*:/)?.[1] || '';
    const id = Number(userBlock.match(/["']?id["']?\s*:\s*["']?(\d+)/)?.[1]);
    if (!id) throw new Error('无法识别当前思源学堂用户');
    cachedUserId = id;
    return id;
  }

  async function submissionList(activity) {
    if (activity.type !== 'homework') return null;
    const hasSubmissions = Number(activity.user_submit_count || activity.submit_times || activity.data?.submit_times) > 0;
    if (!hasSubmissions && !activity.submit_by_group) return null;
    const url = activity.submit_by_group
      ? `/api/activities/${activity.id}/groups/${activity.group_id}/submission_list`
      : `/api/activities/${activity.id}/students/${await userId()}/submission_list`;
    if (activity.submit_by_group && !activity.group_id) return null;
    const data = await api(url);
    for (const submission of data.list || []) {
      if (!(submission.uploads || []).length) continue;
      try {
        const marked = await api(`/api/submissions/${submission.id}/marked_attachments`);
        submission.marked_rules = marked.rules || [];
      } catch {
        submission.marked_rules = [];
      }
    }
    return data;
  }

  async function scanCourses() {
    const payload = await myCourses();
    const courses = payload.courses || [];
    const results = [];
    for (let index = 0; index < courses.length; index += 1) {
      const course = courses[index];
      chrome.runtime.sendMessage({
        type: 'SCAN_PROGRESS',
        done: index,
        total: courses.length,
        courseName: course.name
      }).catch(() => {});
      const activitiesPayload = await api(`/api/courses/${course.id}/activities?sub_course_id=0`);
      const activities = activitiesPayload.activities || [];
      const details = {};
      let bulletins = [];
      try {
        const bulletinPayload = await api(`/api/courses/${course.id}/bulletins`);
        bulletins = bulletinPayload.bulletins || [];
      } catch {}
      const candidates = activities.filter(activity =>
        ['material', 'homework', 'lecture_live', 'courseware', 'interaction', 'online_video'].includes(activity.type) ||
        (activity.uploads || []).length > 0
      );
      for (const brief of candidates) {
        const activity = await api(`/api/activities/${brief.id}?sub_course_id=0`);
        let references = [];
        let submissions = null;
        try {
          const referencePayload = await api(`/api/activities/${brief.id}/upload_references`);
          references = referencePayload.references || [];
        } catch {}
        try {
          submissions = await submissionList(activity);
        } catch {}
        details[brief.id] = { activity, references, submissions };
      }
      results.push({ course, activities, details, bulletins });
    }
    let todos = null;
    try {
      todos = await api('/api/todos?no-intercept=true');
    } catch {}
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', done: courses.length, total: courses.length }).catch(() => {});
    return { courses: results, todos };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith('LMS_')) return false;
    (async () => {
      switch (message.type) {
        case 'LMS_PING':
          return { ok: true, context: context() };
        case 'LMS_GET_ACTIVITY':
          return { ok: true, ...(await activityContext(message.courseId, message.activityId)) };
        case 'LMS_GET_PLAYER_URL': {
          const payload = await api(`/api/lessons/${message.activityId}/player-url?from_page=course`);
          if (!payload.url) throw new Error('未获得回放播放器地址');
          return { ok: true, url: payload.url };
        }
        case 'LMS_GET_MARKED':
          return { ok: true, data: await api(`/api/submissions/${message.submissionId}/marked_attachments`) };
        case 'LMS_SCAN_COURSES':
          return { ok: true, ...(await scanCourses()) };
        default:
          throw new Error('不支持的页面请求');
      }
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: messageError(error) }));
    return true;
  });
})();
