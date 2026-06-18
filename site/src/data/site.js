// ════════════════════════════════════════════════════════════
// 站点配置 —— 由 content.json 自动派生（主题 / 头像 / 联系方式 / 产品 / 推荐问题）。
// ⚠️ 不要在这里改内容！请改 src/content/content.json，本文件会自动读取。
// 图标 SVG 路径属于结构性代码，仍保留在本文件 icons 中。
// ════════════════════════════════════════════════════════════
import content from "../config/content.json";

export const SITE = {
  theme: {
    accent: content.theme?.accent || "#0284C7",
    accent2: content.theme?.accent2 || "#06B6D4",
  },
  profile: { avatar: content.profile?.avatar || "" },
  contacts: content.contacts?.items || [],
  products: content.products?.items || [],
  chips: content.chips?.items || [],
};

// 联系图标 SVG 路径（Lucide 风格）。content.json 的 contacts[].icon 引用这里的 key。
export const icons = {
  phone:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  wechat:    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  mail:      '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/>',
  megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
};
