"use client";

import { useEffect, useRef, useState } from "react";
import "./desktop-widget-settings.css";

const taskAuthorization = "/api/desktop-widget/authorization";
const yiyanAuthorization = "/api/yiyan/desktop/authorization";

function AuthorizationPanel({ yiyan = false }: { yiyan?: boolean }) {
  const endpoint = yiyan ? yiyanAuthorization : taskAuthorization;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [canPair, setCanPair] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          setConnected(data.connected);
          setCanPair(data.canPair ?? true);
        }
      } catch { /* The authorization controls can still be retried. */ }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [endpoint]);

  async function changeAuthorization(method: "POST" | "DELETE") {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(endpoint, { method, cache: "no-store" });
      if (response.status === 401) throw new Error("登录已过期，请刷新页面后登录。");
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (yiyan && response.status === 409) setCanPair(false);
        throw new Error(result.error || "暂时无法更新桌面授权，请稍后重试。");
      }
      if (method === "POST") {
        setCode(result.code);
        setNotice("配对码可使用一次，最长有效 5 分钟。");
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

  return <section className="widgetAuthorization" id={yiyan ? "yiyan" : undefined}>
      <h2>{yiyan ? "一言 · YAN" : "序流 · 当下"}</h2>
      <p>{connected === null ? "正在读取授权状态…" : connected ? "已授权" : "未授权"}</p>
      <p>{yiyan
        ? "授权后，桌面组件可以换句、看原图、浏览文集和收藏。授权随配对时的一言登录到期，可单独撤销。"
        : "授权后，桌面组件可以查看今日任务和近期截止，并勾选任务。授权长期有效，可在这里撤销。重新配对会替换原授权。"}</p>
      {yiyan && canPair === false && <p><a href="/">去序流侧栏登录一言</a>后再回来配对。</p>}
      <button type="button" className="loginButton" disabled={busy || (yiyan && canPair === false)} onClick={() => void changeAuthorization("POST")}>生成配对码</button>
      {code && <div className="widgetSettingsCode"><input ref={field} aria-label={yiyan ? "一言桌面配对码" : "当下桌面配对码"} value={code} readOnly autoComplete="off" spellCheck={false} />
        <button type="button" className="softButton" onClick={() => void copyCode()}>复制</button></div>}
      <p className="widgetSettingsNotice" role="status">{notice}</p>
      {connected !== false && <button type="button" className="textButton" disabled={busy} onClick={() => void changeAuthorization("DELETE")}>撤销桌面授权</button>}
  </section>;
}

export default function DesktopWidgetSettings({ accountName }: { accountName: string }) {
  return <main className="authPage">
    <section className="loginCard widgetSettings">
      <a href="/">← 返回序流</a>
      <h1>桌面组件授权</h1>
      <p>{accountName}</p>
      <AuthorizationPanel />
      <AuthorizationPanel yiyan />
    </section>
  </main>;
}
