import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { initI18n, getCurrentLang } from '../src/scripts/i18n.js';
import { strings } from '../src/i18n/strings.js';

// Feature: xp-desktop-window-manager, Property 10: 语言切换更新所有绑定并可往返
//
// Property 10: 语言切换更新所有绑定并可往返
// 对任意经 data-i18n / data-i18n-zh / data-i18n-en / data-i18n-ph 绑定的元素集合，
// 切换到某语言后每个元素的文本/占位符等于该语言字典对应值；
// 连续切换 zh→en→zh 后所有元素回到初始一致状态。
//
// Validates: Requirements 15.1, 15.2, 15.3, 15.5
//
// The test drives the real observable behavior through initI18n() and the
// #lang-toggle button click, exactly as the page does — no apply() refactor needed.

const STORAGE_KEY = 'site-lang';

// All flat i18n keys present in the derived dictionary (both languages populated
// from content.json by strings.js buildStrings()).
const I18N_KEYS = Object.keys(strings.zh);

// A binding spec describes one DOM element bound through one of the i18n attributes.
//   - text: <span data-i18n="key">        → textContent = dict[key]
//   - ph:   <input data-i18n-ph="key">    → placeholder  = dict[key]
//   - attr: <span data-i18n-zh="..." data-i18n-en="..."> → textContent = literal per lang
const bindingArb = fc.oneof(
  fc.record({ kind: fc.constant('text'), key: fc.constantFrom(...I18N_KEYS) }),
  fc.record({ kind: fc.constant('ph'), key: fc.constantFrom(...I18N_KEYS) }),
  fc.record({
    kind: fc.constant('attr'),
    zh: fc.string(),
    en: fc.string(),
  })
);

// Generate at least one binding so each iteration exercises real elements.
const bindingsArb = fc.array(bindingArb, { minLength: 1, maxLength: 25 });

// Build a fresh desktop fragment: the i18n-bound elements plus the language
// toggle button that initI18n() wires up. Returns the created element handles
// paired with their spec so assertions can read expected values back.
function buildDom(bindings) {
  document.body.innerHTML = '';

  const container = document.createElement('div');
  const handles = [];

  bindings.forEach((spec) => {
    let el;
    if (spec.kind === 'text') {
      el = document.createElement('span');
      el.setAttribute('data-i18n', spec.key);
    } else if (spec.kind === 'ph') {
      el = document.createElement('input');
      el.setAttribute('data-i18n-ph', spec.key);
    } else {
      el = document.createElement('span');
      el.setAttribute('data-i18n-zh', spec.zh);
      el.setAttribute('data-i18n-en', spec.en);
    }
    container.appendChild(el);
    handles.push({ spec, el });
  });

  // Language toggle button (initI18n attaches the click→apply handler here).
  const btn = document.createElement('button');
  btn.id = 'lang-toggle';
  container.appendChild(btn);

  document.body.appendChild(container);
  return { handles, btn };
}

// The observable value each element should hold for a given language.
function expectedValue(spec, lang) {
  if (spec.kind === 'text') return strings[lang][spec.key];
  if (spec.kind === 'ph') return strings[lang][spec.key];
  return lang === 'zh' ? spec.zh : spec.en;
}

// The element's actual observable value (textContent or placeholder attribute).
function actualValue(handle) {
  if (handle.spec.kind === 'ph') return handle.el.getAttribute('placeholder');
  return handle.el.textContent;
}

function assertMatchesLang(handles, lang) {
  for (const handle of handles) {
    expect(actualValue(handle)).toBe(expectedValue(handle.spec, lang));
  }
}

describe('Property 10: 语言切换更新所有绑定并可往返', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('switching updates every binding to the target dictionary value and zh→en→zh round-trips', () => {
    fc.assert(
      fc.property(bindingsArb, (bindings) => {
        // Fresh DOM + cleared storage so each run defaults to zh (Req 15.3).
        localStorage.clear();
        const { handles, btn } = buildDom(bindings);

        // Load: apply persisted/default language. No valid stored value → zh.
        initI18n();
        expect(getCurrentLang()).toBe('zh');
        assertMatchesLang(handles, 'zh');

        // Capture the initial consistent (zh) snapshot for the round-trip check.
        const initialSnapshot = handles.map((h) => actualValue(h));

        // Switch zh → en via the toggle button (real observable interaction).
        btn.click();
        expect(getCurrentLang()).toBe('en');
        assertMatchesLang(handles, 'en'); // Req 15.1: all bindings updated
        expect(localStorage.getItem(STORAGE_KEY)).toBe('en'); // Req 15.2: persisted

        // Switch en → zh, completing the round trip.
        btn.click();
        expect(getCurrentLang()).toBe('zh');
        assertMatchesLang(handles, 'zh');
        expect(localStorage.getItem(STORAGE_KEY)).toBe('zh');

        // Round-trip: every element is back to its initial consistent state.
        const finalSnapshot = handles.map((h) => actualValue(h));
        expect(finalSnapshot).toEqual(initialSnapshot);
      }),
      { numRuns: 100 }
    );
  });

  it('applies the persisted language on load, defaulting to zh for missing/invalid values (Req 15.3)', () => {
    fc.assert(
      fc.property(
        fc.array(bindingArb, { minLength: 1, maxLength: 15 }),
        fc.oneof(
          fc.constantFrom('zh', 'en'),
          fc.constant(''),
          fc.constant('fr'),
          fc.constant('xx')
        ),
        (bindings, stored) => {
          localStorage.clear();
          if (stored) localStorage.setItem(STORAGE_KEY, stored);
          const { handles } = buildDom(bindings);

          initI18n();

          const effectiveLang = stored === 'en' ? 'en' : 'zh';
          expect(getCurrentLang()).toBe(effectiveLang);
          assertMatchesLang(handles, effectiveLang);
        }
      ),
      { numRuns: 100 }
    );
  });
});
