"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) location.href = "/";
    else setError((await res.json().catch(() => ({}))).error || "登录失败");
  }

  return (
    <main className="wrap">
      <form className="card login" onSubmit={submit}>
        <h1>AI 翻唱工坊</h1>
        <label className="field">
          访问密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <button className="primary" type="submit">
          进入
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
