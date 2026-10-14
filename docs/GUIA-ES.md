# Guía paso a paso (Windows CMD + VS Code)

## 0. Requisitos (una sola vez)

- **Node.js 22 LTS**: https://nodejs.org. Para verificarlo en CMD:
  ```cmd
  node -v
  npm -v
  ```
- **Git**: https://git-scm.com
- Cuentas gratis en **GitHub**, **Vercel**, **Koyeb** y **Neon**. Puedes entrar a las cuatro con GitHub.

## 1. Correrlo en tu PC

Descomprime el ZIP, por ejemplo en `C:\proyectos\grpc-coffee-auction`.

```cmd
cd C:\proyectos\grpc-coffee-auction
code .
npm install
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:8080/healthz

Sin base de datos el servidor usa memoria, y los bots internos ya están pujando.
Si quieres lanzar bots desde tu PC, abre **otra** terminal CMD:

```cmd
npm run bots -- --count 4
```

Para correr las pruebas (31 tests):

```cmd
npm test
```

## 2. Subirlo a GitHub

1. En github.com: **New repository** → nombre `grpc-coffee-auction` → **Public** → *Create* (sin README).
2. En CMD, dentro de la carpeta del proyecto:

```cmd
git init -b main
git add .
git commit -m "feat: gRPC coffee micro-lot auction (contract-first)"
git remote add origin https://github.com/TU_USUARIO/grpc-coffee-auction.git
git push -u origin main
```

GitHub Actions corre solo el CI (lint del contrato, typecheck, tests y builds). Lo ves en la pestaña **Actions**.

## 3. Base de datos en Neon (gratis)

1. https://neon.tech → *Create project* (región US East o Europa).
2. *Connection string* → copia la que empieza por `postgresql://...` y termina en `sslmode=require`.

Las tablas se crean solas: el servidor corre las migraciones al arrancar.

## 4. Backend en Koyeb (gratis, soporta HTTP/2 y gRPC)

1. https://app.koyeb.com → **Create Web Service** → **GitHub** → elige el repo.
2. **Builder**: *Dockerfile* (está en la raíz del repo).
3. **Instance**: *Free*.
4. **Ports**: puerto `8000`, protocolo **HTTP/2**. Esto es clave para gRPC nativo.
5. **Environment variables**:
   | Nombre | Valor |
   |---|---|
   | `DATABASE_URL` | la de Neon |
   | `CORS_ORIGINS` | `https://*.vercel.app` |
   | `HOUSE_BOTS` | `true` |
6. **Health check**: TCP, puerto 8000.
7. *Deploy*. Al terminar te queda una URL como `https://cafe-subasta-tuusuario.koyeb.app`.
   Pruébala en el navegador agregando `/healthz`.

> Plan B si Koyeb te da problemas: Render (gratis) también corre el Dockerfile y el
> navegador funciona, porque usa el protocolo Connect sobre HTTP/1.1. Lo que no
> funciona en Render es el gRPC nativo desde fuera, así que los bots desde tu PC
> no podrían conectarse. Los bots internos (`HOUSE_BOTS`) sí siguen funcionando.

## 5. Frontend en Vercel

1. https://vercel.com → **Add New → Project** → importa el repo.
2. **Root Directory**: `apps/web`. Vercel detecta Next.js solo.
3. **Environment Variables**: `NEXT_PUBLIC_API_URL` = la URL de Koyeb, **sin** `/` al final.
4. **Deploy**.

## 6. Demo para la clase (5 minutos)

1. Abre la web en **dos navegadores**. Saca un *paddle* en cada uno, puja en uno y mira cómo el otro se actualiza solo (server streaming).
2. Puja en los últimos 30 segundos de un lote: verás "Extended by 30 seconds" (regla anti-sniping).
3. Pon una puja con **máximo** (proxy). Cuando un bot te supere, la casa responde por ti.
4. Abre **Under the hood**. Ahí están los 4 tipos de RPC, la comparación de bytes Protobuf vs JSON (~60% menos) y el inspector con cada llamada.
5. En CMD, muestra gRPC nativo contra la nube:
   ```cmd
   npm run bots -- --target https://TU-SERVICIO.koyeb.app --count 3
   ```
   y la llamada "a mano" con Buf:
   ```cmd
   npx buf curl --protocol grpc --schema proto https://TU-SERVICIO.koyeb.app/coffee.auction.v1.CatalogService/ListLots -d "{}"
   ```
6. En VS Code, abre `proto/coffee/auction/v1/auction.proto` y explica **contract-first**: de ese archivo sale todo el código del server, la web y los bots.

## 7. Cómo conecta con lo visto en clase

| Tema de clase | Dónde está en el proyecto |
|---|---|
| Exponer funciones remotas en vez de recursos | `biddingClient.placeBid(...)` en `apps/web/src/components/bid-panel.tsx` |
| Protocol Buffers | `proto/...auction.proto` y la página *Under the hood* |
| HTTP/2 multiplexado | `apps/server/src/transport/server.ts` (un puerto: HTTP/1.1 + HTTP/2) y los bots |
| Contract-first, SSOT, generación de código | `buf.gen.yaml`, `packages/contracts/src/gen` y el CI que valida que esté al día |
| Paralelización de equipos | Con el contrato, el frontend podía arrancar antes que el backend |
| Tipado end-to-end | `postgres/schema.ts` → `domain/models.ts` → `transport/mappers.ts` → componentes React |
| Type erasure y Zod | `packages/contracts/src/validation.ts`, `apps/web/src/lib/session.ts` y `apps/server/src/config/env.ts` |
| Microservicios y trade-offs | Sección *Trade-offs* del README |

## Problemas comunes

- **La web dice "Connecting…"**: revisa que `NEXT_PUBLIC_API_URL` apunte a Koyeb y que `CORS_ORIGINS` incluya tu dominio de Vercel. Si cambias la variable en Vercel, haz **Redeploy**.
- **El paddle desaparece**: sin `DATABASE_URL` el servidor guarda todo en memoria y lo pierde al reiniciarse. Con Neon queda guardado.
- **El primer request tarda**: la instancia gratis se duerme si nadie la usa. Al despertar, los streams se reconectan solos.
