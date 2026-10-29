import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLmsUrl,
  parsePlayerUrl,
  safeFilePart,
  buildReplayFilename,
  selectVideos,
  summarizeCourse,
  parseMediaUrl,
  findEmbeddedMedia,
  findRichContentUploads,
  normalizeTodos,
  matchScore,
  assertDownloadUrl,
  cleanError
} from '../shared/core.js';

test('识别 LMS 课程与活动地址', () => {
  assert.deepEqual(
    parseLmsUrl('https://lms.xjtu.edu.cn/course/33122/learning-activity#/1299146'),
    { kind: 'activity', courseId: 33122, activityId: 1299146 }
  );
  assert.deepEqual(
    parseLmsUrl('https://lms.xjtu.edu.cn/course/33122/learning-activity'),
    { kind: 'course', courseId: 33122, activityId: null }
  );
  assert.equal(parseLmsUrl('https://example.com/course/33122/learning-activity#/1'), null);
});

test('从播放器地址提取回放标识和令牌', () => {
  const result = parsePlayerUrl('https://rms-v5.xjtu.edu.cn/embed/lms/lesson-activity/abc123/detail?token=test-value');
  assert.deepEqual(result, { replayCode: 'abc123', token: 'test-value' });
  assert.throws(() => parsePlayerUrl('https://rms-v5.xjtu.edu.cn/embed/other?token=x'));
});

test('文件名不会包含路径穿越或非法字符', () => {
  assert.equal(safeFilePart('../a/b:c*'), '.._a_b_c_');
  const name = buildReplayFilename({ root: '../../X', courseName: '化学/无机', activityTitle: '第 1 周', label: '课件画面' });
  assert.equal(name, '.._.._X/化学_无机/第 1 周_课件画面.mp4');
  assert.ok(!name.split('/').some(part => part === '..'));
});

test('按轨道 ID 或标签选择视频，不持久化地址', () => {
  const videos = [
    { id: 1, label: 'INSTRUCTOR', download_url: 'https://review-class.xjtu.edu.cn/a.mp4?X-Amz-Signature=x' },
    { id: 2, label: 'ENCODER', download_url: 'https://review-class.xjtu.edu.cn/b.mp4?X-Amz-Signature=y' }
  ];
  assert.equal(selectVideos(videos, null, 'ENCODER').id, 2);
  assert.equal(selectVideos(videos, 1, 'ENCODER').id, 1);
  assert.throws(() => selectVideos(videos, null, 'OTHER'));
});

test('课程清单只保留回放、资料和作业元数据', () => {
  const course = { id: 1, name: '课程', course_code: 'C1', semester: { real_name: '第1学期' } };
  const activities = [
    { id: 10, type: 'lesson', title: '回放', published: true, data: { duration: 50 }, lesson_resource: { size: 100, properties: { status: 'FINISHED' } } },
    { id: 11, type: 'material', title: '资料', published: true, uploads: [{ id: 20, name: '课件.pdf', size: 20, type: 'document', status: 'ready', allow_download: false }] },
    { id: 12, type: 'homework', title: '作业', published: true, end_time: '2026-11-01' },
    { id: 13, type: 'lesson', title: '未发布', published: false }
  ];
  const result = summarizeCourse(course, activities);
  assert.equal(result.replays.length, 1);
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].isPdf, true);
  assert.equal(result.homework.length, 1);
  assert.equal(JSON.stringify(result).includes('download_url'), false);
});

test('仅允许学校 HTTPS 下载地址', () => {
  assert.equal(assertDownloadUrl('https://media.xjtu.edu.cn/download/file/a?token=x'), 'https://media.xjtu.edu.cn/download/file/a?token=x');
  assert.throws(() => assertDownloadUrl('https://example.com/a.mp4'));
  assert.throws(() => assertDownloadUrl('http://media.xjtu.edu.cn/a.pdf'));
});

test('错误信息隐藏临时凭证', () => {
  const message = cleanError(new Error('failed ?token=secret&X-Amz-Signature=abc&x=1'));
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('abc'), false);
  assert.equal(message.includes('x=1'), true);
});

test('识别作业附件及上传引用，支持所有文件类型', () => {
  const course = { id: 43475, name: '交流与表达', course_code: 'E1' };
  const activities = [{ id: 1597298, type: 'homework', title: 'Lecture-2', published: true, uploads: [] }];
  const details = {
    1597298: {
      activity: { ...activities[0], uploads: [{ id: 7878878, reference_id: 3861914, key: '85308d8c', name: 'Keys.png', type: 'image', size: 140072, status: 'ready', allow_download: true }] },
      references: []
    }
  };
  const result = summarizeCourse(course, activities, details);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].kind, 'upload');
  assert.equal(result.resources[0].source, '作业附件');
  assert.equal(result.resources[0].referenceId, 3861914);
  assert.equal(JSON.stringify(result).includes('token='), false);
});

test('从活动 HTML 提取嵌入媒体但不保存临时 URL', () => {
  const activity = {
    data: { description: '<img src="https://media.xjtu.edu.cn/download/file/85308d8c?timestamp=1&token=secret&name=Keys.png">' }
  };
  const media = findEmbeddedMedia(activity);
  assert.equal(media.length, 1);
  assert.equal(media[0].fileKey, '85308d8c');
  assert.equal(media[0].name, 'Keys.png');
  const course = { id: 1, name: '课程' };
  const result = summarizeCourse(course, [{ id: 2, type: 'homework', title: '作业', published: true }], { 2: { activity: { id: 2, type: 'homework', title: '作业', data: activity.data }, references: [] } });
  assert.equal(result.resources[0].kind, 'embedded');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('媒体直链保留文件密钥和文件名', () => {
  const parsed = parseMediaUrl('https://media.xjtu.edu.cn/download/file/85308d8c?timestamp=1&token=secret&name=Keys%20Chapter.png');
  assert.equal(parsed.fileKey, '85308d8c');
  assert.equal(parsed.name, 'Keys Chapter.png');
  assert.equal(assertDownloadUrl('https://lms.xjtu.edu.cn/api/uploads/reference/3861914/blob'), 'https://lms.xjtu.edu.cn/api/uploads/reference/3861914/blob');
});

test('直播活动可生成 RMS 或直接视频回放资源', () => {
  const course = { id: 1, name: '课程' };
  const activities = [{ id: 20, type: 'lecture_live', title: '直播', published: true }];
  const details = { 20: { activity: { ...activities[0], data: { external_live_detail: { replay_id: 'abc', replay_videos: [{ size: 100 }] } } }, references: [] } };
  const result = summarizeCourse(course, activities, details);
  assert.equal(result.resources[0].kind, 'replay');
  assert.equal(result.resources[0].replayCode, 'abc');
  assert.equal(result.resources[0].size, 100);
});

test('公告、提交、批阅与批注均按来源保存元数据', () => {
  const course = { id: 1, name: '课程' };
  const homework = { id: 2, type: 'homework', title: '作业', published: true };
  const upload = { id: 30, reference_id: 40, key: 'k', name: '提交.docx', type: 'document', size: 10 };
  const details = { 2: { activity: homework, references: [], submissions: { list: [{ id: 50, uploads: [upload], submission_correct: { uploads: [] }, marked_rules: [{ origin_upload_name: '提交.docx', marked_attachment_url: 'https://media.xjtu.edu.cn/download/file/k?token=secret' }] }] } } };
  const bulletins = [{ id: 60, title: '公告', uploads: [upload], content: '' }];
  const result = summarizeCourse(course, [homework], details, { bulletins });
  assert.ok(result.resources.some(item => item.source === '我的提交'));
  assert.ok(result.resources.some(item => item.source === '批注附件'));
  assert.ok(result.resources.some(item => item.source === '公告附件'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('待办与富文本图片解析不包含临时地址', () => {
  const todos = normalizeTodos({ todo_list: [{ id: 1, type: 'exam', course_id: 2, course_name: '课程', title: '测试', end_time: '2026-11-01' }] });
  assert.equal(todos[0].courseId, 2);
  const images = findRichContentUploads({ data: { content: '<img src="https://lms.xjtu.edu.cn:443/api/uploads/123/in-rich-content?created_at=x">' } });
  assert.deepEqual(images, [{ uploadId: 123, name: '正文图片_123.png' }]);
});

test('搜索支持前缀、子串和紧凑汉字子序列', () => {
  assert.equal(matchScore('高数', '高等数学复习资料'), 60);
  assert.equal(matchScore('复习', '高等数学复习资料'), 80);
  assert.equal(matchScore('高等', '高等数学'), 100);
  assert.equal(matchScore('高数', '高等数学'), 60);
});
