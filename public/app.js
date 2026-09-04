document.querySelector('.nav-toggle')?.addEventListener('click',()=>document.querySelector('.public-nav')?.classList.toggle('open'));
document.querySelectorAll('form[data-confirm]').forEach(form=>form.addEventListener('submit',event=>{if(!confirm(form.dataset.confirm))event.preventDefault()}));
setTimeout(()=>document.querySelector('.flash')?.remove(),5000);
function applyTableFilters(selector){const rows=document.querySelectorAll(selector),status=document.querySelector(`[data-filter="${selector}"]`)?.value||'',search=document.querySelector(`[data-table-search="${selector}"]`)?.value.trim().toLowerCase()||'';for(const row of rows)row.hidden=(Boolean(status)&&row.dataset.status!==status)||(Boolean(search)&&!String(row.dataset.search||row.textContent).toLowerCase().includes(search));}
for(const select of document.querySelectorAll('[data-filter]'))select.addEventListener('change',()=>applyTableFilters(select.dataset.filter));
for(const input of document.querySelectorAll('[data-table-search]'))input.addEventListener('input',()=>applyTableFilters(input.dataset.tableSearch));
document.querySelectorAll('form[data-upload]').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();const file=form.querySelector('input[type=file]').files[0];if(!file)return;
  const button=form.querySelector('button');button.disabled=true;button.textContent='Subiendo…';
  const reader=new FileReader();reader.onload=async()=>{try{const payload={csrf:form.querySelector('[name=csrf]').value,name:file.name,mimeType:file.type||'application/octet-stream',content:String(reader.result).split(',')[1]};for(const name of ['entityType','entityId','category']){const input=form.querySelector(`[name="${name}"]`);if(input)payload[name]=input.value;}const response=await fetch(form.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});location.href=response.redirected?response.url:'/workshop/documents';}catch{button.disabled=false;button.textContent='Reintentar';const note=document.createElement('p');note.className='form-error';note.textContent='No se pudo subir el archivo. Revisa tu conexión e intenta nuevamente.';form.append(note);}};reader.onerror=()=>{button.disabled=false;button.textContent='Reintentar';};reader.readAsDataURL(file);
}));
document.querySelectorAll('[data-customer-source]').forEach(source=>{
  const target=document.querySelector('[data-vehicle-target]');if(!target)return;
  const filter=()=>{const customer=source.value;for(const option of target.options){if(!option.dataset.customer)continue;option.hidden=option.dataset.customer!==customer;}target.value='';};
  source.addEventListener('change',filter);filter();
});
document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>{if(event.defaultPrevented)return;const button=form.querySelector('button[type=submit],button:not([type])');if(button){button.disabled=true;button.dataset.originalText=button.textContent;button.textContent='Procesando…';}}));
