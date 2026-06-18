// ════════════════════════════════════════════════════════════
// WindowManager —— 窗口生命周期与堆叠状态的唯一持有者。
//
// 本子系统「不内嵌任何具体应用知识」：所有窗口类型通过 App_Definition
// 注册（Req 18.1/18.2）。注册任意合法 App_Definition 即可获得一致的标准
// 窗口行为，无需修改核心逻辑。
//
// 本文件实现「骨架」（任务 7.1）：
//   - createWindowManager(options)  工厂，返回窗口管理器实例
//   - register(appDef)              注册新窗口类型（Req 18.1/18.2）
//   - WindowInstance 内部模型        运行时窗口实例
//   - 模板克隆实例化                  克隆 #xp-window-template 构建窗口 DOM，
//                                    按 App_Definition 填充标题/图标、决定是否
//                                    显示最大化按钮（Req 22.5）、是否挂载 resize
//                                    把手（Req 19.6）
//
// 生命周期与交互方法（openOrFocus / focus / close / minimize / restore /
// toggleMaximize / init）由后续任务（7.2/7.3/8.x/9.x/10.x）填充。本骨架预留
// 这些方法以保持对外 API 可扩展。
// ════════════════════════════════════════════════════════════

import { renderContent } from "./renderers/index.js";

/**
 * @typedef {import("./registry.js").AppDefinition} AppDefinition
 */

/**
 * WindowInstance —— 运行时窗口实例（WindowManager 内部模型）。
 *
 * @typedef {Object} WindowInstance
 * @property {string} instanceId               实例唯一标识
 * @property {string} appId                    所属 App_Definition id
 * @property {HTMLElement} el                  克隆出的窗口 DOM（.xp-win）
 * @property {HTMLElement|null} taskButtonEl   对应的 Task_Button（任务 8.1 创建）
 * @property {"visible"|"minimized"} state     可见 / 最小化
 * @property {boolean} maximized               是否处于最大化态
 * @property {{ left: number, top: number, width: number, height: number }} rect 当前矩形
 * @property {{ left: number, top: number, width: number, height: number }} [restoreRect] 最大化前矩形
 * @property {number} z                        z-index 层级
 * @property {import("./renderers/index.js").RendererHooks} hooks 内容渲染器返回的生命周期钩子（任务 12.1）
 */

const DEFAULT_TEMPLATE_ID = "xp-window-template";

// ── 错落摆放常量（任务 8.3，Req 6）──
const STAGGER_STEP = 24; // 每个新窗口相对前一窗口的步进偏移（像素，Req 6.1）
const STAGGER_CYCLE = 6; // 步进循环数：偏移按 openCount % N 循环，避免无限向右下漂移
const TASKBAR_HEIGHT = 30; // 底部任务栏高度，用于界定可见工作区（与设计一致）
const TITLEBAR_REACH = 30; // 至少保留可被指针触及的窗口边距（Req 6.2）
const FALLBACK_DESK_W = 1024; // 桌面宽度未知时的回退值
const FALLBACK_DESK_H = 768; // 桌面高度未知时的回退值

/**
 * 创建一个窗口管理器实例。
 *
 * @param {Object} options
 * @param {HTMLElement} options.desktopEl          窗口挂载容器（壁纸之上、任务栏之下）
 * @param {HTMLElement} [options.taskbarEl]        Task_Button 容器（XPTaskbar 的 #xpTasks）
 * @param {AppDefinition[]} [options.registry]     初始 App_Definition 列表
 * @param {() => boolean} [options.isMobile]       视口 ≤768px 判定
 * @param {Object} [options.i18n]                  复用 scripts/i18n.js：{ S, getCurrentLang, onLangChange }
 * @param {HTMLTemplateElement} [options.templateEl] 窗口模板（缺省按 id 查找 #xp-window-template）
 * @param {Document} [options.doc]                 文档对象（便于测试注入；缺省 globalThis.document）
 * @returns {WindowManager}
 */
export function createWindowManager(options = {}) {
  const {
    desktopEl = null,
    taskbarEl = null,
    registry = [],
    isMobile = () => false,
    i18n = null,
    templateEl = null,
    doc = typeof document !== "undefined" ? document : null,
  } = options;

  // ── 内部状态 ──
  /** @type {Map<string, AppDefinition>} id → App_Definition 注册表 */
  const registryById = new Map();
  /** @type {Map<string, WindowInstance>} instanceId → 实例 */
  const instances = new Map();

  let instanceSeq = 0; // 实例 id 自增序列
  let zSeq = 100; // z-index 单调递增基准（任务 7.3 使用）
  let openCount = 0; // 错落摆放计数（任务 8.3 使用）
  let focusedInstanceId = null; // 当前聚焦实例（任意时刻至多一个，Req 3.4）
  let initialized = false; // init() 幂等守卫

  /**
   * 解析窗口模板元素。优先使用注入的 templateEl，否则按 id 查找。
   * @returns {HTMLTemplateElement}
   */
  function resolveTemplate() {
    if (templateEl) return templateEl;
    if (!doc) {
      throw new Error("WindowManager: no document available to locate window template");
    }
    const found = doc.getElementById(DEFAULT_TEMPLATE_ID);
    if (!found) {
      throw new Error(
        `WindowManager: window template #${DEFAULT_TEMPLATE_ID} not found`
      );
    }
    return found;
  }

  /**
   * 解析 App_Definition 的双语标题。
   * 优先经 i18n.S(titleKey)（与 data-i18n 机制一致，Req 18.3/15.5），
   * 解析不到时回退到 titleKey 本身，保证标题非空。
   * @param {AppDefinition} appDef
   * @returns {string}
   */
  function resolveTitle(appDef) {
    const key = appDef.titleKey || "";
    if (i18n && typeof i18n.S === "function") {
      const v = i18n.S(key);
      if (v != null && v !== "") return v;
    }
    return key;
  }

  /**
   * 注册一个新窗口类型（Req 18.1/18.2）。
   * 重复 id 覆盖既有定义。注册不创建任何 DOM（懒实例化，Req 8.8/8.9）。
   * @param {AppDefinition} appDef
   * @returns {WindowManager}
   */
  function register(appDef) {
    if (!appDef || typeof appDef.id !== "string" || appDef.id === "") {
      throw new Error("WindowManager.register: appDef.id is required");
    }
    registryById.set(appDef.id, appDef);
    return api;
  }

  /**
   * 通过克隆 #xp-window-template 构建窗口 DOM 并创建 WindowInstance（任务 7.1 核心）。
   *
   * 按 App_Definition：
   *   - 填充标题（经 i18n）与图标
   *   - maximizable=false → 加 .no-max 类隐藏最大化按钮（Req 22.5）
   *   - resizable=false   → 移除 8 个 resize 把手（Req 19.6）
   *   - 应用 defaultSize 初始尺寸，记录到 instance.rect
   *
   * 不负责挂载到 desktop、不绑定交互、不创建 Task_Button —— 这些由后续任务完成。
   *
   * @param {AppDefinition} appDef
   * @returns {WindowInstance}
   */
  function instantiate(appDef) {
    const template = resolveTemplate();
    const frag = template.content.cloneNode(true);
    /** @type {HTMLElement|null} */
    const el = frag.querySelector(".xp-win");
    if (!el) {
      throw new Error(
        "WindowManager: cloned template does not contain a .xp-win element"
      );
    }

    // ── 标题与无障碍标签 ──
    const title = resolveTitle(appDef);
    const titleEl = el.querySelector(".xp-win-title");
    if (titleEl) {
      titleEl.textContent = title;
      if (appDef.titleKey) titleEl.setAttribute("data-i18n", appDef.titleKey);
    }
    el.setAttribute("aria-label", title);

    // ── 图标 ──
    const iconEl = el.querySelector(".xp-win-icon");
    if (iconEl) iconEl.textContent = appDef.icon || "";

    // ── 最大化按钮可见性（Req 22.5）──
    if (!appDef.maximizable) el.classList.add("no-max");

    // ── resize 把手挂载与否（Req 19.6）──
    if (!appDef.resizable) {
      el.querySelectorAll(".xp-rz").forEach((handle) => handle.remove());
    }

    // ── 初始尺寸 ──
    const size = appDef.defaultSize || { w: 0, h: 0 };
    if (size.w) el.style.width = `${size.w}px`;
    if (size.h) el.style.height = `${size.h}px`;

    // ── 标识便于调试与后续按 appId 检索 ──
    const instanceId = `${appDef.id}#${++instanceSeq}`;
    el.dataset.appId = appDef.id;
    el.dataset.instanceId = instanceId;

    /** @type {WindowInstance} */
    const instance = {
      instanceId,
      appId: appDef.id,
      el,
      taskButtonEl: null,
      state: "visible",
      maximized: false,
      rect: { left: 0, top: 0, width: size.w || 0, height: size.h || 0 },
      z: zSeq,
      hooks: {},
    };

    instances.set(instanceId, instance);
    return instance;
  }

  // ════════════════════════════════════════════════════════════
  // 任务 7.2：openOrFocus / 单实例 / 懒实例化 / init 自动打开主窗口
  // ＋ 最小可用 focus（提升 z-index、标记活动）。
  //
  // 注：点击聚焦（pointerdown 捕获阶段）与完整 z-index 堆叠归任务 7.3；
  //     Task_Button 最小化/还原归任务 8.1；错落摆放归任务 8.3。
  //     本任务仅实现支撑「打开或聚焦」所需的最小、可用且不与上述冲突的逻辑。
  // ════════════════════════════════════════════════════════════

  /**
   * 将实例的窗口 DOM 挂载到 desktopEl 并给出初始错落位置（首次实例化时调用）。
   * 初始位置由 placeInstance 计算（桌面中心 + 步进偏移，钳入可见工作区，Req 6）。
   * @param {WindowInstance} instance
   */
  function mountInstance(instance) {
    if (!desktopEl) {
      throw new Error(
        "WindowManager: desktopEl is required to mount a window instance"
      );
    }
    placeInstance(instance);
    desktopEl.appendChild(instance.el);
  }

  /**
   * 计算并应用窗口初始位置：错落摆放（Req 6）。
   *
   * 位置 = 桌面工作区中心 + (openCount % N) × 步进偏移（向右下，Req 6.1），
   * 随后钳制到可见工作区内，确保标题栏仍可被指针触及（Req 6.2）。
   *
   * 关于 openCount 时序：openNew() 在挂载（调用本函数）之后才自增 openCount，
   * 因此此处的 openCount 反映「此前已打开的窗口数」——使首个窗口正好居中，
   * 其后每个新窗口依次向右下错落，相邻窗口不会完全重合。
   *
   * 关于回退：桌面尺寸未知（clientWidth/Height 为 0）时回退到 1024×768，
   * 偏移为 0 的首个窗口仍退化为居中，保持原居中回退行为不被破坏。
   *
   * @param {WindowInstance} instance
   */
  function placeInstance(instance) {
    const deskW =
      desktopEl?.clientWidth ||
      doc?.documentElement?.clientWidth ||
      FALLBACK_DESK_W;
    const deskH =
      desktopEl?.clientHeight ||
      doc?.documentElement?.clientHeight ||
      FALLBACK_DESK_H;
    const w = instance.rect.width || 0;
    const h = instance.rect.height || 0;

    // 可见工作区：.xp-desktop 已通过 CSS bottom: 30px 预留了任务栏高度，
    // clientHeight 即为可用高度，无需再减 TASKBAR_HEIGHT（Req 6.2）。
    const workW = deskW;
    const workH = deskH;

    // 钳制上界：保证至少 TITLEBAR_REACH 像素的窗口（含标题栏）留在工作区内，
    // 使标题栏始终可被指针触及（Req 6.2）。
    const maxLeft = Math.max(0, workW - TITLEBAR_REACH);
    const maxTop = Math.max(0, workH - TITLEBAR_REACH);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    // 基准：桌面工作区居中，并先钳入合法范围（处理超大窗口的负中心）。
    const baseLeft = clamp(Math.round((workW - w) / 2), 0, maxLeft);
    const baseTop = clamp(Math.round((workH - h) / 2), 0, maxTop);

    // 错落偏移：位置 = 基准 + (openCount % N) × 步进（Req 6.1），再次钳入工作区。
    const offset = (openCount % STAGGER_CYCLE) * STAGGER_STEP;
    const left = clamp(baseLeft + offset, 0, maxLeft);
    const top = clamp(baseTop + offset, 0, maxTop);

    instance.rect.left = left;
    instance.rect.top = top;
    instance.el.style.left = `${left}px`;
    instance.el.style.top = `${top}px`;
  }

  /**
   * 显示一个（可能已最小化的）窗口实例（还原可见态，Req 7.2）。
   * Task_Button 的非活动/活动同步由任务 8.1 细化。
   * @param {WindowInstance} instance
   */
  function showInstance(instance) {
    instance.state = "visible";
    instance.el.style.display = "";
    instance.el.hidden = false;
  }

  /**
   * 聚焦一个实例（最小可用实现，任务 7.3 细化点击聚焦与堆叠）：
   *   - 取新的最高 z-index 置顶（Req 3.1）
   *   - 为被聚焦窗口加 .is-active，其余移除（Req 3.2/3.3）
   *   - 任意时刻至多一个活动窗口（Req 3.4）
   *   - 同步 Task_Button 活动态：活动 Task_Button 反映「可见且聚焦」（任务 8.1，Req 4）
   * @param {WindowInstance} instance
   */
  function focusInstance(instance) {
    if (!instance) return;
    instance.z = ++zSeq;
    instance.el.style.zIndex = String(instance.z);
    focusedInstanceId = instance.instanceId;
    for (const inst of instances.values()) {
      inst.el.classList.toggle("is-active", inst === instance);
    }
    syncTaskButtons();
    callHook(instance, "onFocus"); // 任务 12.1：通知内容渲染器该窗口已聚焦
  }

  // ════════════════════════════════════════════════════════════
  // 任务 8.1：Task_Button 最小化/还原（Req 4）。
  //
  // 打开窗口即创建一个显示窗口标题的 Task_Button（Req 4.1/4.5），它是一个可
  // 键盘聚焦/触发的 <button>。Task_Button 的活动态等价于「窗口可见且聚焦」
  // （Req 3 ↔ Req 4），由 syncTaskButtons() 在每次焦点/最小化/还原变化后统一
  // 维护，保证任意时刻至多一个活动 Task_Button。
  //
  // 点击规则：
  //   - 可见且聚焦   → 最小化并置 Task_Button 非活动（Req 4.2）
  //   - 已隐藏       → 显示 + 聚焦 + 置 Task_Button 活动（Req 4.3）
  //   - 可见但未聚焦 → 聚焦 + 置 Task_Button 活动（Req 4.4）
  // ════════════════════════════════════════════════════════════

  /**
   * 同步全部 Task_Button 的活动态：活动 ⇔ 该窗口可见且为当前聚焦窗口（Req 4）。
   * 单一维护点，保证任意时刻至多一个活动 Task_Button。
   */
  function syncTaskButtons() {
    for (const inst of instances.values()) {
      if (!inst.taskButtonEl) continue;
      const active =
        inst.state === "visible" && inst.instanceId === focusedInstanceId;
      inst.taskButtonEl.classList.toggle("xp-task-btn--active", active);
    }
  }

  /**
   * Task_Button 点击：依窗口当前状态应用最小化/还原/聚焦规则（Req 4.2/4.3/4.4）。
   * @param {WindowInstance} instance
   */
  function handleTaskButtonClick(instance) {
    if (!instance) return;
    if (instance.state === "minimized") {
      restore(instance.instanceId); // 已隐藏 → 显示 + 聚焦 + 活动（Req 4.3）
    } else if (focusedInstanceId === instance.instanceId) {
      minimize(instance.instanceId); // 可见且聚焦 → 最小化 + 非活动（Req 4.2）
    } else {
      focusInstance(instance); // 可见未聚焦 → 聚焦 + 活动（Req 4.4）
    }
  }

  /**
   * 打开窗口时在 Taskbar 任务区创建对应的 Task_Button（Req 4.1），
   * 显示窗口标题（Req 4.5），并随 i18n titleKey 经 data-i18n 同步双语。
   * Task_Button 为可键盘聚焦/触发的 <button>（Req 16.6）。
   * @param {WindowInstance} instance
   * @returns {HTMLElement|null}
   */
  function createTaskButton(instance) {
    if (!taskbarEl || !doc) return null;
    const appDef = registryById.get(instance.appId);
    const title = appDef ? resolveTitle(appDef) : instance.appId;

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "xp-task-btn";
    btn.dataset.instanceId = instance.instanceId;

    const iconSpan = doc.createElement("span");
    iconSpan.className = "xp-task-icon";
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = (appDef && appDef.icon) || "";

    const labelSpan = doc.createElement("span");
    labelSpan.className = "xp-task-label";
    if (appDef && appDef.titleKey) {
      labelSpan.setAttribute("data-i18n", appDef.titleKey);
    }
    labelSpan.textContent = title;

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.addEventListener("click", () => handleTaskButtonClick(instance));

    taskbarEl.appendChild(btn);
    instance.taskButtonEl = btn;
    return btn;
  }

  /**
   * 最小化一个窗口：隐藏 Window 并将其 Task_Button 置非活动（Req 4.2）。
   * 若被最小化者为当前聚焦窗口，则清除聚焦（最小化后无窗口处于「可见且聚焦」）。
   * @param {string} instanceId
   * @returns {WindowManager}
   */
  function minimize(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return api;
    instance.state = "minimized";
    instance.el.style.display = "none";
    instance.el.hidden = true;
    instance.el.classList.remove("is-active");
    if (focusedInstanceId === instanceId) focusedInstanceId = null;
    syncTaskButtons();
    return api;
  }

  /**
   * 还原一个窗口：显示 Window、聚焦它，并将其 Task_Button 置活动（Req 4.3）。
   * @param {string} instanceId
   * @returns {WindowManager}
   */
  function restore(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return api;
    showInstance(instance); // 显示（还原可见态）
    focusInstance(instance); // 聚焦 + 同步 Task_Button 活动态
    return api;
  }

  /**
   * 安全调用某实例的内容渲染器生命周期钩子（任务 12.1）。
   * 钩子缺省/非函数时静默跳过；钩子抛出不影响窗口管理核心流程。
   * @param {WindowInstance} instance
   * @param {"onFocus"|"onResize"|"onClose"} name
   */
  function callHook(instance, name) {
    if (!instance || !instance.hooks) return;
    const fn = instance.hooks[name];
    if (typeof fn !== "function") return;
    try {
      fn();
    } catch (err) {
      // 渲染器钩子异常不应破坏窗口生命周期；仅记录以便排查。
      if (typeof console !== "undefined" && console.error) {
        console.error(
          `WindowManager: renderer hook "${name}" of ${instance.appId} threw`,
          err
        );
      }
    }
  }

  /**
   * 调用与 App_Definition.content.kind 匹配的内容渲染器，向 .xp-win-body 注入正文
   * （任务 12.1，Req 18.4）。渲染上下文 ctx = { wm, i18n, isMobile, opts }；渲染器
   * 返回的 { onFocus?, onResize?, onClose? } 钩子存到 instance.hooks，由 WindowManager
   * 在聚焦/调整尺寸/关闭等时点调用。未注册 kind 时安全回退（正文留空，不抛）。
   * @param {WindowInstance} instance
   * @param {Object} [opts]
   */
  function renderInstanceContent(instance, opts) {
    const appDef = registryById.get(instance.appId);
    if (!appDef) return;
    const bodyEl = instance.el.querySelector(".xp-win-body");
    if (!bodyEl) return;
    const ctx = { wm: api, i18n, isMobile, opts: opts || {} };
    instance.hooks = renderContent(bodyEl, appDef, ctx);
  }

  /**
   * 懒实例化并打开一个新窗口：克隆 DOM → 挂载到 desktop → 置可见 → 聚焦。
   * @param {AppDefinition} appDef
   * @param {Object} [opts]
   * @returns {WindowInstance}
   */
  function openNew(appDef, opts) {
    const instance = instantiate(appDef);
    instance.lastOpts = opts;
    mountInstance(instance);
    instance.state = "visible";
    openCount += 1;
    renderInstanceContent(instance, opts); // 任务 12.1：按 content.kind 注入正文并存钩子
    createTaskButton(instance); // Req 4.1：打开即创建 Task_Button（显示标题，Req 4.5）
    wireMinimizeControl(instance); // 标题栏最小化控件 → minimize（Req 4.2）
    wireCloseControl(instance); // 标题栏关闭控件 → close（Req 5.1）
    wireMaximizeControl(instance); // 最大化按钮 + 双击标题栏 → toggleMaximize（Req 22）
    wireTitlebarDrag(instance); // 标题栏表面拖动 → 移动窗口（Req 2）
    wireResizeHandles(instance); // 8 个把手 → 调整尺寸 + minSize 约束（Req 19）
    wireKeyboard(instance); // Esc 关闭 + Tab 焦点陷阱 + 控件 Enter/Space（Req 16.4/16.5/16.6）
    focusInstance(instance);
    return instance;
  }

  /**
   * 将窗口标题栏的最小化控件（.xp-win-min）接线到 minimize（Req 4.2）。
   * 点击该控件等价于「可见且聚焦时点击 Task_Button」的最小化行为。
   * @param {WindowInstance} instance
   */
  function wireMinimizeControl(instance) {
    const minBtn = instance.el.querySelector(".xp-win-min");
    if (!minBtn) return;
    minBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      minimize(instance.instanceId);
    });
  }

  /**
   * 将窗口标题栏的关闭控件（.xp-win-close）接线到 close（Req 5.1）。
   * stopPropagation 阻止该 pointerdown/click 冒泡触发拖动或捕获阶段聚焦的异常行为。
   * @param {WindowInstance} instance
   */
  function wireCloseControl(instance) {
    const closeBtn = instance.el.querySelector(".xp-win-close");
    if (!closeBtn) return;
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      close(instance.instanceId);
    });
  }

  // ════════════════════════════════════════════════════════════
  // 任务 9.1：标题栏拖动（Req 2）。
  //
  // 标题栏「表面」pointerdown（非控制按钮，Req 2.4）启动拖动：记录指针相对窗口
  // 左上角的偏移，pointermove 更新 left/top 并同步 instance.rect（Req 2.1），
  // pointerup 结束并将窗口保留在释放位置（Req 2.2）。拖动期间保持聚焦置顶
  // （Req 2.3）——由 desktopEl 捕获阶段 pointerdown 先行聚焦保证（标题栏落在
  // 窗口内，捕获阶段早于本冒泡监听）。最大化态禁用拖动（Req 22.4）；移动端
  // 禁用拖动（Req 2.5）。
  //
  // 采用「指针捕获 + 文档级 move/up 监听」：setPointerCapture 让指针移出标题栏
  // 后事件仍归属该元素（真实浏览器流畅拖动）；文档级监听确保即便指针快速移出
  // 也能持续更新与正确结束（且在测试环境下可由合成事件驱动）。
  // ════════════════════════════════════════════════════════════

  /**
   * 当前活动拖动状态（任意时刻至多一个）。
   * @type {null | { instance: WindowInstance, startX: number, startY: number, origLeft: number, origTop: number, titlebarEl: HTMLElement, pointerId: number }}
   */
  let dragState = null;

  /**
   * 拖动中：按指针位移更新窗口 left/top 并同步 instance.rect（Req 2.1）。
   * @param {PointerEvent} ev
   */
  function handleDragMove(ev) {
    if (!dragState) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    const left = dragState.origLeft + dx;
    const top = dragState.origTop + dy;
    const instance = dragState.instance;
    instance.rect.left = left;
    instance.rect.top = top;
    instance.el.style.left = `${left}px`;
    instance.el.style.top = `${top}px`;
  }

  /**
   * 结束拖动：释放指针捕获、解绑文档级监听，窗口保留在释放位置（Req 2.2）。
   * @param {PointerEvent} ev
   */
  function handleDragEnd(ev) {
    if (!dragState) return;
    const { titlebarEl, pointerId } = dragState;
    if (
      titlebarEl &&
      typeof titlebarEl.releasePointerCapture === "function" &&
      pointerId != null
    ) {
      try {
        titlebarEl.releasePointerCapture(pointerId);
      } catch {
        /* 指针捕获不可用时忽略（测试/旧环境） */
      }
    }
    if (doc && typeof doc.removeEventListener === "function") {
      doc.removeEventListener("pointermove", handleDragMove);
      doc.removeEventListener("pointerup", handleDragEnd);
    }
    dragState = null;
  }

  /**
   * 将窗口标题栏表面接线为可拖动（Req 2）。
   * 控制按钮（.xp-win-controls 内）上的 pointerdown 不启动拖动（Req 2.4）；
   * 移动端（Req 2.5）与最大化态（Req 22.4）禁用拖动。
   * @param {WindowInstance} instance
   */
  function wireTitlebarDrag(instance) {
    const titlebar = instance.el.querySelector(".xp-win-titlebar");
    if (!titlebar) return;
    titlebar.addEventListener("pointerdown", (ev) => {
      // 仅主键（通常为左键）启动拖动；未指定按钮（合成事件）默认视为主键。
      if (typeof ev.button === "number" && ev.button !== 0) return;

      // 控制按钮（最小化/最大化/关闭）上不启动拖动（Req 2.4）。
      const target = ev.target;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest(".xp-win-controls")
      ) {
        return;
      }

      // 移动端禁用拖动（Req 2.5）。
      if (isMobile()) return;
      // 最大化态禁用拖动（Req 22.4）。
      if (instance.maximized) return;

      dragState = {
        instance,
        startX: ev.clientX,
        startY: ev.clientY,
        origLeft: instance.rect.left || 0,
        origTop: instance.rect.top || 0,
        titlebarEl: titlebar,
        pointerId: ev.pointerId,
      };

      // 指针捕获：使指针移出标题栏后事件仍归属该元素（Req 2.1 流畅拖动）。
      if (
        typeof titlebar.setPointerCapture === "function" &&
        ev.pointerId != null
      ) {
        try {
          titlebar.setPointerCapture(ev.pointerId);
        } catch {
          /* 指针捕获不可用时忽略 */
        }
      }

      // 文档级 move/up 监听：持续跟随并正确结束（Req 2.1/2.2）。
      if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("pointermove", handleDragMove);
        doc.addEventListener("pointerup", handleDragEnd);
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // 任务 9.2：边缘/角落调整尺寸 + 最小尺寸约束（Req 19）。
  //
  // 每个可调整窗口渲染 8 个把手（4 边 + 4 角，模板已含；Main_Window 因
  // resizable=false 在 instantiate 时被剥离把手，不参与，Req 19.5/19.6）。
  // 把手 pointerdown 启动调整：按把手方位改变 width/height（Req 19.1/19.2），
  // 从左/上边或对应角拖拽时同步改 left/top 以使对边保持固定。施加 minSize
  // （Req 19.4）：宽高恒不小于该窗口声明的最小尺寸，缩到极小时夹断到 minSize
  // 并锚定固定对边。正文经弹性布局（.xp-win-body flex:1）随尺寸自适应
  // （Req 19.3）。调整中保持聚焦置顶——把手位于窗口内，desktopEl 捕获阶段
  // pointerdown 先行聚焦保证（Req 19.8）。移动端禁用（Req 19.7）；最大化态
  // 禁用（Req 22.4）。
  //
  // 与拖动一致采用「指针捕获 + 文档级 move/up 监听」，使指针移出把手后仍持续
  // 更新并正确结束（真实浏览器流畅、测试可由合成事件驱动）。
  // ════════════════════════════════════════════════════════════

  /** 把手方位 → 边缘标志（north/south/east/west）。 */
  const RESIZE_DIRS = {
    n: { north: true },
    s: { south: true },
    e: { east: true },
    w: { west: true },
    ne: { north: true, east: true },
    nw: { north: true, west: true },
    se: { south: true, east: true },
    sw: { south: true, west: true },
  };

  /**
   * 当前活动调整尺寸状态（任意时刻至多一个）。
   * @type {null | { instance: WindowInstance, dir: { north?: boolean, south?: boolean, east?: boolean, west?: boolean }, startX: number, startY: number, origLeft: number, origTop: number, origW: number, origH: number, right: number, bottom: number, minW: number, minH: number, handleEl: HTMLElement, pointerId: number }}
   */
  let resizeState = null;

  /**
   * 解析把手元素的方位（从 xp-rz-{dir} 类名）。
   * @param {HTMLElement} handleEl
   * @returns {{ north?: boolean, south?: boolean, east?: boolean, west?: boolean } | null}
   */
  function resolveResizeDir(handleEl) {
    if (!handleEl || !handleEl.classList) return null;
    for (const key of Object.keys(RESIZE_DIRS)) {
      if (handleEl.classList.contains(`xp-rz-${key}`)) return RESIZE_DIRS[key];
    }
    return null;
  }

  /**
   * 取窗口的最小尺寸（Req 19.4）。来源 App_Definition.minSize，缺省回退 0。
   * @param {WindowInstance} instance
   * @returns {{ w: number, h: number }}
   */
  function getMinSize(instance) {
    const appDef = registryById.get(instance.appId);
    const min = (appDef && appDef.minSize) || {};
    return { w: min.w || 0, h: min.h || 0 };
  }

  /**
   * 调整尺寸中：按指针位移与把手方位改变 width/height（必要时改 left/top），
   * 施加 minSize 并保持固定对边锚定，同步 instance.rect（Req 19.1/19.2/19.4）。
   * @param {PointerEvent} ev
   */
  function handleResizeMove(ev) {
    if (!resizeState) return;
    const s = resizeState;
    const dx = ev.clientX - s.startX;
    const dy = ev.clientY - s.startY;

    let left = s.origLeft;
    let top = s.origTop;
    let width = s.origW;
    let height = s.origH;

    if (s.dir.east) width = s.origW + dx;
    if (s.dir.west) width = s.origW - dx;
    if (s.dir.south) height = s.origH + dy;
    if (s.dir.north) height = s.origH - dy;

    // 施加最小尺寸约束（Req 19.4）：宽高恒不小于 minSize。
    width = Math.max(s.minW, width);
    height = Math.max(s.minH, height);

    // 从左/上边拖拽时，固定右/下对边：left/top = 对边 − 夹断后的尺寸。
    if (s.dir.west) left = s.right - width;
    if (s.dir.north) top = s.bottom - height;

    const instance = s.instance;
    instance.rect.left = left;
    instance.rect.top = top;
    instance.rect.width = width;
    instance.rect.height = height;
    instance.el.style.left = `${left}px`;
    instance.el.style.top = `${top}px`;
    instance.el.style.width = `${width}px`;
    instance.el.style.height = `${height}px`;
  }

  /**
   * 结束调整尺寸：释放指针捕获、解绑文档级监听，窗口保留在释放后的尺寸/位置。
   * @param {PointerEvent} ev
   */
  function handleResizeEnd() {
    if (!resizeState) return;
    const { handleEl, pointerId } = resizeState;
    const instance = resizeState.instance;
    if (
      handleEl &&
      typeof handleEl.releasePointerCapture === "function" &&
      pointerId != null
    ) {
      try {
        handleEl.releasePointerCapture(pointerId);
      } catch {
        /* 指针捕获不可用时忽略（测试/旧环境） */
      }
    }
    if (doc && typeof doc.removeEventListener === "function") {
      doc.removeEventListener("pointermove", handleResizeMove);
      doc.removeEventListener("pointerup", handleResizeEnd);
    }
    resizeState = null;
    callHook(instance, "onResize"); // 任务 12.1：尺寸调整结束后通知内容渲染器重排
  }

  /**
   * 将窗口的 8 个 resize 把手接线为可调整尺寸（Req 19）。
   * 非可调整窗口（Main_Window）在 instantiate 时已剥离把手，此处自然空操作
   * （Req 19.6）。移动端（Req 19.7）与最大化态（Req 22.4）禁用调整。
   * @param {WindowInstance} instance
   */
  function wireResizeHandles(instance) {
    const handles = instance.el.querySelectorAll(".xp-rz");
    handles.forEach((handle) => {
      handle.addEventListener("pointerdown", (ev) => {
        // 仅主键启动；未指定按钮（合成事件）默认视为主键。
        if (typeof ev.button === "number" && ev.button !== 0) return;
        // 移动端禁用调整尺寸（Req 19.7）。
        if (isMobile()) return;
        // 最大化态禁用调整尺寸（Req 22.4）。
        if (instance.maximized) return;

        const dir = resolveResizeDir(handle);
        if (!dir) return;

        // 把手位于窗口内，desktopEl 捕获阶段 pointerdown 已先行聚焦置顶
        // （Req 19.8）；此处阻止冒泡避免触发标题栏拖动的异常路径。
        ev.stopPropagation();

        const min = getMinSize(instance);
        const origLeft = instance.rect.left || 0;
        const origTop = instance.rect.top || 0;
        const origW = instance.rect.width || 0;
        const origH = instance.rect.height || 0;

        resizeState = {
          instance,
          dir,
          startX: ev.clientX,
          startY: ev.clientY,
          origLeft,
          origTop,
          origW,
          origH,
          right: origLeft + origW, // 西向拖拽固定的右边缘
          bottom: origTop + origH, // 北向拖拽固定的下边缘
          minW: min.w,
          minH: min.h,
          handleEl: handle,
          pointerId: ev.pointerId,
        };

        // 指针捕获：使指针移出把手后事件仍归属该元素（流畅调整）。
        if (
          typeof handle.setPointerCapture === "function" &&
          ev.pointerId != null
        ) {
          try {
            handle.setPointerCapture(ev.pointerId);
          } catch {
            /* 指针捕获不可用时忽略 */
          }
        }

        // 文档级 move/up 监听：持续跟随并正确结束。
        if (doc && typeof doc.addEventListener === "function") {
          doc.addEventListener("pointermove", handleResizeMove);
          doc.addEventListener("pointerup", handleResizeEnd);
        }
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  // 任务 9.3：最大化/还原 + 双击标题栏（Req 22）。
  //
  // toggleMaximize 在最大化前保存 restoreRect = {left,top,width,height}，最大化时
  // 铺满「桌面工作区」（.xp-desktop 已预留任务栏高度，clientWidth × clientHeight，
  // 定位 0,0）并加 .is-maximized
  // （Req 22.2）；还原时回写 restoreRect、移除 .is-maximized（Req 22.3）。双击标题栏
  // 表面（非控制按钮）等价于点击最大化/还原按钮（Req 22.2/22.3）。最大化态下拖动与
  // 边缘调整尺寸被禁用——由 wireTitlebarDrag / wireResizeHandles 内的
  // instance.maximized 守卫保证（Req 22.4）。Main_Window（maximizable=false）无最大化
  // 控件且不可最大化（Req 22.5）；移动端禁用最大化（Req 22.6）。
  // ════════════════════════════════════════════════════════════

  /**
   * 计算可见桌面工作区：桌面宽 × 桌面高。
   * .xp-desktop 已通过 CSS bottom: 30px 预留了任务栏高度，
   * clientHeight 即为可用高度，无需再减 TASKBAR_HEIGHT。
   * 桌面尺寸未知（happy-dom 下 clientWidth/Height 为 0）时回退到 1024×768，
   * 与 placeInstance 的回退策略保持一致。
   * @returns {{ width: number, height: number }}
   */
  function getWorkArea() {
    const deskW =
      desktopEl?.clientWidth ||
      doc?.documentElement?.clientWidth ||
      FALLBACK_DESK_W;
    const deskH =
      desktopEl?.clientHeight ||
      doc?.documentElement?.clientHeight ||
      FALLBACK_DESK_H;
    // .xp-desktop 已通过 CSS bottom: 30px 预留了任务栏高度，
    // clientHeight 已是不含任务栏的可用高度，无需再减 TASKBAR_HEIGHT。
    return { width: deskW, height: deskH };
  }

  /**
   * 将一个矩形应用到实例的 rect 与内联样式（统一写入点）。
   * @param {WindowInstance} instance
   * @param {{ left: number, top: number, width: number, height: number }} rect
   */
  function applyRect(instance, rect) {
    instance.rect.left = rect.left;
    instance.rect.top = rect.top;
    instance.rect.width = rect.width;
    instance.rect.height = rect.height;
    instance.el.style.left = `${rect.left}px`;
    instance.el.style.top = `${rect.top}px`;
    instance.el.style.width = `${rect.width}px`;
    instance.el.style.height = `${rect.height}px`;
  }

  /**
   * 最大化/还原一个窗口（Req 22）。
   *   - 未最大化 → 保存 restoreRect、铺满工作区、加 .is-maximized（Req 22.2）
   *   - 已最大化 → 回写 restoreRect、移除 .is-maximized（Req 22.3）
   * Main_Window（maximizable=false）不可最大化（Req 22.5）；移动端禁用（Req 22.6）。
   * @param {string} instanceId
   * @returns {WindowManager}
   */
  function toggleMaximize(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return api;

    // 不可最大化窗口（Main_Window）不参与（Req 22.5）。
    const appDef = registryById.get(instance.appId);
    if (appDef && appDef.maximizable === false) return api;

    // 移动端禁用最大化（Req 22.6）。
    if (isMobile()) return api;

    if (!instance.maximized) {
      // 最大化前保存当前矩形，供还原回写（Req 22.3）。
      instance.restoreRect = { ...instance.rect };
      instance.maximized = true;
      instance.el.classList.add("is-maximized");
      const work = getWorkArea();
      applyRect(instance, {
        left: 0,
        top: 0,
        width: work.width,
        height: work.height,
      });
    } else {
      // 还原到最大化之前的位置与尺寸（Req 22.3）。
      instance.maximized = false;
      instance.el.classList.remove("is-maximized");
      if (instance.restoreRect) {
        applyRect(instance, instance.restoreRect);
        instance.restoreRect = undefined;
      }
    }
    callHook(instance, "onResize"); // 任务 12.1：最大化/还原改变几何后通知内容渲染器重排
    return api;
  }

  /**
   * 将窗口标题栏的最大化控件（.xp-win-max）与双击标题栏接线到 toggleMaximize（Req 22.2/22.3）。
   * 不可最大化窗口（Main_Window，maximizable=false）不接线最大化按钮——toggleMaximize 自身
   * 也对其守卫，故双击其标题栏同样不会最大化（Req 22.5）。
   * @param {WindowInstance} instance
   */
  function wireMaximizeControl(instance) {
    const appDef = registryById.get(instance.appId);
    const maximizable = !(appDef && appDef.maximizable === false);

    // 最大化/还原按钮点击（Req 22.2/22.3）。
    if (maximizable) {
      const maxBtn = instance.el.querySelector(".xp-win-max");
      if (maxBtn) {
        maxBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          toggleMaximize(instance.instanceId);
        });
      }
    }

    // 双击标题栏表面（非控制按钮）等价于点击最大化/还原（Req 22.2/22.3）。
    const titlebar = instance.el.querySelector(".xp-win-titlebar");
    if (titlebar) {
      titlebar.addEventListener("dblclick", (ev) => {
        const target = ev.target;
        if (
          target &&
          typeof target.closest === "function" &&
          target.closest(".xp-win-controls")
        ) {
          return; // 控制按钮上的双击不触发最大化（Req 22.2 一致性）
        }
        toggleMaximize(instance.instanceId);
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 任务 10.1：键盘无障碍——Esc 关闭、Tab 焦点陷阱、控件键盘触发（Req 16.4/16.5/16.6）。
  //
  //   - Esc（Req 16.4）：当窗口处于聚焦状态且为可关闭窗口时，按 Esc 关闭它；
  //     不可关闭（无关闭控件）时不作处理。
  //   - Tab 焦点陷阱（Req 16.5）：聚焦窗口内 Tab / Shift+Tab 在该窗口的可交互
  //     元素之间循环移动焦点，首尾环绕（不会逃逸到窗口之外）。
  //   - 控件键盘触发（Req 16.6）：窗口控制按钮（最小化/最大化/关闭）为原生
  //     <button>，本就可键盘聚焦；此处显式以 Enter/Space 触发其动作，并
  //     preventDefault 抑制原生默认激活以避免重复触发（如最大化被来回切换）。
  //
  // 采用窗口元素级 keydown 监听（事件冒泡至 .xp-win），Esc/Tab 在此统一处理；
  // 控件 Enter/Space 在各控制按钮上单独接线，经 btn.click() 复用既有点击逻辑，
  // 保证行为单一来源且在合成事件环境（happy-dom）下亦可驱动与断言。
  // ════════════════════════════════════════════════════════════

  // 可聚焦元素选择器：原生可聚焦控件 + 显式正向 tabindex；排除禁用/负 tabindex。
  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  /**
   * 判断按键是否为「激活键」（Enter / Space）。Space 在不同环境下可能上报
   * " " 或 "Spacebar"。
   * @param {KeyboardEvent} ev
   * @returns {boolean}
   */
  function isActivationKey(ev) {
    return ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar";
  }

  /**
   * 收集窗口内当前可聚焦、可见、未隐藏的元素（按 DOM 顺序）。
   * @param {HTMLElement} winEl
   * @returns {HTMLElement[]}
   */
  function getFocusableElements(winEl) {
    const nodes = winEl.querySelectorAll(FOCUSABLE_SELECTOR);
    /** @type {HTMLElement[]} */
    const out = [];
    nodes.forEach((node) => {
      if (node.hidden) return;
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true")
        return;
      // 隐藏（display:none）的元素其内联样式 display 为 "none"——在合成环境下
      // 据此过滤最小化/隐藏控件外的不可见项。
      if (node.style && node.style.display === "none") return;
      out.push(node);
    });
    return out;
  }

  /**
   * 是否为可关闭窗口（存在关闭控件即视为可关闭，Req 16.4）。
   * @param {WindowInstance} instance
   * @returns {boolean}
   */
  function isClosable(instance) {
    return !!instance.el.querySelector(".xp-win-close");
  }

  /**
   * 窗口元素级 keydown：处理 Esc 关闭（Req 16.4）与 Tab 焦点陷阱（Req 16.5）。
   * @param {WindowInstance} instance
   * @param {KeyboardEvent} ev
   */
  function handleWindowKeydown(instance, ev) {
    // Esc 关闭：仅当该窗口为当前聚焦窗口且可关闭时（Req 16.4）。
    if (ev.key === "Escape" || ev.key === "Esc") {
      if (focusedInstanceId !== instance.instanceId) return;
      if (!isClosable(instance)) return; // 不可关闭 → 不作处理
      ev.preventDefault();
      close(instance.instanceId);
      return;
    }

    // Tab 焦点陷阱：在窗口内可交互元素之间循环，首尾环绕（Req 16.5）。
    if (ev.key === "Tab") {
      const focusables = getFocusableElements(instance.el);
      if (focusables.length === 0) return;
      const active = doc ? doc.activeElement : null;
      const idx = focusables.indexOf(active);
      let nextIdx;
      if (ev.shiftKey) {
        // 向前：在首个（或焦点不在窗口内）时环绕到末个。
        nextIdx = idx <= 0 ? focusables.length - 1 : idx - 1;
      } else {
        // 向后：在末个（或焦点不在窗口内）时环绕到首个。
        nextIdx = idx === focusables.length - 1 ? 0 : idx + 1;
      }
      ev.preventDefault();
      focusables[nextIdx].focus();
    }
  }

  /**
   * 接线窗口键盘无障碍（任务 10.1）：
   *   - 窗口元素级 keydown → Esc 关闭 + Tab 焦点陷阱（Req 16.4/16.5）
   *   - 控制按钮 keydown → Enter/Space 触发其点击动作（Req 16.6）
   * @param {WindowInstance} instance
   */
  function wireKeyboard(instance) {
    instance.el.addEventListener("keydown", (ev) =>
      handleWindowKeydown(instance, ev)
    );

    // 控制按钮 Enter/Space 触发（Req 16.6）。它们为原生 <button>，本就可键盘
    // 聚焦；此处显式触发并 preventDefault 抑制原生默认激活以避免重复触发。
    instance.el
      .querySelectorAll(".xp-win-controls .xp-win-btn")
      .forEach((btn) => {
        btn.addEventListener("keydown", (ev) => {
          if (!isActivationKey(ev)) return;
          ev.preventDefault();
          btn.click();
        });
      });
  }

  /**
   * 提升被聚焦窗口（API：按 instanceId 聚焦）。
   * @param {string} instanceId
   * @returns {WindowManager}
   */
  function focus(instanceId) {
    const instance = instances.get(instanceId);
    if (instance) focusInstance(instance);
    return api;
  }

  // ════════════════════════════════════════════════════════════
  // 任务 8.2：窗口关闭与焦点转移（Req 5）。
  //
  //   - 从桌面移除窗口 DOM（Req 5.1）
  //   - 从 Taskbar 移除该窗口的 Task_Button（Req 5.2）
  //   - 从实例表删除该实例，使「再次打开」走懒实例化创建新实例（Req 5.4）
  //   - 若被关闭者为当前聚焦窗口且仍有其它可见窗口，则聚焦剩余可见窗口中
  //     z-index 最高者（Req 5.3）
  // ════════════════════════════════════════════════════════════

  /**
   * 从 DOM 中移除一个元素（兼容 happy-dom 与无 .remove 的环境）。
   * @param {HTMLElement|null} node
   */
  function removeNode(node) {
    if (!node) return;
    if (typeof node.remove === "function") {
      node.remove();
    } else if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }

  /**
   * 关闭一个窗口（Req 5）。
   * @param {string} instanceId
   * @returns {WindowManager}
   */
  function close(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return api;

    const wasFocused = focusedInstanceId === instanceId;

    // 任务 12.1：关闭前通知内容渲染器清理（订阅/计时器等），早于移除 DOM。
    callHook(instance, "onClose");

    // 移除窗口 DOM（Req 5.1）与 Task_Button（Req 5.2）。
    removeNode(instance.el);
    removeNode(instance.taskButtonEl);
    instance.taskButtonEl = null;

    // 从实例表删除：再次打开经 openOrFocus 将创建新实例（Req 5.4）。
    instances.delete(instanceId);
    if (focusedInstanceId === instanceId) focusedInstanceId = null;

    // 焦点转移（Req 5.3）：仅当被关闭者为聚焦窗口且仍有可见窗口时，
    // 聚焦剩余可见窗口中 z-index 最高者。
    if (wasFocused) {
      let top = null;
      for (const inst of instances.values()) {
        if (inst.state !== "visible") continue;
        if (!top || inst.z > top.z) top = inst;
      }
      if (top) {
        focusInstance(top);
        return api;
      }
    }

    syncTaskButtons();
    return api;
  }

  // ════════════════════════════════════════════════════════════
  // 任务 7.3：点击聚焦与 z-index 堆叠（pointerdown 捕获阶段）。
  //
  // 任意窗口在「捕获阶段」收到 pointerdown 时立即聚焦：被点窗口取新的最高
  // z-index 并加 .is-active 标题栏类，其余窗口移除该类（Req 3.1/3.2/3.3），
  // 任意时刻至多一个活动窗口（Req 3.4）。
  //
  // 采用 desktopEl 上的「事件委托 + 捕获阶段」单一监听，使所有窗口（含此后
  // 懒实例化的窗口）自动获得点击聚焦行为，无需逐窗口绑定。捕获阶段确保焦点
  // 提升先于窗口内部控件（拖动、按钮等）的冒泡处理发生。
  // ════════════════════════════════════════════════════════════

  /**
   * desktopEl 捕获阶段 pointerdown 处理：将被点窗口提升到最上层并聚焦。
   * @param {Event} ev
   */
  function handlePointerDownCapture(ev) {
    const target = ev.target;
    if (!target || typeof target.closest !== "function") return;
    const winEl = target.closest(".xp-win");
    if (!winEl) return;
    const instanceId = winEl.dataset ? winEl.dataset.instanceId : null;
    if (!instanceId) return;
    const instance = instances.get(instanceId);
    if (!instance) return;
    focusInstance(instance);
  }

  /**
   * 统一入口：打开或聚焦（Req 7、18.5）。
   *   - 单实例且已可见 → 聚焦现有实例，不创建副本（Req 7.1）
   *   - 单实例且已最小化 → 还原并聚焦现有实例（Req 7.2）
   *   - 不存在 → 按 App_Definition 懒实例化后聚焦（Req 8.8/8.9）
   * 三套启动入口（桌面图标/开始菜单/主窗口操作）共用本入口（Req 18.5）。
   * @param {string} appId
   * @param {Object} [opts] 透传给内容渲染器（任务 12 起使用）
   * @returns {WindowInstance}
   */
  function openOrFocus(appId, opts = {}) {
    const appDef = registryById.get(appId);
    if (!appDef) {
      throw new Error(`WindowManager.openOrFocus: unknown appId "${appId}"`);
    }

    // 单实例：复用已存在实例（本设计全部窗口均单实例，Req 7.3）。
    const existing =
      appDef.singleInstance === false ? null : api.findInstanceByAppId(appId);

    if (existing) {
      if (existing.state === "minimized") showInstance(existing); // 还原（Req 7.2）
      existing.lastOpts = opts;
      focusInstance(existing); // 置顶并聚焦（Req 7.1）
      return existing;
    }

    // 不存在 → 懒实例化（Req 8.8/8.9）。
    return openNew(appDef, opts);
  }

  /**
   * 初始化窗口管理器：绑定全局事件，非移动端自动仅打开 Main_Window（Req 8.1）。
   * 不预实例化任何其他窗口（懒实例化，Req 8.8/8.9）。幂等。
   * @returns {WindowManager}
   */
  function init() {
    if (initialized) return api;
    initialized = true;

    // 点击聚焦与 z-index 堆叠（任务 7.3）：在 desktopEl 上以捕获阶段委托监听
    // pointerdown，使任意窗口（含此后懒实例化者）被点击时自动置顶并聚焦
    // （Req 3.1/3.2/3.3/3.4）。
    if (desktopEl && typeof desktopEl.addEventListener === "function") {
      desktopEl.addEventListener("pointerdown", handlePointerDownCapture, true);
    }

    // 其余全局事件绑定的扩展点：
    //   - 最大化几何随视口/任务栏变化的重算 → 任务 9.3

    // 非移动端：自动「仅」实例化并打开主窗口（Req 8.1）。其余窗口保持懒实例化。
    if (!isMobile()) {
      openOrFocus("main");
    }

    return api;
  }

  /** @typedef {Object} WindowManager */
  const api = {
    // 注册与实例化（任务 7.1）
    register,
    instantiate,

    // 查询辅助（供后续任务复用）
    getRegistry: () => registryById,
    getInstances: () => instances,
    getAppDefinition: (id) => registryById.get(id),
    findInstanceByAppId: (appId) => {
      for (const inst of instances.values()) {
        if (inst.appId === appId) return inst;
      }
      return undefined;
    },
    getFocusedInstance: () =>
      focusedInstanceId ? instances.get(focusedInstanceId) : undefined,

    // 暴露注入的协作对象，供后续任务使用
    desktopEl,
    taskbarEl,
    isMobile,
    i18n,

    // 后续任务填充的生命周期方法（保持对外 API 形状稳定）
    openOrFocus, // 任务 7.2
    focus, // 任务 7.2（最小可用）/ 7.3 细化点击聚焦与堆叠
    close: close, // 任务 8.2
    minimize, // 任务 8.1
    restore, // 任务 8.1
    toggleMaximize, // 任务 9.3
    init, // 任务 7.2
  };

  // 注册初始 registry。
  for (const appDef of registry) register(appDef);

  return api;
}

export default createWindowManager;
