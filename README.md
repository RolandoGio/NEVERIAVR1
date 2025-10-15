# Heladería — Fase 0.1 (Bootstrap)

Este paquete arranca una app **local-first** con **Electron + React + SQLite/Prisma** y carga **feature flags** desde JSON.
Servirá como base para las siguientes fases.

## Requisitos
- Node.js 18+
- npm 9+

## Instalación
```bash
npm install
npx prisma generate
npm run dev
```

Se abrirá una ventana de Electron con la pantalla **"Fase 0.1 ✅"** y verás los **feature flags** precargados.
Para compilar el UI (sin empaquetar Electron):
```bash
npm run build
```

## Estructura
- `app/electron/main.js` → proceso principal de Electron
- `app/src/ui` → React (Vite)
- `app/config` → configuración (feature flags, promos, params)
- `prisma/schema.prisma` → esquema SQLite (se completará en Fase 0.2)
- `app/scripts/seed.mjs` → seed pendiente (Fase 0.2)

## Próximo
**Fase 0.2**: autenticación por roles (CJ/AD/SU) y bitácora real con `AuditLog`.
