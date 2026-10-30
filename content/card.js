(() => {
  'use strict';

  const textValue = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();

  async function jsonResponse(response, operation) {
    const body = await response.text();
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error('校园卡登录状态已失效');
      throw new Error(`${operation}请求失败（${response.status}）`);
    }
    if (body.includes('移动端模式')) throw new Error(`${operation}需要打开校园卡移动端页面`);
    try { return JSON.parse(body); } catch { throw new Error(`${operation}返回格式异常`); }
  }

  async function getJson(path, operation) {
    const response = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
    return jsonResponse(response, operation);
  }

  function requireSuccess(payload, operation) {
    if (payload?.code != null && !['200', 200, 0, '0'].includes(payload.code)) {
      throw new Error(payload.message || `${operation}失败`);
    }
    return payload?.data ?? payload;
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function localDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  async function getOverview() {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const query = new URLSearchParams({
      size: '50', current: '1', timeFrom: localDate(start), timeTo: localDate(end), synAccessSource: 'h5'
    });
    const [cardResult, turnoverResult] = await Promise.allSettled([
      getJson('/berserker-app/ykt/tsm/queryCard?synAccessSource=h5', '校园卡余额'),
      getJson(`/berserker-search/search/personal/turnover?${query}`, '校园卡流水')
    ]);
    if (cardResult.status === 'rejected' && turnoverResult.status === 'rejected') throw cardResult.reason;
    const cardData = cardResult.status === 'fulfilled' ? requireSuccess(cardResult.value, '校园卡余额') : {};
    const card = Array.isArray(cardData?.card) ? cardData.card[0] || {} : cardData?.card || cardData || {};
    const turnoverData = turnoverResult.status === 'fulfilled' ? requireSuccess(turnoverResult.value, '校园卡流水') : {};
    const records = Array.isArray(turnoverData?.records) ? turnoverData.records : [];
    return {
      card: cardResult.status === 'fulfilled' ? {
        balance: number(card.elec_accamt) / 100,
        pending: number(card.unsettle_amount) / 100,
        lost: card.barflag === 1 || card.barflag === '1',
        frozen: card.freezeflag === 1 || card.freezeflag === '1',
        expireDate: textValue(card.expdate),
        type: textValue(card.cardname)
      } : null,
      transactions: records.slice(0, 50).map(item => ({
        time: textValue(item.jndatetimeStr || item.tranTime || item.time),
        amount: number(item.tranamt) / 100,
        merchant: textValue(item.toMerchant || item.resume || '校园消费'),
        balance: number(item.cardBalance) / 100,
        type: textValue(item.turnoverType),
        description: textValue(item.resume)
      })),
      errors: [cardResult, turnoverResult].filter(item => item.status === 'rejected').map(item => item.reason?.message || '部分数据读取失败'),
      fetchedAt: new Date().toISOString()
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CARD_GET_OVERVIEW') return false;
    getOverview()
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message || '读取校园卡失败' }));
    return true;
  });
})();
