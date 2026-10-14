const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let S = { nodes: {}, blocks: [] }, cwd = 'root', sel = null, onOk = null;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Request failed'); return d;
}
function toast(m, err) { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (err ? ' error' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2800); }
async function load() { S = await api('/api/state'); if (!S.nodes[cwd]) cwd = 'root'; if (!S.nodes[sel]) sel = null; render(); }
async function run(p, msg) { try { await p; if (msg) toast(msg); await load(); } catch (e) { toast(e.message, true); } }
const pathOf = id => { const a = []; for (let n = S.nodes[id]; n && n.parent; n = S.nodes[n.parent]) a.unshift(n.name); return '/' + a.join('/'); };
const kids = () => Object.values(S.nodes).filter(n => n.parent === cwd).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
const empty = t => `<div class="empty-state"><strong>${t}</strong></div>`;

function render() {
  const used = S.blocks.filter(Boolean).length, ks = kids();
  $('#stat-items').textContent = Object.keys(S.nodes).length - 1;
  $('#stat-used').textContent = used; $('#disk-progress').style.width = used + '%';
  $('#stat-blocks').textContent = `${used} of 100 blocks used`; $('#stat-free').textContent = 100 - used;
  $('#stat-path').textContent = pathOf(cwd); $('#disk-used-big').textContent = used; $('#disk-free-big').textContent = 100 - used;
  const crumbs = []; for (let id = cwd; id; id = S.nodes[id].parent) crumbs.unshift(id);
  $('#breadcrumb').innerHTML = crumbs.map(id => `<button type="button" data-go="${id}">${id === 'root' ? '/' : esc(S.nodes[id].name)}</button>`).join('<i>›</i>');
  $('#item-count').textContent = ks.length + ' items';
  $('#file-list').innerHTML = ks.length ? ks.map(n => `<div class="row${n.id === sel ? ' sel' : ''}" data-id="${n.id}">
    <span>${n.type === 'dir' ? '📁' : '📄'} ${esc(n.name)}</span><span>${n.type === 'dir' ? 'Directory' : 'File'}</span>
    <span>${n.type === 'dir' ? '—' : n.content.length + ' B'}</span><code>${n.perms}</code>
    <span><button type="button" class="button button-secondary" data-open="${n.id}">Open</button>
    <button type="button" class="button button-danger" data-del="${n.id}">Delete</button></span></div>`).join('') : empty('Empty directory');
  const n = S.nodes[sel]; $('#empty-details').hidden = !!n; $('#item-details').hidden = !n;
  if (n) {
    $('#detail-name').textContent = n.name; $('#detail-path').textContent = pathOf(n.id);
    $('#detail-type').textContent = n.type === 'dir' ? 'Directory' : 'File';
    $('#detail-size').textContent = n.type === 'dir' ? '—' : n.content.length + ' bytes';
    $('#detail-blocks').textContent = n.count ? `${n.start}–${n.start + n.count - 1} (${n.count})` : 'None';
    $('#detail-perms').textContent = n.perms;
  }
  $('#block-grid').innerHTML = S.blocks.map((o, i) => `<div class="block${o ? ' used' : ''}" title="Block ${i}${o ? ' · ' + esc(S.nodes[o].name) : ''}"></div>`).join('');
  const fl = Object.values(S.nodes).filter(n => n.count);
  $('#allocation-table').innerHTML = fl.length ? `<table><tr><th>File</th><th>Start</th><th>Length</th><th>Blocks</th></tr>${fl.map(f =>
    `<tr><td>${esc(pathOf(f.id))}</td><td>${f.start}</td><td>${f.count}</td><td>${f.start}–${f.start + f.count - 1}</td></tr>`).join('')}</table>` : empty('No allocations');
  const all = Object.values(S.nodes).filter(n => n.id !== 'root');
  $('#permissions-table').innerHTML = all.length ? `<table><tr><th>Path</th><th>Read</th><th>Write</th><th>Execute</th></tr>${all.map(n =>
    `<tr data-row="${n.id}"><td>${esc(pathOf(n.id))}</td>${[0, 1, 2].map(i => `<td><input type="checkbox" data-p="${n.id}" ${n.perms[i] !== '-' ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</table>` : empty('Nothing to configure');
}

function ask(title, html, ok, btn = 'Confirm') { $('#modal-title').textContent = title; $('#modal-fields').innerHTML = html; $('#modal-submit').textContent = btn; onOk = ok; $('#item-dialog').showModal(); }
$('#item-form').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); $('#item-dialog').close(); onOk && onOk(d);
});
function create(type) {
  ask('Create ' + type, `<label>Name<input name="name" required maxlength="32"></label>` + (type === 'file' ? `<label>Content<textarea name="content" rows="6"></textarea></label>` : ''),
    d => run(api('/api/nodes', 'POST', { parent: cwd, type, ...d }), type + ' created'));
}
function open(id) {
  const n = S.nodes[id]; sel = id;
  if (n.type === 'dir') { if (n.perms[2] === '-') return toast('Permission denied: cannot enter directory', true); cwd = id; sel = null; return render(); }
  if (n.perms[0] === '-') return toast('Permission denied: file is not readable', true);
  const w = n.perms[1] === 'w';
  ask('Edit ' + n.name, `<textarea name="content" rows="8" ${w ? '' : 'readonly'}>${esc(n.content)}</textarea>`, d => w && run(api('/api/nodes/' + id, 'PUT', { content: d.content }), 'Saved'), w ? 'Save' : 'Close');
}
function del(id) { if (confirm(`Delete "${S.nodes[id].name}"?`)) run(api('/api/nodes/' + id, 'DELETE'), 'Deleted'); }

document.addEventListener('click', e => {
  const t = e.target, g = t.closest('[data-go]'), o = t.closest('[data-open]'), d = t.closest('[data-del]'), r = t.closest('.row');
  if (g) { cwd = g.dataset.go; sel = null; render(); } else if (o) open(o.dataset.open); else if (d) del(d.dataset.del);
  else if (r) { sel = r.dataset.id; render(); }
});
document.addEventListener('change', e => {
  const id = e.target.dataset.p; if (!id) return;
  const p = [...document.querySelectorAll(`[data-p="${id}"]`)].map((c, i) => c.checked ? 'rwx'[i] : '-').join('');
  run(api('/api/nodes/' + id, 'PUT', { perms: p }), 'Permissions updated');
});
const titles = { explorer: 'File Explorer', disk: 'Disk Manager', permissions: 'Permissions' };
$$('.nav-item').forEach(b => b.onclick = () => {
  $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
  $$('.view').forEach(v => v.hidden = v.id !== b.dataset.view + '-view'); $('#page-title').textContent = titles[b.dataset.view];
});
$('#new-file').onclick = $('#new-file-top').onclick = () => create('file');
$('#new-folder').onclick = () => create('dir');
$('#detail-open').onclick = () => open(sel); $('#detail-delete').onclick = () => del(sel);
$('#refresh-disk').onclick = () => run(Promise.resolve(), 'Disk map refreshed');
load().catch(e => toast('Backend not reachable: ' + e.message, true));
