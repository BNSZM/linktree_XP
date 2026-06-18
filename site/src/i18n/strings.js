// 双语文案字典 —— 由 content.json 自动派生，供服务端首屏渲染与客户端切换共用。
// ⚠️ 不要在这里改文案！所有文案请改 src/content/content.json，本文件会自动读取。
import content from "../config/content.json";

export const DEFAULT_LANG = "zh";
export const LANGS = ["zh", "en"];

// 把 content.json 里分区块的 {zh,en} 文案，摊平成 strings[lang]["区块.key"] 结构，
// 保持页面原有的 data-i18n="meta.title" 等绑定方式不变。
function buildStrings() {
  const out = { zh: {}, en: {} };
  const put = (key, pair) => {
    if (pair && typeof pair === "object" && ("zh" in pair || "en" in pair)) {
      out.zh[key] = pair.zh ?? pair.en ?? "";
      out.en[key] = pair.en ?? pair.zh ?? "";
    }
  };

  // profile.name / profile.tagline
  put("profile.name", content.profile?.name);
  put("profile.tagline", content.profile?.tagline);

  // meta.title / meta.desc
  put("meta.title", content.meta?.title);
  put("meta.desc", content.meta?.desc);

  // ui.* → 扁平 key（保持原有命名）
  const ui = content.ui || {};
  put("lang.next", ui.langNext);
  put("lang.label", ui.langLabel);
  put("toast.copied", ui.toastCopied);
  put("products.title", ui.productsTitle);
  put("foot.note", ui.footNote);
  put("copy.hint", ui.copyHint);
  put("ui.aboutLabel", ui.aboutLabel);
  put("ui.chatSection", ui.chatSection);

  // chat.*
  const chat = content.chat || {};
  put("chat.eyebrow", chat.eyebrow);
  put("chat.entry", chat.entry);
  put("chat.title", chat.title);
  put("chat.placeholder", chat.placeholder);
  put("chat.greeting", chat.greeting);
  put("chat.error", chat.error);
  put("chat.close", chat.close);

  // windows.* → 各窗口标题栏文案
  const windows = content.windows || {};
  put("windows.mainTitle", windows.mainTitle);
  put("windows.notepadTitle", windows.notepadTitle);
  put("windows.myComputer", windows.myComputer);
  put("windows.myDocuments", windows.myDocuments);
  put("windows.controlPanel", windows.controlPanel);
  put("windows.helpTitle", windows.helpTitle);

  // PDF 窗口标题 → 取自 products 条目标题（与 PDF 顺序一致：海外中转 / FastGPT / Microsoft 365），
  // 使 PDF_Window 标题栏显示其所嵌入文档的名称，仍以 content.json 为唯一来源。
  const productItems = content.products?.items || [];
  put("windows.pdfOverseas", productItems[0]?.title);
  put("windows.pdfFastgpt", productItems[1]?.title);
  put("windows.pdfM365", productItems[2]?.title);

  // notepad.* → 留言板窗口文案
  const notepad = content.notepad || {};
  put("notepad.nickname", notepad.nickname);
  put("notepad.anonymous", notepad.anonymous);
  put("notepad.placeholder", notepad.placeholder);
  put("notepad.submit", notepad.submit);
  put("notepad.empty", notepad.empty);
  put("notepad.tooLong", notepad.tooLong);
  put("notepad.loadError", notepad.loadError);
  put("notepad.saveError", notepad.saveError);
  put("notepad.rateLimited", notepad.rateLimited);

  // controlPanel.* → 控制面板窗口文案
  const controlPanel = content.controlPanel || {};
  put("controlPanel.language", controlPanel.language);
  put("controlPanel.reducedMotion", controlPanel.reducedMotion);

  return out;
}

export const strings = buildStrings();

// 取某语言的文案，缺失回退到中文
export function t(lang, key) {
  return (strings[lang] && strings[lang][key]) ?? strings[DEFAULT_LANG][key] ?? key;
}
