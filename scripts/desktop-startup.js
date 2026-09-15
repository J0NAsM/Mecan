import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

function privateIpv4(host) {
  if (net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function desktopUrls(env = process.env, interfaces = os.networkInterfaces()) {
  const port = env.PORT || '3000';
  const host = env.HOST || '0.0.0.0';
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  const localUrl = `http://${net.isIP(localHost) === 6 ? `[${localHost}]` : localHost}:${port}`;
  const publicUrl = new URL(env.APP_URL || localUrl);
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries || []).map((entry) => ({ ...entry, name })),
  );
  let previousUrl;
  // Una IP privada de otra red ya no lleva a esta PC. Solo se ajusta el acceso HTTP de
  // desarrollo; los dominios y las direcciones de producción conservan su configuración.
  if (
    env.NODE_ENV !== 'production' &&
    publicUrl.protocol === 'http:' &&
    privateIpv4(publicUrl.hostname) &&
    !addresses.some((entry) => entry.address === publicUrl.hostname)
  ) {
    previousUrl = publicUrl.origin;
    const lan = addresses.filter(
      (entry) =>
        entry.family === 'IPv4' &&
        !entry.internal &&
        privateIpv4(entry.address) &&
        !/vethernet|virtual|vmware|wsl|hyper-v|docker|vpn|tailscale|zerotier/i.test(entry.name),
    );
    const wildcard = host === '0.0.0.0' || host === '::';
    const replacement = wildcard && lan.length === 1 ? lan[0].address : localHost;
    publicUrl.hostname = net.isIP(replacement) === 6 ? `[${replacement}]` : replacement;
    publicUrl.port = port;
  }
  return { localUrl, publicUrl: publicUrl.href.replace(/\/$/, ''), previousUrl };
}

export async function probeServer(url, timeoutMs = 2000) {
  try {
    const { status, body } = await new Promise((resolve, reject) => {
      const transport = new URL(url).protocol === 'https:' ? https : http;
      // Cada intento necesita un socket nuevo. En Windows un listener IPv6 ajeno puede
      // aceptar la primera consulta antes de que Mecan abra el listener IPv4. Reutilizar
      // esa conexión seguiría consultando al otro programa incluso después del arranque.
      const request = transport.get(
        url,
        { agent: false, signal: AbortSignal.timeout(timeoutMs) },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
            if (body.length > 65536)
              request.destroy(new Error('Respuesta de salud demasiado grande'));
          });
          response.once('error', reject);
          response.once('end', () => resolve({ status: response.statusCode, body }));
        },
      );
      request.once('error', reject);
    });
    let health;
    try {
      health = JSON.parse(body);
    } catch {}
    const ownHealth = typeof health?.migrations === 'number' && 'database' in health;
    if (status === 200 && ownHealth && health.database === 'ok') return { state: 'listo' };
    if (ownHealth || status >= 500)
      return {
        state: 'sin respuesta',
        detail: `HTTP ${status}: el servidor todavía no está saludable`,
      };
    return { state: 'ajeno', detail: `HTTP ${status}: la respuesta no corresponde a Mecan` };
  } catch (error) {
    return {
      state: 'sin respuesta',
      detail:
        error.name === 'AbortError'
          ? 'la consulta de salud agotó su tiempo'
          : error.code || error.message,
    };
  }
}

export async function waitForServer(
  healthUrl,
  child,
  { timeoutMs = 30000, requestTimeoutMs = 2000, intervalMs = 200 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let result = { state: 'sin respuesta', detail: 'sin respuesta HTTP' };
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) return { state: 'detenido' };
    result = await probeServer(
      healthUrl,
      Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now())),
    );
    if (child.exitCode !== null || child.signalCode) return { state: 'detenido' };
    if (result.state === 'listo') return result;
    // Un 404 durante el arranque puede venir de otro listener: se vuelve a consultar
    // mientras este proceso abre su puerto, sin conservar conexiones del intento anterior.
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(intervalMs, remaining));
  }
  return result;
}
