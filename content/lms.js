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

  // 分层限制并发，缩短全量扫描时间，同时避免瞬时打满 LMS 接口。
  const SCAN_COURSE_CONCURRENCY = 3;
  const SCAN_ACTIVITY_CONCURRENCY = 6;
  const SCAN_MARKED_CONCURRENCY = 3;

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const consume = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
    return results;
  }

  let cachedUserId = null;
  let userIdRequest = null;
  async function userId() {
    if (cachedUserId) return cachedUserId;
    if (!userIdRequest) {
      userIdRequest = (async () => {
        const response = await fetch('/user/index', { credentials: 'include' });
        const html = await response.text();
        const userBlock = html.match(/user\s*:\s*\{([\s\S]*?)\}\s*,\s*dept\s*:/)?.[1] || '';
        const id = Number(userBlock.match(/["']?id["']?\s*:\s*["']?(\d+)/)?.[1]);
        if (!id) throw new Error('无法识别当前思源学堂用户');
        cachedUserId = id;
        return id;
      })();
    }
    try {
      return await userIdRequest;
    } catch (error) {
      userIdRequest = null;
      throw error;
    }
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
    await mapLimit(data.list || [], SCAN_MARKED_CONCURRENCY, async submission => {
      if (!(submission.uploads || []).length) return;
      try {
        submission.marked_payload = await api(`/api/submissions/${submission.id}/marked_attachments`);
      } catch {
        submission.marked_payload = { rules: [] };
      }
    });
    return data;
  }

  async function scanCourses() {
    const payload = await myCourses();
    const courses = payload.courses || [];
    let completed = 0;
    const reportProgress = courseName => {
      chrome.runtime.sendMessage({
        type: 'SCAN_PROGRESS',
        done: completed,
        total: courses.length,
        courseName
      }).catch(() => {});
    };
    reportProgress('');
    // 待办与课程扫描互不依赖，提前并行请求。
    const todosRequest = api('/api/todos?no-intercept=true').catch(() => null);
    const results = await mapLimit(courses, SCAN_COURSE_CONCURRENCY, async course => {
      const [activitiesPayload, bulletins] = await Promise.all([
        api(`/api/courses/${course.id}/activities?sub_course_id=0`),
        api(`/api/courses/${course.id}/bulletins`)
          .then(payload => payload.bulletins || [])
          .catch(() => [])
      ]);
      const activities = activitiesPayload.activities || [];
      const candidates = activities.filter(activity =>
        ['material', 'homework', 'lecture_live', 'courseware', 'interaction', 'online_video'].includes(activity.type) ||
        (activity.uploads || []).length > 0
      );
      const entries = await mapLimit(candidates, SCAN_ACTIVITY_CONCURRENCY, async brief => {
        const detail = await api(`/api/activities/${brief.id}?sub_course_id=0`);
        // 详情接口可能省略 deadline 等列表字段，只补缺，不覆盖详情已有值。
        const activity = {
          ...brief,
          ...detail,
          start_time: detail.start_time || brief.start_time || null,
          end_time: detail.end_time || brief.end_time || null,
          deadline: detail.deadline || brief.deadline || null
        };
        const [references, submissions] = await Promise.all([
          api(`/api/activities/${brief.id}/upload_references`)
            .then(payload => payload.references || [])
            .catch(() => []),
          submissionList(activity).catch(() => null)
        ]);
        return [brief.id, { activity, references, submissions }];
      });
      completed += 1;
      reportProgress(course.name);
      return { course, activities, details: Object.fromEntries(entries), bulletins };
    });
    const todos = await todosRequest;
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', done: courses.length, total: courses.length }).catch(() => {});
    return { courses: results, todos };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith('LMS_')) return false;
    (async () => {
      switch (message.type) {
        case 'LMS_PING':
          return { ok: true, context: context() };
        case 'LMS_STATUS':
          {
            const response = await fetch('/user/index', { credentials: 'include' });
            const html = await response.text();
            if (!response.ok || !/user\s*:\s*\{/.test(html)) throw new Error('当前页面未登录');
            return { ok: true, loggedIn: true };
          }
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
