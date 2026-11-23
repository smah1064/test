'use strict';

const fs = require('fs');
const path = require('path');

/**
 * JSON-file store. Metadata lives in db.json; the heavy parts of each design
 * (editor JSON, print files, previews) live in files/<designId>/.
 *
 * Safe when the host runs more than one copy of the app at once (Hostinger
 * does): every request first picks up changes another copy saved (sync), and
 * every save takes a lock file, merges the other copy's changes record by
 * record (a design or order changed here wins; everything else comes from
 * disk), then writes atomically. Objects are updated in place, so code that
 * holds a design or an order item keeps a live reference.
 */
const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Make `target` equal to `src`, keeping the identity of nested objects (and of array items with an id). */
function deepAssign(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const t = target[k];
    if (Array.isArray(v) && Array.isArray(t)) syncArray(t, v);
    else if (isObj(v) && isObj(t)) deepAssign(t, v);
    else target[k] = v;
  }
  return target;
}
function syncArray(t, v) {
  const byId = new Map(t.filter((x) => isObj(x) && x.id).map((x) => [x.id, x]));
  const out = v.map((x) => (isObj(x) && x.id && byId.has(x.id) ? deepAssign(byId.get(x.id), x) : x));
  t.length = 0;
  t.push(...out);
  return t;
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filesDir = path.join(dataDir, 'files');
    this.dbPath = path.join(dataDir, 'db.json');
    this.lockPath = `${this.dbPath}.lock`;
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.db = { designs: {}, orders: [], nextOrderNumber: 1001 };
    this.base = JSON.parse(JSON.stringify(this.db));
    this.stamp = null;
    if (fs.existsSync(this.dbPath)) {
      const text = fs.readFileSync(this.dbPath, 'utf8');
      this.db = { ...this.db, ...JSON.parse(text) };
      this.base = JSON.parse(JSON.stringify(this.db));
      this.stamp = this.fileStamp();
    }
  }

  fileStamp() {
    try {
      const st = fs.statSync(this.dbPath);
      return `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return null;
    }
  }

  /** Pick up what another copy of the app saved since we last read or wrote the file. */
  sync() {
    const stamp = this.fileStamp();
    if (!stamp || stamp === this.stamp) return false;
    let text;
    try {
      text = fs.readFileSync(this.dbPath, 'utf8');
    } catch (e) {
      return false;
    }
    let disk;
    try {
      disk = JSON.parse(text);
    } catch (e) {
      return false; // half-written by an old version; the next save repairs it
    }
    this.merge(disk);
    this.base = JSON.parse(text);
    this.stamp = stamp;
    return true;
  }

  /** Three-way merge of the file into memory: records changed here (vs. the last read) win. */
  merge(disk) {
    const db = this.db;
    const base = this.base;
    // Designs, by id.
    const mine = db.designs;
    const theirs = disk.designs || {};
    const was = base.designs || {};
    for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(was)])) {
      if (!sameJSON(mine[id], was[id])) continue; // changed (or deleted) here: keep ours
      const t = theirs[id];
      if (t === undefined) delete mine[id];
      else if (mine[id]) deepAssign(mine[id], t);
      else mine[id] = t;
    }
    // Orders, by id, in the file's order; orders created here and not yet saved go last.
    const mineById = new Map(db.orders.map((o) => [o.id, o]));
    const wasById = new Map((base.orders || []).map((o) => [o.id, o]));
    const result = [];
    const seen = new Set();
    for (const t of disk.orders || []) {
      seen.add(t.id);
      const m = mineById.get(t.id);
      if (m && !sameJSON(m, wasById.get(t.id))) result.push(m);
      else if (m) result.push(deepAssign(m, t));
      else if (!wasById.has(t.id)) result.push(t);
    }
    for (const m of db.orders) {
      if (!seen.has(m.id) && (!wasById.has(m.id) || !sameJSON(m, wasById.get(m.id)))) result.push(m);
    }
    db.orders.length = 0;
    db.orders.push(...result);
    // Everything else (counters, small maps).
    for (const k of new Set([...Object.keys(db), ...Object.keys(disk)])) {
      if (k === 'designs' || k === 'orders') continue;
      const m = db[k];
      const t = disk[k];
      const changedHere = !sameJSON(m, base[k]);
      if (changedHere && typeof m === 'number' && typeof t === 'number') db[k] = Math.max(m, t);
      else if (changedHere && isObj(m) && isObj(t)) db[k] = Object.assign(m, { ...t, ...m });
      else if (changedHere) continue;
      else if (t === undefined) delete db[k];
      else if (isObj(m) && isObj(t)) deepAssign(m, t);
      else db[k] = t;
    }
  }

  lock() {
    const start = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          if (Date.now() - fs.statSync(this.lockPath).mtimeMs > 10000) {
            fs.rmSync(this.lockPath, { force: true }); // left behind by a copy that crashed
            continue;
          }
        } catch (e2) {
          continue;
        }
        if (Date.now() - start > 5000) {
          console.warn('[store] lock wait timed out; saving anyway');
          return false;
        }
        Atomics.wait(SLEEP, 0, 0, 15);
      }
    }
  }

  /** Run `fn` with the latest data, then save; nothing else can save in between. */
  mutate(fn) {
    const locked = this.lock();
    try {
      this.sync();
      const result = fn ? fn(this.db) : undefined;
      const text = JSON.stringify(this.db, null, 2);
      writeAtomic(this.dbPath, text);
      this.base = JSON.parse(text);
      this.stamp = this.fileStamp();
      return result;
    } finally {
      if (locked) fs.rmSync(this.lockPath, { force: true });
    }
  }

  save() {
    this.mutate();
  }

  designDir(designId) {
    return path.join(this.filesDir, designId);
  }

  designFile(designId, name) {
    return path.join(this.designDir(designId), name);
  }

  createDesign(design, files) {
    const dir = this.designDir(design.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(files)) {
      writeAtomic(path.join(dir, name), data);
    }
    this.mutate((db) => {
      db.designs[design.id] = design;
    });
    return design;
  }

  writeDesignFile(designId, name, data) {
    writeAtomic(this.designFile(designId, name), data);
  }

  getDesign(id) {
    return Object.prototype.hasOwnProperty.call(this.db.designs, id) ? this.db.designs[id] : null;
  }

  createOrder(order) {
    // The number is taken under the lock from the latest file, so two copies never hand out the same one.
    return this.mutate((db) => {
      order.number = `POD-${db.nextOrderNumber++}`;
      db.orders.push(order);
      for (const item of order.items) {
        if (db.designs[item.designId]) db.designs[item.designId].orderId = order.id;
      }
      return order;
    });
  }

  getOrder(id) {
    return this.db.orders.find((o) => o.id === id) || null;
  }

  listOrders() {
    return this.db.orders;
  }

  findItem(itemId) {
    for (const order of this.db.orders) {
      const item = order.items.find((i) => i.id === itemId);
      if (item) return { order, item };
    }
    return null;
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

module.exports = { Store };
