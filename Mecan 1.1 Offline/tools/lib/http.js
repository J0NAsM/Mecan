// Descargas SOLO durante la recopilación inicial. Todo contenido remoto se trata como no confiable:
// HTTPS obligatorio, tamaño máximo, tiempo límite, reintentos acotados y User-Agent identificable.
export const USER_AGENT = 'MecanOfflineCollector/1.1 (catalogo local de modelos 3D; uso offline)';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} en ${url}`);
    this.status = status;
  }
}

export async function fetchBuffer(
  url,
  { maxBytes = 150_000_000, timeoutMs = 180_000, headers = {} } = {},
) {
  if (!/^https:\/\//.test(url)) throw new Error(`Solo se permiten descargas HTTPS: ${url}`);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new HttpError(response.status, url);
      if (!/^https:\/\//.test(response.url)) throw new Error('Redirección a un origen no HTTPS.');
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maxBytes)
        throw new Error(`El archivo supera el máximo permitido (${declared} bytes).`);
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > maxBytes)
          throw new Error('El archivo supera el máximo permitido durante la descarga.');
        chunks.push(chunk);
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: response.headers.get('content-type') || '',
        finalUrl: response.url,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && [400, 401, 403, 404, 410].includes(error.status)) break;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

export async function fetchText(url, options) {
  return (await fetchBuffer(url, { maxBytes: 5_000_000, ...options })).buffer.toString('utf8');
}
export async function fetchJson(url, options) {
  return JSON.parse(
    await fetchText(url, {
      ...options,
      headers: { accept: 'application/json', ...options?.headers },
    }),
  );
}

// Respeta los límites de APIs públicas sin credenciales (p. ej. GitHub: 60 consultas/hora).
export function throttle(ms) {
  let last = 0;
  return async () => {
    const wait = last + ms - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}
