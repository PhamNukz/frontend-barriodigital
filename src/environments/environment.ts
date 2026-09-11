/**
 * Valores de DESARROLLO. Reemplaza los placeholders con los datos del
 * App registration "BarrioDigital" en Azure AD (portal.azure.com).
 * NO subas clientId/tenantId reales de produccion a un repo publico.
 */
export const environment = {
  production: false,

  // App registration de la SPA (barriodigital-spa)
  msalClientId: '00000000-0000-0000-0000-000000000000',
  msalTenantId: '00000000-0000-0000-0000-000000000000',
  redirectUri: 'http://localhost:4200',
  postLogoutRedirectUri: 'http://localhost:4200',

  // Scope expuesto por la App registration de la API (barriodigital-api)
  apiScope: 'api://00000000-0000-0000-0000-000000000000/access_as_user',

  // URL del AWS API Gateway (en local, el BFF directo)
  apiBaseUrl: 'http://localhost:8080',
};
