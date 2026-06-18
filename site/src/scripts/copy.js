// ════════════════════════════════════════════════════════════
// copy 模块 —— 联系方式图标点击复制到剪贴板 + Toast 提示
// 从 index.astro 的 <script> 块抽离（Phase 6 架构重构）
//
// 依赖: i18n 模块的 S()（取 toast 文案）与 toast()（浮动提示）
// 导出: initCopy({ S, toast })
// ════════════════════════════════════════════════════════════
export function initCopy({ S, toast }) {
  const links = document.getElementById("links");
  if (!links) return;

  links.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-copy]");
    if (!el) return;
    e.preventDefault();
    const text = el.getAttribute("data-copy");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(S("toast.copied") + "：" + text);
  });
}
