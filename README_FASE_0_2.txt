FASE 0.2 — Instrucciones (login por roles + bitácora real)

1) package.json (merge dependencias):
   "dependencies": {
     "@prisma/client": "^5.17.0",
     "react": "^18.2.0",
     "react-dom": "^18.2.0",
     "express": "^4.19.2",
     "bcryptjs": "^2.4.3",
     "cors": "^2.8.5"
   }

2) Reemplaza prisma/schema.prisma por PRISMA_SCHEMA_0_2.prisma

3) En terminal (carpeta del proyecto):
   npx prisma generate
   npx prisma db push
   npm run seed

4) Reemplaza app/electron/main.js por MAIN_JS_0_2_SUGERIDO.js

5) Copia app/electron/api.js, app/src/ui/LoginApp.jsx y app/src/ui/main.jsx

6) Ejecuta:
   npm install
   npm run dev

Login de prueba (pass: 1234):
- SU0001 (SUPERSU)
- AD0001 (ADMIN)
- CJ0001 (CAJERO)
