"use client";

import { useEffect, useRef, useState } from "react";
import "./desktop-widget-settings.css";

const endpoint = "/api/desktop-widget/authorization";

export default function DesktopWidgetSettings({ accountName }: { accountName: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (response.ok) setConnected((await response.json()).connected);
      } catch { /* The authorization controls can still be retried. */ }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, []);

  async function changeAuthorization(method: "POST" | "DELETE") {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(endpoint, { method, cache: "no-store" });
      if (response.status === 401) throw new Error("登录已过期，请刷新页面后登录。");
      if (!response.ok) throw new Error("暂时无法更新桌面授权，请稍后重试。");
      const result = await response.json();
      if (method === "POST") {
        setCode(result.code);
        setNotice("配对码可使用一次，有效期 5 分钟。");
      } else {
        setCode("");
        setConnected(false);
        setNotice("已撤销桌面授权。");
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "授权操作失败。");
    } finally { setBusy(false); }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("已复制。回到 Spacedash 粘贴配对码。");
    } catch {
      field.current?.select();
      setNotice("按 Ctrl+C 复制选中的配对码。");
    }
  }

  return <main className="authPage">
    <section className="loginCard widgetSettings">
      <a href="/">← 返回序流</a>
      <h1>桌面组件授权</h1>
      <p>{accountName} · {connected === null ? "序流 · 当下" : connected ? "已授权" : "未授权"}</p>
      <p>将配对码填入 Spacedash 后，组件可查看今日任务与近期截止，并勾选任务完成。授权长期有效，可在此撤销。完成新的配对会替换原有授权。</p>
      <button className="loginButton" disabled={busy} onClick={() => void changeAuthorization("POST")}>生成配对码</button>
      {code && <div className="widgetSettingsCode"><input ref={field} aria-label="桌面配对码" value={code} readOnly autoComplete="off" spellCheck={false} />
        <button type="button" className="softButton" onClick={() => void copyCode()}>复制</button></div>}
      <p className="widgetSettingsNotice" role="status">{notice}</p>
      {connected !== false && <button type="button" className="textButton" disabled={busy} onClick={() => void changeAuthorization("DELETE")}>撤销桌面授权</button>}
    </section>
  </main>;
}
