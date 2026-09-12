/**
 * Valores de DESARROLLO. Reemplaza los placeholders con los datos del
 * App registration "BarrioDigital" en Azure AD (portal.azure.com).
 * NO subas clientId/tenantId reales de produccion a un repo publico.
 */
export const environment = {
  // App registration de la SPA (barriodigital-spa)
  msalClientId: '12224686-5a51-49f2-94f0-3266db84b91a',
  msalTenantId: 'db9e57fc-5bb8-44fc-8d2f-caf0060c79da',
  redirectUri: 'http://localhost:4200',
  postLogoutRedirectUri: 'http://localhost:4200',

  // Scope expuesto por la App registration de la API (barriodigital-api)
  apiScope: 'api://cdf23af8-9ba5-483b-a5ba-03e23c43b101/access_as_user',

  // URL del AWS API Gateway (en local, el BFF directo)
  apiBaseUrl: 'http://localhost:8080',
};
