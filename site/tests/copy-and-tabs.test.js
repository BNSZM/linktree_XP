import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initCopy } from '../src/scripts/copy.js';
import { initI18n, S, toast } from '../src/scripts/i18n.js';

// ════════════════════════════════════════════════════════════
// Task 2.5 — 为复制与标签切换编写单元测试
//
// 两组可观察行为：
//   1) 点击联系图标 → 复制联系方式到剪贴板 + 显示 Toast 反馈
//   2) 标签条 / 装饰控件（OK/Cancel/Apply、标签）切换不改变所显示的内容
//
// _Requirements: 1.6_（重构后以完全相同的可观察行为重现复制与标签切换）
// ════════════════════════════════════════════════════════════

// Reproduces the relevant portion of index.astro's main-card DOM:
//   - 标签条（.xp-tabs / .xp-tab）
//   - 信息内容区（左图右信息），用于断言切换不改内容
//   - 联系方式行（#links 内的 [data-copy] 链接）
//   - 底部装饰按钮行（OK / Cancel / Apply）
//   - #toast 浮动提示区
//   - #lang-toggle（initI18n 需要）
function buildCardDom() {
  document.body.innerHTML = `
    <div class="xp-tabs" role="tablist">
      <button class="xp-tab xp-tab--active" type="button" role="tab" aria-selected="true">General</button>
      <button class="xp-tab" type="button" role="tab" aria-selected="false">Computer Name</button>
      <button class="xp-tab" type="button" role="tab" aria-selected="false">Hardware</button>
    </div>

    <div class="card-body" id="card-body">
      <div class="avatar"><span></span></div>
      <h1 class="name">培文</h1>
      <p class="tagline">AI 定制方案</p>
      <nav class="contact-section" aria-label="联系方式">
        <div class="contact-row" id="links">
          <a class="sbtn" href="#" data-copy="hello@example.com" data-type="copy" aria-label="Email">email</a>
          <a class="sbtn" href="#" data-copy="+86 138 0000 0000" data-type="copy" aria-label="Phone">phone</a>
          <a class="sbtn" href="https://example.com" data-type="link" aria-label="Site">site</a>
        </div>
      </nav>
    </div>

    <div class="xp-button-row">
      <button class="xp-btn xp-btn--primary" type="button">OK</button>
      <button class="xp-btn" type="button">Cancel</button>
      <button class="xp-btn" type="button">Apply</button>
    </div>

    <div id="toast"></div>
    <button id="lang-toggle"></button>
  `;
}

// Flush pending microtasks so the async click handler in initCopy settles.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Task 2.5 — 联系图标复制 + Toast 反馈 (Req 1.6, 9.6)', () => {
  let writeText;

  beforeEach(() => {
    localStorage.clear();
    buildCardDom();
    // Stub the Clipboard API so we can observe the copy without a real clipboard.
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('点击 data-copy 联系图标复制其值到剪贴板并显示 Toast', async () => {
    initCopy({ S, toast });

    const emailIcon = document.querySelector('[data-copy="hello@example.com"]');
    emailIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    // 复制：剪贴板收到联系方式值
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('hello@example.com');

    // Toast：提示区显示包含复制值的反馈并进入可见态
    const toastEl = document.getElementById('toast');
    expect(toastEl.classList.contains('show')).toBe(true);
    expect(toastEl.textContent).toContain('hello@example.com');
    expect(toastEl.textContent).toContain(S('toast.copied'));
  });

  it('点击不同联系图标复制对应的值', async () => {
    initCopy({ S, toast });

    const phoneIcon = document.querySelector('[data-copy="+86 138 0000 0000"]');
    phoneIcon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(writeText).toHaveBeenCalledWith('+86 138 0000 0000');
    expect(document.getElementById('toast').textContent).toContain('+86 138 0000 0000');
  });

  it('点击非复制类链接（无 data-copy）不触发复制', async () => {
    initCopy({ S, toast });

    const link = document.querySelector('[data-type="link"]');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(writeText).not.toHaveBeenCalled();
    expect(document.getElementById('toast').classList.contains('show')).toBe(false);
  });
});

describe('Task 2.5 — 标签条切换不改变内容 (Req 1.6, 8.7)', () => {
  beforeEach(() => {
    localStorage.clear();
    buildCardDom();
  });

  it('切换标签仅移动 active 视觉状态，不改变所显示内容', () => {
    initI18n();

    const cardBody = document.getElementById('card-body');
    const before = cardBody.innerHTML;

    const tabs = [...document.querySelectorAll('.xp-tab')];
    const target = tabs[2]; // Hardware（初始非 active）

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // active 状态转移到被点标签，其余移除
    expect(target.classList.contains('xp-tab--active')).toBe(true);
    expect(target.getAttribute('aria-selected')).toBe('true');
    const others = tabs.filter((t) => t !== target);
    for (const t of others) {
      expect(t.classList.contains('xp-tab--active')).toBe(false);
      expect(t.getAttribute('aria-selected')).toBe('false');
    }

    // 内容区未发生任何变化
    expect(cardBody.innerHTML).toBe(before);
  });

  it('任意时刻至多一个标签处于 active 状态', () => {
    initI18n();
    const tabs = [...document.querySelectorAll('.xp-tab')];

    for (const tab of tabs) {
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const active = tabs.filter((t) => t.classList.contains('xp-tab--active'));
      expect(active).toHaveLength(1);
      expect(active[0]).toBe(tab);
    }
  });
});

describe('Task 2.5 — 装饰按钮 OK/Cancel/Apply 不改变内容 (Req 1.6, 8.7)', () => {
  beforeEach(() => {
    localStorage.clear();
    buildCardDom();
  });

  it('点击 OK / Cancel / Apply 装饰按钮不改变所显示内容', () => {
    initI18n();

    const cardBody = document.getElementById('card-body');
    const before = cardBody.innerHTML;

    const decoButtons = [...document.querySelectorAll('.xp-button-row .xp-btn')];
    expect(decoButtons.map((b) => b.textContent)).toEqual(['OK', 'Cancel', 'Apply']);

    for (const btn of decoButtons) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(cardBody.innerHTML).toBe(before);
    }
  });
});
