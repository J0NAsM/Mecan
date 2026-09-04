const base=process.env.SMOKE_BASE_URL||'http://127.0.0.1:3000';

async function expectPage(path,cookie=''){
  const response=await fetch(`${base}${path}`,{headers:cookie?{cookie}:{}}),text=await response.text();
  if(!response.ok)throw new Error(`${path} respondió ${response.status}`);
  if(/ConstraintViolation|SQLITE_|SyntaxError|TypeError:|\bundefined\b/.test(text))throw new Error(`${path} expuso un error técnico`);
}
async function login(email,password){
  const page=await fetch(`${base}/login`),guestCookie=page.headers.get('set-cookie')?.split(';')[0],html=await page.text(),guestCsrf=html.match(/name="guestCsrf" value="([^"]+)"/)?.[1];
  const response=await fetch(`${base}/login`,{method:'POST',redirect:'manual',headers:{cookie:guestCookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email,password,guestCsrf})});
  const cookie=response.headers.get('set-cookie')?.split(';')[0];if(response.status!==303||!cookie)throw new Error(`No se pudo autenticar ${email}`);return cookie;
}

const health=await fetch(`${base}/health`);if(!health.ok)throw new Error(`Health check ${health.status}`);
for(const page of ['/','/features','/pricing','/faq','/contact','/login','/signup'])await expectPage(page);
const workshopCookie=await login(process.env.SMOKE_WORKSHOP_EMAIL||'dueno@demo.local',process.env.SMOKE_WORKSHOP_PASSWORD||'Demo123!');
for(const page of ['/workshop','/workshop/search','/workshop/orders','/workshop/customers','/workshop/vehicles','/workshop/schedule','/workshop/inventory','/workshop/purchases','/workshop/billing','/workshop/reports','/workshop/notifications','/workshop/settings'])await expectPage(page,workshopCookie);
const adminCookie=await login(process.env.SMOKE_ADMIN_EMAIL||'admin@mecan.local',process.env.SMOKE_ADMIN_PASSWORD||'Admin123!');
for(const page of ['/saas','/saas/tenants','/saas/collections','/saas/plans','/saas/features','/saas/support','/saas/audit','/saas/settings'])await expectPage(page,adminCookie);
console.log('Smoke test completado: health, sitio público, taller y panel SaaS.');
