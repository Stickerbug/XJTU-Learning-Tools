(() => {
  'use strict';

  const FLOORS = new Map([
    ['xingqing2floor', { campus: '兴庆', name: '兴庆 · 2 层' }],
    ['xingqing3floor', { campus: '兴庆', name: '兴庆 · 3 层' }],
    ['xingqing4floor', { campus: '兴庆', name: '兴庆 · 4 层' }],
    ['inno1floor', { campus: '创新港', name: '创新港 · 1 层' }],
    ['inno2floor', { campus: '创新港', name: '创新港 · 2 层' }],
    ['yanta1floor', { campus: '雁塔', name: '雁塔 · 1 层' }],
    ['yanta2floor', { campus: '雁塔', name: '雁塔 · 2 层' }],
    ['yanta3floor', { campus: '雁塔', name: '雁塔 · 3 层' }],
    ['yanta4floor', { campus: '雁塔', name: '雁塔 · 4 层' }]
  ]);

  const textValue = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  const requestHeaders = {
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/javascript, */*; q=0.01'
  };

  async function jsonResponse(response) {
    const body = await response.text();
    const trimmed = body.trim();
    if (!response.ok) throw new Error(`图书馆接口请求失败（${response.status}）`);
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new Error('图书馆页面未登录，或当前网络需要先打开移动端座位页面');
    }
    try { return JSON.parse(trimmed); } catch { throw new Error('图书馆接口返回格式异常'); }
  }

  async function getJson(path) {
    const response = await fetch(path, { credentials: 'include', headers: requestHeaders });
    return jsonResponse(response);
  }

  function normalizeStats(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    const total = Number(value[0]);
    const free = Number(value[1]);
    if (!Number.isFinite(total) || !Number.isFinite(free)) return null;
    return { total: Math.max(0, total), free: Math.max(0, free) };
  }

  async function getFloor(floorCode) {
    const floor = FLOORS.get(String(floorCode || ''));
    if (!floor) throw new Error('无效的图书馆楼层');
    const space = await getJson(`/qspace?lang=zh&floor=${encodeURIComponent(floorCode)}`);
    const names = space?.sp && typeof space.sp === 'object' ? space.sp : {};
    const initialStats = space?.scount && typeof space.scount === 'object' ? space.scount : {};
    const areas = await Promise.all(Object.entries(names).map(async ([code, name]) => {
      const payload = await getJson(`/qseat?sp=${encodeURIComponent(code)}`);
      const stats = normalizeStats(payload?.scount?.[code]) || normalizeStats(initialStats[code]);
      const seats = Object.entries(payload?.seat || {}).map(([seatId, status]) => ({
        id: textValue(seatId), free: Number(status) === 0
      })).filter(item => item.id);
      const seatTotal = seats.length;
      return {
        code,
        name: textValue(name) || code,
        total: stats?.total ?? seatTotal,
        free: stats?.free ?? seats.filter(item => item.free).length,
        seats
      };
    }));
    areas.sort((a, b) => (b.free - a.free) || a.name.localeCompare(b.name, 'zh-CN'));
    return { floorCode, ...floor, areas, fetchedAt: new Date().toISOString() };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'LIBRARY_GET_FLOOR') return false;
    getFloor(message.floorCode)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message || '读取图书馆座位失败' }));
    return true;
  });
})();
