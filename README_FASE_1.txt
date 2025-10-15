FASE 1 — Catálogo Maestro (solo SUPERSU)
=======================================

Este update agrega:
- Tablas de Catálogo Maestro (Category/Product/Presentation) en Prisma.
- Endpoints API para crear/listar/editar (solo SUPERSU para crear/editar).
- UI mínima para gestionar categorías y productos desde la sesión SUPERSU.
- Seed ampliado con categorías base (si no existen).

PASOS
-----
1) Reemplaza prisma/schema.prisma por PRISMA_SCHEMA_1.prisma (o fusiona si ya añadiste cosas).
2) Copia app/electron/api.catalog.js y **importa** desde api.js (instrucciones abajo).
3) Reemplaza/actualiza app/scripts/seed.mjs por el SEED_1.mjs (idempotente).
4) Agrega app/src/ui/CatalogApp.jsx y actualiza LoginApp.jsx con LOGIN_APP_PATCH.jsx.
5) Ejecuta:
   npx prisma generate
   npx prisma db push
   npm run seed
   npm run dev

PARCHE en api.js
----------------
Opción rápida: reemplaza tu `app/electron/api.js` por `API_JS_MERGED_SUGERIDO.js` de este paquete.
(Contiene login, bitácora, /api/me y la instalación del catálogo).

Login de prueba:
- SU0001 / 1234 (rol SUPERSU) → verás el botón "Catálogo Maestro".
