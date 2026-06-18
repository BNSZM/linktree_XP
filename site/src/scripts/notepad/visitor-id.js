/**
 * Visitor_Id 工具
 *
 * 在 localStorage 中持久化一个 `crypto.randomUUID()` 生成的访客标识。
 * 首次访问时惰性生成并写入，之后返回同一标识。
 *
 * 作为留言板的尽力而为归属标识（ownerId），非安全边界。
 *
 * _Requirements: 20.7_
 */

const VISITOR_ID_KEY = "visitor-id";

/**
 * 返回持久化的访客标识。首次访问惰性生成 `crypto.randomUUID()` 并存入 localStorage。
 * @returns {string} 持久化的访客 UUID
 */
/**
 * 生成一个尽力而为的唯一标识。优先使用 crypto.randomUUID()（安全上下文），
 * 降级为基于 Math.random 的 UUID-v4 格式。
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 格式降级
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage 不可用时每次生成新 ID（不持久化，但功能不中断）
    return generateId();
  }
}
