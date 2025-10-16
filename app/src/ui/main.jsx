// app/src/main.jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import LoginApp from "./LoginApp.jsx";       // default export
import CatalogApp from "./CatalogApp.jsx";   // default export
import ReceiptsApp from "./ReceiptsApp.jsx"; // default export
import TechApp from "./TechApp.jsx";         // default export (aperturas técnicas)
import SalesApp from "./SalesApp.jsx";
import InventoryApp from "./InventoryApp.jsx";
import LabApp from "./LabApp.jsx";
import ReportsApp from "./ReportsApp.jsx";
import "./style.css";

const API = "http://localhost:8787";

// Solo consulta /api/me si ya hay token
async function fetchMe(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${API}/api/me`, {
      headers: { "x-session": token }
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.user ?? null;
  } catch {
    return null;
  }
}

function Home({
  user,
  onGotoCatalog,
  onGotoReceipts,
  onGotoTech,
  onGotoSales,
  onGotoInventory,
  onGotoLab,
  onGotoReports,
  onLogout,
  onAudit,
}) {
  return (
    <div style={{ padding: 24 }}>
      <h1>
        Bienvenido, {user?.name}{" "}
        <small style={{ opacity: 0.7 }}>
          ({user?.code} · {user?.role})
        </small>
      </h1>
      <p>Fase 3: Recepciones + Aperturas técnicas (helado/toppings) listas.</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onAudit}>Registrar bitácora de prueba</button>

        {/* Catálogo Maestro: solo SUPERSU */}
        {user?.role === "SUPERSU" && (
          <button onClick={onGotoCatalog}>Catálogo Maestro</button>
        )}

        {/* Recepciones: CAJERO, ADMIN y SUPERSU */}
        {(user?.role === "CAJERO" || user?.role === "ADMIN" || user?.role === "SUPERSU") && (
          <>
            <button onClick={onGotoReceipts}>Recepciones</button>
            <button onClick={onGotoSales}>Ventas (POS)</button>
            <button onClick={onGotoInventory}>Conversiones</button>
          </>
        )}

        {/* Técnico (aperturas helado/toppings): CAJERO, ADMIN y SUPERSU */}
        {(user?.role === "CAJERO" ||
          user?.role === "ADMIN" ||
          user?.role === "SUPERSU") && (
          <button onClick={onGotoTech}>Técnico (aperturas)</button>
        )}

        {(user?.role === "ADMIN" || user?.role === "SUPERSU") && (
          <>
            <button onClick={onGotoLab}>Laboratorio</button>
            <button onClick={onGotoReports}>Reportes</button>
          </>
        )}

        <button onClick={onLogout}>Cerrar sesión</button>
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("home"); // home | catalog | receipts | tech | sales | inventory | lab | reports
  const [loading, setLoading] = useState(true);

  // Carga el usuario al arrancar o cuando cambie el token
  useEffect(() => {
    (async () => {
      setLoading(true);
      const u = await fetchMe(token);
      setUser(u);
      setLoading(false);
    })();
  }, [token]);

  // Se llama cuando el Login termina bien
  function handleLogged(newToken) {
    localStorage.setItem("token", newToken);
    setToken(newToken);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setScreen("home");
  }

  async function auditTest() {
    try {
      const r = await fetch(`${API}/api/audit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session": token || ""
        },
        body: JSON.stringify({
          module: "home",
          action: "test_log",
          before: { hello: "world" },
          after: { ok: true },
          comment: "Bitácora de prueba desde Home"
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error audit");
      alert("Bitácora registrada id=" + j.id);
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Cargando…</div>;

  // Sin usuario => mostrar Login
  if (!user) return <LoginApp onLogged={handleLogged} />;

  if (screen === "catalog") {
    return (
      <div style={{ padding: 24 }}>
        <button onClick={() => setScreen("home")}>← Volver</button>
        <CatalogApp />
      </div>
    );
  }

  if (screen === "receipts") {
    return <ReceiptsApp onBack={() => setScreen("home")} />;
  }

  if (screen === "tech") {
    return <TechApp onBack={() => setScreen("home")} />;
  }

  if (screen === "sales") {
    return <SalesApp token={token} onBack={() => setScreen("home")} />;
  }

  if (screen === "inventory") {
    return <InventoryApp token={token} onBack={() => setScreen("home")} />;
  }

  if (screen === "lab") {
    return <LabApp token={token} onBack={() => setScreen("home")} />;
  }

  if (screen === "reports") {
    return <ReportsApp token={token} onBack={() => setScreen("home")} />;
  }

  return (
    <Home
      user={user}
      onGotoCatalog={() => setScreen("catalog")}
      onGotoReceipts={() => setScreen("receipts")}
      onGotoTech={() => setScreen("tech")}
      onGotoSales={() => setScreen("sales")}
      onGotoInventory={() => setScreen("inventory")}
      onGotoLab={() => setScreen("lab")}
      onGotoReports={() => setScreen("reports")}
      onLogout={handleLogout}
      onAudit={auditTest}
    />
  );
}

createRoot(document.getElementById("root")).render(<App />);
