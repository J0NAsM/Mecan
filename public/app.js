document
  .querySelector('.nav-toggle')
  ?.addEventListener('click', () =>
    document.querySelector('.public-nav')?.classList.toggle('open'),
  );
document.querySelectorAll('form[data-confirm]').forEach((form) =>
  form.addEventListener('submit', (event) => {
    if (!confirm(form.dataset.confirm)) event.preventDefault();
  }),
);
document.querySelector('.flash')?.setAttribute('role', 'status');
document.querySelector('.app-menu-toggle')?.addEventListener('click', (event) => {
  const opened = document.body.classList.toggle('menu-open');
  event.currentTarget.setAttribute('aria-expanded', String(opened));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.body.classList.remove('menu-open');
    document.querySelector('.app-menu-toggle')?.setAttribute('aria-expanded', 'false');
  }
});
document
  .querySelectorAll('[data-print]')
  .forEach((button) => button.addEventListener('click', () => window.print()));
window.addEventListener('pageshow', () =>
  document.querySelectorAll('button[data-original-text]').forEach((button) => {
    button.disabled = false;
    button.textContent = button.dataset.originalText;
  }),
);
function applyTableFilters(selector) {
  const rows = document.querySelectorAll(selector),
    status = document.querySelector(`[data-filter="${selector}"]`)?.value || '',
    search =
      document.querySelector(`[data-table-search="${selector}"]`)?.value.trim().toLowerCase() || '';
  for (const row of rows)
    row.hidden =
      (Boolean(status) && row.dataset.status !== status) ||
      (Boolean(search) &&
        !String(row.dataset.search || row.textContent)
          .toLowerCase()
          .includes(search));
}
for (const select of document.querySelectorAll('[data-filter]'))
  select.addEventListener('change', () => applyTableFilters(select.dataset.filter));
for (const input of document.querySelectorAll('[data-table-search]'))
  input.addEventListener('input', () => applyTableFilters(input.dataset.tableSearch));
document.querySelectorAll('form[data-upload]').forEach((form) =>
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = form.querySelector('input[type=file]').files[0];
    if (!file) return;
    if (file.size > 7_000_000) {
      const note = document.createElement('p');
      note.className = 'form-error';
      note.textContent = 'El archivo supera el máximo de 7 MB.';
      form.append(note);
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    button.textContent = 'Subiendo…';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = {
          csrf: form.querySelector('[name=csrf]').value,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: String(reader.result).split(',')[1],
        };
        for (const name of ['entityType', 'entityId', 'category']) {
          const input = form.querySelector(`[name="${name}"]`);
          if (input) payload[name] = input.value;
        }
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        location.href = response.redirected ? response.url : '/workshop/documents';
      } catch {
        button.disabled = false;
        button.textContent = 'Reintentar';
        const note = document.createElement('p');
        note.className = 'form-error';
        note.textContent = 'No se pudo subir el archivo. Revisa tu conexión e intenta nuevamente.';
        form.append(note);
      }
    };
    reader.onerror = () => {
      button.disabled = false;
      button.textContent = 'Reintentar';
    };
    reader.readAsDataURL(file);
  }),
);
document.querySelectorAll('[data-customer-source]').forEach((source) => {
  const target = document.querySelector('[data-vehicle-target]');
  if (!target) return;
  const filter = () => {
    const customer = source.value;
    for (const option of target.options) {
      if (!option.dataset.customer) continue;
      option.hidden = option.dataset.customer !== customer;
    }
    target.value = '';
  };
  source.addEventListener('change', filter);
  filter();
});
document.querySelectorAll('form').forEach((form) =>
  form.addEventListener('submit', (event) => {
    if (event.defaultPrevented) return;
    const button = form.querySelector('button[type=submit],button:not([type])');
    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Procesando…';
    }
  }),
);
// Dentro de la aplicación Android instalada existe el puente MecanApp. Solo entonces se muestran
// las acciones que un navegador no puede hacer: consultar e instalar una versión nueva del APK.
if (window.MecanApp?.isApp?.()) {
  document.body.classList.add('in-app');
  for (const note of document.querySelectorAll('[data-app-version]')) {
    note.textContent = `Versión instalada ${window.MecanApp.versionName()} (${window.MecanApp.versionCode()}).`;
    note.hidden = false;
  }
  for (const button of document.querySelectorAll('[data-app-action="check-updates"]')) {
    button.hidden = false;
    button.addEventListener('click', () => window.MecanApp.checkForUpdates());
  }
  for (const button of document.querySelectorAll('[data-app-action="server"]'))
    button.addEventListener('click', () => window.MecanApp.openSettings());
}
