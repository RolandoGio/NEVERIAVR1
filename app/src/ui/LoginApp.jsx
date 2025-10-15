// app/src/LoginApp.jsx
import React, { useState } from "react";

const API = "http://localhost:8787";

export default function LoginApp({ onLogged }) {
  const [code, setCode] = useState("SU0001");
  const [password, setPassword] = useState("1234");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function login(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("Conectando…");
    try {
      const r = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error de autenticación");

      // Unificamos la clave del token
      localStorage.setItem("token", j.token);
      // Limpia tokens antiguos si quedara alguno
      localStorage.removeItem("sessionToken");
      localStorage.removeItem("session");

      setMsg("¡Login OK!");
      if (typeof onLogged === "function") onLogged(j.token);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: "Inter, system-ui, Arial", padding: 24, maxWidth: 420 }}>
      <h1>Login — Fase 0.2</h1>
      <p>
        Prueba con: SU0001 / AD0001 / CJ0001 — contraseña <b>1234</b>
      </p>
      <form onSubmit={login}>
        <label>Código</label>
        <input
          style={{ width: "100%", padding: 8 }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />

        <label style={{ marginTop: 8, display: "block" }}>Contraseña</label>
        <input
          type="password"
          style={{ width: "100%", padding: 8 }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button disabled={busy} style={{ marginTop: 12, padding: "8px 12px" }}>
          {busy ? "Ingresando…" : "Entrar"}
        </button>
      </form>

      <p>{msg}</p>
    </div>
  );
}
