const express = require('express'), fs = require('fs'), path = require('path');
const app = express(), FILE = path.join(__dirname, 'data', 'disk.json'), N = 100, B = 64;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

class Err extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fresh = () => ({ nodes: { root: { id: 'root', name: '/', type: 'dir', parent: null, perms: 'rwx', content: '', start: -1, count: 0 } }, blocks: Array(N).fill(null), seq: 1 });
let fsys;
try { fsys = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { fsys = fresh(); }
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(fsys, null, 2)); };

// ---- contiguous allocation (first-fit) ----
function release(n) { for (let i = 0; i < n.count; i++) fsys.blocks[n.start + i] = null; n.start = -1; n.count = 0; }
function setContent(n, text) {
  const old = { start: n.start, count: n.count }, k = Math.ceil(text.length / B);
  release(n);
  let run = 0, start = -1;
  if (k) for (let i = 0; i < N; i++) { run = fsys.blocks[i] === null ? run + 1 : 0; if (run === k) { start = i - k + 1; break; } }
  if (k && start < 0) { // roll back
    for (let i = 0; i < old.count; i++) fsys.blocks[old.start + i] = n.id;
    n.start = old.start; n.count = old.count;
    throw new Err(507, `Not enough contiguous free blocks (need ${k})`);
  }
  if (k) { for (let i = start; i < start + k; i++) fsys.blocks[i] = n.id; n.start = start; n.count = k; }
  n.content = text;
}
const node = id => fsys.nodes[id] || (() => { throw new Err(404, 'Item not found'); })();
const can = (n, p) => n.perms['rwx'.indexOf(p)] === p;
const route = f => (req, res) => {
  try { const r = f(req) || { ok: true }; save(); res.json(r); }
  catch (e) { res.status(e.code || 500).json({ error: e.message }); }
};

app.get('/api/state', (req, res) => res.json({ nodes: fsys.nodes, blocks: fsys.blocks }));

app.post('/api/nodes', route(({ body }) => {
  const { parent, name, type, content = '' } = body, p = node(parent);
  if (p.type !== 'dir') throw new Err(400, 'Parent is not a directory');
  if (!can(p, 'w')) throw new Err(403, 'Permission denied: directory is not writable');
  if (!['file', 'dir'].includes(type)) throw new Err(400, 'Invalid type');
  if (!/^[\w.\- ]{1,32}$/.test(name || '')) throw new Err(400, 'Name must be 1-32 chars (letters, digits, . _ - space)');
  if (Object.values(fsys.nodes).some(n => n.parent === parent && n.name === name)) throw new Err(409, 'Name already exists here');
  const id = 'n' + fsys.seq++;
  const n = fsys.nodes[id] = { id, name, type, parent, perms: type === 'dir' ? 'rwx' : 'rw-', content: '', start: -1, count: 0 };
  if (type === 'file') try { setContent(n, String(content)); } catch (e) { delete fsys.nodes[id]; throw e; }
  return n;
}));

app.put('/api/nodes/:id', route(({ params, body }) => {
  const n = node(params.id);
  if (body.perms !== undefined) {
    if (n.id === 'root' || !/^[r-][w-][x-]$/.test(body.perms)) throw new Err(400, 'Invalid permissions');
    n.perms = body.perms;
  }
  if (body.content !== undefined) {
    if (n.type !== 'file') throw new Err(400, 'Not a file');
    if (!can(n, 'w')) throw new Err(403, 'Permission denied: file is not writable');
    setContent(n, String(body.content));
  }
  return n;
}));

app.delete('/api/nodes/:id', route(({ params }) => {
  const n = node(params.id);
  if (n.id === 'root') throw new Err(400, 'Cannot delete root');
  if (!can(node(n.parent), 'w')) throw new Err(403, 'Permission denied: parent not writable');
  const rm = id => { Object.values(fsys.nodes).filter(c => c.parent === id).forEach(c => rm(c.id)); release(fsys.nodes[id]); delete fsys.nodes[id]; };
  rm(n.id);
}));

app.post('/api/reset', route(() => { fsys = fresh(); }));
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FileSim running on port ${PORT}`);
});