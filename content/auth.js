/*
 * 统一认证页的轻量桥接。
 *
 * 凭据只从后台临时传入登录页，不写入页面、扩展本地存储或日志。登录页
 * 仍由学校自己的表单负责加密密码、验证码和二次认证，扩展只负责填充并
 * 点击正常的登录按钮。
 */

(() => {
  const isVisible = element => {
    if (!element) return false;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD'].includes(element.tagName)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const textOf = element => String(element?.textContent || '').replace(/\s+/g, ' ').trim();

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function visibleInputs() {
    return [...document.querySelectorAll('input')].filter(isVisible);
  }

  function visibleLoginButton() {
    const candidates = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
      .filter(isVisible)
      .filter(element => /登录|login|sign\s*in/i.test(textOf(element) || element.value || element.getAttribute('aria-label') || ''));
    return candidates[0] || null;
  }

  function loginPageState() {
    const pageText = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const inputs = visibleInputs();
    const password = inputs.find(input => input.type === 'password');
    const username = inputs.find(input => input.type === 'text' && /学号|工号|账号|用户名|student|staff|phone|mobile|id/i.test(`${input.placeholder} ${input.getAttribute('aria-label') || ''}`))
      || inputs.find(input => input.type === 'text');
    const captchaImage = [...document.querySelectorAll('img')].some(image => isVisible(image) && /captcha|验证码/i.test(`${image.src} ${image.alt || ''}`));
    const captchaInput = inputs.some(input => /验证码|captcha/i.test(`${input.placeholder} ${input.name} ${input.id}`));
    const accountChoices = [...document.querySelectorAll('.account-wrap, [class*="account-choice"], [class*="accountChoice"]')].filter(isVisible).length > 0;
    const mfa = /Safety Verify|安全认证|二次认证|secure phone|安全验证/i.test(pageText);
    const errorElement = document.querySelector('#loginError1, [role="alert"], .el-message, .el-alert');
    const error = textOf(errorElement);
    return {
      kind: 'cas',
      ready: Boolean(username && password),
      needsCaptcha: captchaImage || captchaInput,
      needsMfa: mfa,
      needsAccountChoice: accountChoices,
      error: error || (/密码错误|登录失败|认证失败|用户名或密码/i.test(pageText) ? '统一认证未完成' : '')
    };
  }

  async function activatePasswordLogin() {
    const menu = [...document.querySelectorAll('li[role="menuitem"], [role="tab"], button')]
      .find(element => /^密码登录$|^password\s+login$/i.test(textOf(element)) && isVisible(element));
    if (menu && !menu.classList.contains('is-active')) {
      menu.click();
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }

  function pageState() {
    if (location.hostname === 'login.xjtu.edu.cn' && document.querySelector('form#fm1')) {
      return loginPageState();
    }
    return { kind: 'intermediate', ready: true, url: location.href, title: document.title };
  }

  function emitState() {
    chrome.runtime.sendMessage({ type: 'AUTH_PAGE_EVENT', state: pageState() }).catch(() => {});
  }

  async function waitForLoginInputs(timeout = 7000) {
    await activatePasswordLogin();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const state = loginPageState();
      if (state.ready) return state;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return loginPageState();
  }

  async function fillAndSubmit(message) {
    if (location.hostname !== 'login.xjtu.edu.cn' || !document.querySelector('form#fm1')) {
      return { ok: false, error: '当前不是统一认证密码登录页' };
    }
    if (window.__xjtuAuthSubmitted) return { ok: true, submitted: false, state: pageState() };
    const state = await waitForLoginInputs();
    if (!state.ready) return { ok: false, error: '统一认证登录表单尚未加载' };
    if (state.needsCaptcha || state.needsMfa || state.needsAccountChoice) {
      return { ok: true, submitted: false, state };
    }

    const inputs = visibleInputs();
    const usernameInput = inputs.find(input => input.type === 'text' && /学号|工号|账号|用户名|student|staff|phone|mobile|id/i.test(`${input.placeholder} ${input.getAttribute('aria-label') || ''}`))
      || inputs.find(input => input.type === 'text');
    const passwordInput = inputs.find(input => input.type === 'password');
    const hiddenUsername = document.querySelector('#fm1 input[name="username"]');
    const hiddenPassword = document.querySelector('#fm1 input[name="password"]');
    if (usernameInput) setNativeValue(usernameInput, String(message.username || ''));
    if (passwordInput) setNativeValue(passwordInput, String(message.password || ''));
    // 远程 Vue 组件通常会同步隐藏字段；这里同时设置一次，兼容组件加载较慢的版本。
    if (hiddenUsername) setNativeValue(hiddenUsername, String(message.username || ''));
    if (hiddenPassword) setNativeValue(hiddenPassword, String(message.password || ''));
    const trustAgent = document.querySelector('#fm1 input[name="trustAgent"]');
    if (trustAgent) setNativeValue(trustAgent, 'true');

    const button = visibleLoginButton();
    window.__xjtuAuthSubmitted = true;
    if (button) button.click();
    else if (typeof document.querySelector('#fm1')?.requestSubmit === 'function') document.querySelector('#fm1').requestSubmit();
    else document.querySelector('#fm1')?.submit();
    return { ok: true, submitted: true };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AUTH_FILL') return false;
    fillAndSubmit(message).then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  window.addEventListener('load', () => {
    setTimeout(emitState, 400);
    setTimeout(emitState, 1800);
  }, { once: true });
  setTimeout(emitState, 700);
  let stateTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(emitState, 250);
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  setInterval(emitState, 2500);
})();
