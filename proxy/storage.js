// 留言板 JSON 文件存储（零依赖：node:fs）
//
// 设计要点（design.md §4 存储健壮性 / Req 17.4, 20.3, 20.4, 20.17）：
//   - 顶层结构 { version, items }，version 当前为 1。
//   - 读取：文件缺失/损坏 → 回退为空集合（不抛错），并在下次写入时惰性重建。
//   - 写入：先写同目录临时文件再用 fs.renameSync 原子替换，避免半写损坏。
//   - 写操作经内存队列串行化（写锁），避免并发读改写交错。
//   - 存储路径取自 MESSAGES_FILE（默认 ./data/messages.json），按调用惰性读取，
//     便于测试在每次迭代指向独立的临时文件以隔离。
//
// 本模块被 server.js 导入，并供后续 REST 端点（18.x）与属性/单元测试复用。
import fs from "node:fs";
import path from "node:path";

export const STORE_VERSION = 1;

/** 解析当前存储文件路径（每次调用惰性读取环境变量，方便测试覆盖）。 */
export function getMessagesFile() {
  return process.env.MESSAGES_FILE || path.join(".", "data", "messages.json");
}

/** 构造一个空存储结构。 */
export function emptyStore() {
  return { version: STORE_VERSION, items: [] };
}

/** 将任意解析结果规范化为合法的 { version, items } 结构。 */
function normalizeStore(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    return emptyStore();
  }
  const version =
    Number.isInteger(parsed.version) && parsed.version > 0
      ? parsed.version
      : STORE_VERSION;
  return { version, items: parsed.items };
}

/**
 * 读取存储。文件缺失或内容损坏时回退为空集合（不抛错）。
 * 重建是惰性的：空集合不会立即落盘，待下一次写入再原子重建。
 */
export function readStore(file = getMessagesFile()) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    // 文件不存在 / 不可读 → 空集合。
    return emptyStore();
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    // JSON 损坏 → 空集合。
    return emptyStore();
  }
}

/**
 * 原子写入存储：写入同目录下的临时文件后用 fs.renameSync 覆盖目标文件。
 * 临时文件与目标文件位于同一目录，确保 rename 是同一文件系统上的原子替换。
 * 写入前确保父目录存在（惰性重建）。
 */
export function writeStore(store, file = getMessagesFile()) {
  const normalized = normalizeStore(store);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  const data = JSON.stringify(normalized, null, 2);
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    // 失败时尽量清理临时文件，避免残留。
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
  return normalized;
}

// --- 内存写锁：把写操作串行化为一条 Promise 队列，避免并发读改写交错 ---
let writeChain = Promise.resolve();

/**
 * 在写锁下串行执行 task（可为同步或返回 Promise 的异步函数）。
 * 返回一个 Promise，解析为 task 的返回值；task 抛错不会中断后续排队任务。
 */
export function withWriteLock(task) {
  const run = writeChain.then(() => task());
  // 让队列在成功/失败后都能继续，但调用方仍能拿到本次的结果/错误。
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * 在写锁下做一次原子的“读 → 改 → 写”。
 * mutator 接收当前 store，可原地修改 store.items（或返回新 store 由其覆盖），
 * 其返回值将作为 mutateStore 的解析值传回（如新建的留言项）。
 */
export function mutateStore(mutator, file = getMessagesFile()) {
  return withWriteLock(() => {
    const store = readStore(file);
    const result = mutator(store);
    writeStore(store, file);
    return result;
  });
}
