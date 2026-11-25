"use client";

import { useEffect, useRef, useState } from "react";
import "./desktop-widget-settings.css";

const taskAuthorization = "/api/desktop-widget/authorization";
const yiyanAuthorization = "/api/yiyan/desktop/authorization";
const authorizationDetails = {
  tasks: { name: "序流 · 当下", codeLabel: "当下桌面配对码", endpoint: taskAuthorization,
    help: "授权后，桌面组件可以查看今日任务和近期截止，并勾选任务。授权长期有效，可在这里撤销。重新配对会替换原授权。" },
  yiyan: { name: "一言 · YAN", codeLabel: "一言桌面配对码", endpoint: yiyanAuthorization,
    help: "授权后，桌面组件可以换句、看原图、浏览文集和收藏。授权随配对时的一言登录到期，可单独撤销。" },
  collectionbox: { name: "序流 · CollectionBox", codeLabel: "CollectionBox 桌面配对码",
    endpoint: `${taskAuthorization}?widget=collectionbox`,
    help: "授权后，桌面组件可以浏览网站合集、整理链接，并在序流里新增灵感。可在这里单独撤销授权。" },
};

function AuthorizationPanel({ widget }: { widget: keyof typeof authorizationDetails }) {
  const { endpoint, name, codeLabel, help } = authorizationDetails[widget];
  const yiyan = widget === "yiyan";
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

  return <section className="widgetAuthorization" id={widget}>
      <h2>{name}</h2>
      <p>{connected === null ? "正在读取授权状态…" : connected ? "已授权" : "未授权"}</p>
      <p>{help}</p>
      {yiyan && canPair === false && <p><a href="/">去序流侧栏登录一言</a>后再回来配对。</p>}
      <button type="button" className="loginButton" disabled={busy || (yiyan && canPair === false)} onClick={() => void changeAuthorization("POST")}>生成配对码</button>
      {code && <div className="widgetSettingsCode"><input ref={field} aria-label={codeLabel} value={code} readOnly autoComplete="off" spellCheck={false} />
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
      <AuthorizationPanel widget="tasks" />
      <AuthorizationPanel widget="yiyan" />
      <AuthorizationPanel widget="collectionbox" />
    </section>
  </main>;
}
