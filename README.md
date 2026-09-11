# frontend-barriodigital

Frontend Angular de BarrioDigital: login con Azure AD (MSAL), permite a vecinos
ingresar y seguir trámites municipales, a funcionarios gestionarlos, a
administradores mantener el catálogo, y a auditores consultar el historial.

## Cómo correr local

Requiere Node 20+.

```bash
npm ci
npm start
```

Levanta en `http://localhost:4200`. Necesita un App Registration de Azure AD
(`barriodigital-spa` + `barriodigital-api`, ver `barriodigital-docs/Entra-ID-y-JWT.md`)
y el BFF corriendo (local en `:8080`, o `ms-barriodigital-bff` de este mismo caso).

Build de producción: `npm run build -- --configuration production`.

## Variables de entorno

No usa variables de entorno en runtime — Angular resuelve todo en build time desde
`src/environments/environment.ts` (desarrollo) y `environment.prod.ts` (producción,
no versionado con valores reales). Cada uno define:

| Campo | Descripción |
|---|---|
| `msalClientId` | Client ID del App Registration `barriodigital-spa` |
| `msalTenantId` | Tenant ID de Azure AD |
| `redirectUri` / `postLogoutRedirectUri` | URL del propio frontend (debe estar registrada en Azure AD como redirect URI) |
| `apiScope` | `api://<API_CLIENT_ID>/access_as_user` |
| `apiBaseUrl` | URL base de la API (BFF local, o el API Gateway en producción) |

## Docker

```bash
docker build -t frontend-barriodigital .
docker run -p 80:80 frontend-barriodigital
```

Sirve el build de producción con nginx (`try_files $uri /index.html`, SPA).
Imagen publicada automáticamente en cada push a `main`:
`ghcr.io/phamnukz/frontend-barriodigital:latest`.
