export const TRACKS = Object.freeze({
  ENCODER: { label: 'ENCODER', name: '课件画面' },
  INSTRUCTOR: { label: 'INSTRUCTOR', name: '教师画面' }
});

export const RESOURCE_SOURCES = Object.freeze({
  replay: '课程回放',
  material: '课件附件',
  homework: '作业附件',
  bulletin: '公告附件',
  submission: '我的提交',
  correct: '批阅附件',
  marked: '批注附件',
  embedded: '页面嵌入文件',
  direct: '媒体直链'
});

export function parseLmsUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'lms.xjtu.edu.cn') return null;
    const course = url.pathname.match(/\/course\/(\d+)\/learning-activity(?:\/|$)/);
    const activity = url.hash.match(/^#\/(\d+)(?:[/?]|$)/);
    if (!course) return { kind: 'lms', courseId: null, activityId: null };
    return {
      kind: activity ? 'activity' : 'course',
      courseId: Number(course[1]),
      activityId: activity ? Number(activity[1]) : null
    };
  } catch {
    return null;
  }
}

export function parsePlayerUrl(value) {
  const url = new URL(value);
  if (url.hostname !== 'rms-v5.xjtu.edu.cn') throw new Error('播放器地址不属于学校资源平台');
  const match = url.pathname.match(/\/lesson-activity\/([a-f0-9]+)\/detail/i);
  const token = url.searchParams.get('token');
  if (!match || !token) throw new Error('播放器地址缺少回放标识或临时令牌');
  return { replayCode: match[1], token };
}

export function safeFilePart(value, fallback = '未命名') {
  const cleaned = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 120);
}

export function buildReplayFilename({ root = 'XJTU', courseName, activityTitle, label }) {
  return [
    safeFilePart(root, 'XJTU'),
    safeFilePart(courseName, '未知课程'),
    `${safeFilePart(activityTitle, '课程回放')}_${safeFilePart(label, '视频')}.mp4`
  ].join('/');
}

export function buildUploadFilename({ root = 'XJTU', courseName, uploadName, source = '课件附件', activityTitle = '' }) {
  const prefix = safeFilePart(activityTitle, '');
  const name = safeFilePart(uploadName, '课程资料');
  return [
    safeFilePart(root, 'XJTU'),
    safeFilePart(courseName, '未知课程'),
    safeFilePart(source, '课程资料'),
    prefix && !name.startsWith(prefix) ? `${prefix}_${name}` : name
  ].join('/');
}

export function selectVideos(videos, trackId, label) {
  const match = videos.find(video => Number(video.id) === Number(trackId)) ||
    videos.find(video => video.label === label);
  if (!match) throw new Error('未找到所选视频轨道');
  if (!match.download_url) throw new Error('该轨道暂未提供可保存的文件地址');
  return match;
}

export function parseMediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'media.xjtu.edu.cn' || !url.pathname.startsWith('/download/file/')) {
    throw new Error('仅支持学校媒体文件直链');
  }
  const key = url.pathname.split('/').filter(Boolean).pop();
  if (!key) throw new Error('媒体直链缺少文件标识');
  return { url: url.href, fileKey: key, name: url.searchParams.get('name') || key };
}

function walkStrings(value, visit) {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.forEach(item => walkStrings(item, visit));
  if (value && typeof value === 'object') Object.values(value).forEach(item => walkStrings(item, visit));
}

export function findEmbeddedMedia(activity) {
  const found = [];
  const seen = new Set();
  walkStrings(activity?.data || activity?.content || {}, text => {
    const matches = text.replace(/&amp;/g, '&').match(/https?:\/\/media\.xjtu\.edu\.cn\/download\/file\/[a-f0-9]+(?:\?[^\s"'<>]*)?/gi) || [];
    for (const raw of matches) {
      try {
        const cleaned = raw.replace(/[)\]]+$/g, '');
        const item = parseMediaUrl(cleaned);
        if (seen.has(item.fileKey)) continue;
        seen.add(item.fileKey);
        found.push(item);
      } catch {}
    }
  });
  return found;
}

export function findRichContentUploads(activity) {
  const found = [];
  const seen = new Set();
  walkStrings(activity?.data || activity?.content || {}, text => {
    const matches = text.match(/(?:https?:\/\/lms\.xjtu\.edu\.cn(?::443)?)?\/api\/uploads\/(\d+)\/in-rich-content(?:\?[^\s"'<>]*)?/gi) || [];
    for (const raw of matches) {
      const id = Number(raw.match(/\/api\/uploads\/(\d+)\//)?.[1]);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push({ uploadId: id, name: `正文图片_${id}.png` });
    }
  });
  return found;
}

function baseResource(course, activity, kind, source) {
  return {
    courseId: course.id,
    courseName: course.name,
    activityId: activity.id,
    activityTitle: activity.title,
    activityType: activity.type || null,
    moduleId: activity.module_id || null,
    startTime: activity.start_time || activity.created_at || null,
    endTime: activity.end_time || null,
    dueAt: activity.type === 'homework' ? activity.deadline || activity.end_time || null : null,
    kind,
    source
  };
}

function uploadResource(course, activity, upload, referenceId = null, override = {}) {
  const source = override.source || (activity.type === 'homework' ? RESOURCE_SOURCES.homework : RESOURCE_SOURCES.material);
  return {
    ...baseResource(course, activity, override.kind || 'upload', source),
    key: override.key || `upload:${activity.id}:${upload.id}`,
    name: override.name || upload.name,
    uploadId: upload.id,
    referenceId: upload.reference_id || referenceId || null,
    fileKey: upload.key || null,
    size: upload.size || null,
    status: upload.status || 'ready',
    allowDownload: upload.allow_download,
    fileType: upload.type || 'file',
    ...override.extra
  };
}

function replayResource(course, activity, replay = {}) {
  return {
    ...baseResource(course, activity, 'replay', RESOURCE_SOURCES.replay),
    key: `replay:${activity.id}`,
    name: activity.title,
    title: activity.title,
    duration: replay.duration || activity.data?.duration || null,
    size: replay.size || null,
    status: replay.status || 'FINISHED',
    replayCode: replay.replayCode || null,
    liveDirect: Boolean(replay.liveDirect)
  };
}

function addEmbeddedResources(course, activity, resources) {
  for (const media of findEmbeddedMedia(activity)) {
    resources.push({
      ...baseResource(course, activity, 'embedded', RESOURCE_SOURCES.embedded),
      key: `embedded:${activity.id}:${media.fileKey}`,
      name: media.name,
      fileKey: media.fileKey,
      size: null,
      status: 'ready',
      fileType: 'embedded'
    });
  }
  for (const image of findRichContentUploads(activity)) {
    resources.push({
      ...baseResource(course, activity, 'upload', RESOURCE_SOURCES.embedded),
      key: `rich:${activity.id}:${image.uploadId}`,
      name: image.name,
      uploadId: image.uploadId,
      referenceId: null,
      fileKey: null,
      size: null,
      status: 'ready',
      fileType: 'image'
    });
  }
}

export function normalizeMarkedRules(payload) {
  const normalized = [];
  const addRule = (name, url) => {
    if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim()) return;
    normalized.push({ origin_upload_name: name.trim(), url: url.trim() });
  };
  for (const rule of Array.isArray(payload?.rules) ? payload.rules : []) {
    if (!rule || typeof rule !== 'object') continue;
    addRule(
      rule.origin_upload_name || rule.origin_name || rule.name,
      rule.marked_attachment_url || rule.attachment_url || rule.url
    );
  }
  if (normalized.length) return normalized;

  const entries = [];
  if (Array.isArray(payload)) entries.push(...payload);
  if (payload && typeof payload === 'object') {
    for (const key of ['marked_attachment_infos', 'marked_attachments', 'attachments', 'items', 'list', 'data', 'records', 'results']) {
      if (Array.isArray(payload[key])) entries.push(...payload[key]);
    }
  }
  for (const info of entries) {
    if (!info || typeof info !== 'object') continue;
    const origins = [
      info.origin_upload, info.originUpload, info.origin_attachment, info.originAttachment,
      info.upload, info.source_upload, info.sourceUpload, info.attachment, info.origin, info.source
    ].filter(value => value && typeof value === 'object');
    const originCandidates = origins.flatMap(value => value.upload && typeof value.upload === 'object' ? [value.upload, value] : [value]);
    const origin = originCandidates.find(value => typeof value.name === 'string' && value.name.trim());
    const markedCandidates = [info.marked_attachment, info.markedAttachment, info.marked_upload, info.markedUpload, info.attachment, info]
      .filter(value => value && typeof value === 'object');
    let url = null;
    for (const candidate of markedCandidates) {
      for (const key of ['url', 'download_url', 'preview_url', 'attachment_url', 'signed_url', 'file_url', 'blob_url', 'href', 'link']) {
        if (typeof candidate[key] === 'string' && candidate[key].trim()) {
          url = candidate[key];
          break;
        }
      }
      if (url) break;
    }
    addRule(origin?.name, url);
  }
  return normalized;
}

function addSubmissionResources(course, activity, submissionData, resources) {
  if (!submissionData) return;
  const addUploads = (uploads, source, submissionId) => {
    for (const upload of uploads || []) {
      resources.push(uploadResource(course, activity, upload, upload.reference_id, {
        source,
        key: `upload:${source}:${submissionId}:${upload.id}`,
        extra: { submissionId }
      }));
    }
  };
  for (const submission of submissionData.list || []) {
    addUploads(submission.uploads, RESOURCE_SOURCES.submission, submission.id);
    addUploads(submission.submission_correct?.uploads, RESOURCE_SOURCES.correct, submission.id);
    const markedPayload = submission.marked_payload || { rules: submission.marked_rules || [] };
    for (const rule of normalizeMarkedRules(markedPayload)) {
      const originName = rule.origin_upload_name;
      resources.push({
        ...baseResource(course, activity, 'marked', RESOURCE_SOURCES.marked),
        key: `marked:${submission.id}:${originName}`,
        name: `${originName}（批注）`,
        submissionId: submission.id,
        originUploadName: originName,
        size: null,
        status: 'ready',
        fileType: 'marked'
      });
    }
  }
  addUploads(submissionData.uploads, RESOURCE_SOURCES.submission, activity.id);
}

export function summarizeCourse(course, activities, activityDetails = {}, courseExtras = {}) {
  const published = activities.filter(item => item.published);
  const replays = published
    .filter(item => item.type === 'lesson' && item.lesson_resource)
    .map(item => ({
      activityId: item.id,
      courseId: course.id,
      courseName: course.name,
      title: item.title,
      startTime: item.start_time,
      endTime: item.end_time,
      duration: item.data?.duration || null,
      moduleId: item.module_id || null,
      size: item.lesson_resource.size || null,
      status: item.lesson_resource.properties?.status || 'UNKNOWN'
    }));
  const resources = replays.map(replay => replayResource(course, {
    id: replay.activityId,
    title: replay.title,
    type: 'lesson',
    module_id: replay.moduleId,
    start_time: replay.startTime,
    end_time: replay.endTime,
    data: { duration: replay.duration }
  }, replay));
  const uploadKeys = new Set();
  for (const brief of published) {
    const detail = activityDetails[brief.id]?.activity || brief;
    if (brief.type === 'lecture_live') {
      const external = detail.data?.external_live_detail || {};
      const directVideos = external.replay_videos || [];
      if (external.replay_id || directVideos.length) {
        resources.push(replayResource(course, detail, {
          replayCode: external.replay_id ? String(external.replay_id) : null,
          liveDirect: !external.replay_id && directVideos.length > 0,
          size: directVideos.reduce((sum, video) => sum + (Number(video.size) || 0), 0) || null,
          status: external.status || 'FINISHED'
        }));
      }
    }
    if (brief.type !== 'lesson') {
      const references = activityDetails[brief.id]?.references || [];
      const uploads = detail.uploads || brief.uploads || [];
      for (const upload of uploads) {
        const resource = uploadResource(course, detail, upload);
        resources.push(resource);
        uploadKeys.add(resource.key);
      }
      for (const reference of references) {
        if (!reference.upload) continue;
        const key = `upload:${detail.id}:${reference.upload.id}`;
        if (uploadKeys.has(key)) continue;
        const resource = uploadResource(course, detail, reference.upload, reference.id);
        resources.push(resource);
        uploadKeys.add(key);
      }
      addEmbeddedResources(course, detail, resources);
      addSubmissionResources(course, detail, activityDetails[brief.id]?.submissions, resources);
    }
  }
  for (const bulletin of courseExtras.bulletins || []) {
    const parent = { id: bulletin.id, title: bulletin.title, type: 'bulletin' };
    for (const upload of bulletin.uploads || []) {
      resources.push(uploadResource(course, parent, upload, upload.reference_id, {
        source: RESOURCE_SOURCES.bulletin,
        key: `upload:bulletin:${bulletin.id}:${upload.id}`,
        extra: { parentType: 'bulletin' }
      }));
    }
    addEmbeddedResources(course, { ...parent, content: bulletin.content }, resources);
  }
  const materials = resources.filter(item => item.kind === 'upload' && item.source === RESOURCE_SOURCES.material).map(item => ({
    activityId: item.activityId,
    courseId: item.courseId,
    courseName: item.courseName,
    activityTitle: item.activityTitle,
    uploadId: item.uploadId,
    referenceId: item.referenceId,
    name: item.name,
    size: item.size,
    status: item.status,
    allowDownload: item.allowDownload,
    isPdf: item.fileType === 'document' && /\.pdf$/i.test(item.name)
  }));
  const homework = published
    .filter(item => item.type === 'homework')
    .map(item => ({
      activityId: item.id,
      courseId: course.id,
      courseName: course.name,
      title: item.title,
      dueAt: item.deadline || item.end_time
    }));
  return {
    id: course.id,
    name: course.name,
    code: course.course_code,
    semester: course.semester?.real_name || course.semester?.name || '',
    replays,
    materials,
    homework,
    resources
  };
}

export function normalizeTodos(payload) {
  return (payload?.todo_list || []).map(item => ({
    id: item.id,
    type: item.type,
    courseId: item.course_id,
    courseName: item.course_name,
    title: item.title,
    dueAt: item.end_time || item.deadline || null
  }));
}

export function matchScore(query, name) {
  const q = String(query || '').trim().toLowerCase();
  const text = String(name || '').toLowerCase();
  if (!q) return 1;
  if (text.startsWith(q)) return 100;
  if (text.includes(q)) return 80;
  const compactQuery = q.replace(/\s+/g, '');
  if ((compactQuery.match(/[\u4e00-\u9fff]/g) || []).length < 2) return null;
  const positions = [];
  let index = 0;
  for (let i = 0; i < text.length && index < compactQuery.length; i += 1) {
    if (text[i] === compactQuery[index]) positions.push(i), index += 1;
  }
  if (index !== compactQuery.length) return null;
  const span = positions[positions.length - 1] - positions[0] + 1;
  return span <= positions.length * 2 ? 60 : null;
}

export function assertDownloadUrl(value) {
  const url = new URL(value);
  const allowed = new Set([
    'lms.xjtu.edu.cn',
    'review-class.xjtu.edu.cn',
    'media.xjtu.edu.cn',
    'rms-v5.xjtu.edu.cn',
    'zyxf.top'
  ]);
  if (url.protocol !== 'https:' || !allowed.has(url.hostname)) {
    throw new Error('拒绝使用非学校或学辅资源地址');
  }
  return url.href;
}

export function assertZyxfFileUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const allowed = hostname === 'zyxf.top' || hostname.endsWith('.zyxf.top') || hostname.endsWith('.aliyuncs.com');
  if (url.protocol !== 'https:' || !allowed) throw new Error('学辅返回了不受信任的文件地址');
  return url.href;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 100 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function cleanError(error) {
  return String(error?.message || error || '未知错误')
    .replace(/([?&](?:token|previewToken|X-Amz-Signature|X-Amz-Credential)=)[^&\s]+/gi, '$1[已隐藏]')
    .slice(0, 300);
}
