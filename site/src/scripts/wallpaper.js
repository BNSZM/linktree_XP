// ════════════════════════════════════════════════════════════
// wallpaper 模块 —— 壁纸轮换管理
// 提供壁纸列表和切换函数，供桌面"下一张壁纸"图标调用。
// ════════════════════════════════════════════════════════════

/** 壁纸候选列表 */
const WALLPAPERS = [
  "/images/wp-1-bliss.png",
  "/images/wp-2-autumn.png",
  "/images/wp-3-aztec.png",
  "/images/wp-4-follow.png",
  "/images/wp-5-redmoon.png",
];

let currentIndex = 0;

/**
 * 切换到下一张壁纸（循环轮换）。
 * 使用淡出 → 换图 → 淡入的过渡效果。
 */
export function nextWallpaper() {
  const el = document.getElementById("pixelBliss");
  if (!el) return;

  currentIndex = (currentIndex + 1) % WALLPAPERS.length;

  // 预加载下一张图片，避免闪烁
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url('${WALLPAPERS[currentIndex]}')`;
  };
  img.src = WALLPAPERS[currentIndex];
}

/**
 * 预加载所有壁纸图片，确保切换时无延迟。
 */
export function preloadWallpapers() {
  WALLPAPERS.forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}
