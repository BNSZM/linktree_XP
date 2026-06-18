// 对话 provider 抽象 —— 当前实现：调用本站 /api/chat（由 Node 代理转发 FastGPT）
// 未来换 Hermes 等后端：只改代理层，本文件零改动；要换前端调用方式也只改这里。
export const chatProvider = {
  endpoint: "/api/chat",

  // messages: [{role, content}]; handlers: { onToken, onDone, onError, signal }
  async stream(messages, { onToken, onDone, onError, signal } = {}) {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
        signal,
      });
      if (!res.ok || !res.body) {
        onError?.(new Error("HTTP " + res.status));
        return;
      }
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          onDone?.();
        }
      };
      const fail = (err) => {
        if (!settled) {
          settled = true;
          onError?.(err);
        }
      };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            const data = m[1];
            if (data === "[DONE]") {
              done();
              return;
            }
            try {
              const j = JSON.parse(data);
              const tok = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
              if (tok) onToken?.(tok);
            } catch {
              /* 忽略心跳/非 JSON 行 */
            }
          }
        }
      }
      done();
    } catch (e) {
      if (e?.name !== "AbortError") onError?.(e);
    }
  },
};
