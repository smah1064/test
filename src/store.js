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

/** Put `v` at obj[k], keeping the identity of an existing object or array there. */
function put(obj, k, v) {
  const cur = obj[k];
  if (isObj(cur) && isObj(v)) deepAssign(cur, v);
  else if (Array.isArray(cur) && Array.isArray(v)) syncArray(cur, v);
  else obj[k] = v;
}
const hasIds = (arr) => arr.every((x) => isObj(x) && x.id);

/** mine = this copy, base = the file when we last read it, theirs = the file now. */
function merge3(mine, base, theirs) {
  if (sameJSON(mine, base)) return theirs; // not changed here
  if (sameJSON(theirs, base)) return mine; // not changed there
  if (mine === undefined) return theirs; // deleted here, changed there: keep their change
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(mine[k], b[k], theirs[k]);
      if (v === undefined) delete mine[k];
      else if (v !== mine[k]) put(mine, k, v);
    }
    return mine;
  }
  if (Array.isArray(mine) && Array.isArray(theirs) && hasIds(mine) && hasIds(theirs)) {
    const was = new Map((Array.isArray(base) ? base : []).filter((x) => isObj(x) && x.id).map((x) => [x.id, x]));
    const mineById = new Map(mine.map((x) => [x.id, x]));
    const out = [];
    const seen = new Set();
    for (const t of theirs) {
      seen.add(t.id);
      const m = mineById.get(t.id);
      if (m) {
        const v = merge3(m, was.get(t.id), t);
        if (v !== m) deepAssign(m, v);
        out.push(m);
      } else if (!was.has(t.id) || !sameJSON(t, was.get(t.id))) {
        out.push(t); // added there, or deleted here but changed there
      }
    }
    for (const m of mine) {
      if (seen.has(m.id)) continue;
      if (!was.has(m.id)) out.push(m); // added here
      else if (!sameJSON(m, was.get(m.id))) out.push(m); // deleted there but changed here
    }
    mine.length = 0;
    mine.push(...out);
    return mine;
  }
  return mine; // both changed the same value: this copy wins
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

  /**
   * Three-way merge of the file into memory, field by field: whatever this
   * copy changed since it last read the file is kept, everything else comes
   * from the file. So two copies changing different items of one order (or
   * different fields of one design) both keep their change. Counters take the
   * highest value. A record deleted here but changed in the file is kept.
   */
  merge(disk) {
    const db = this.db;
    const base = this.base;
    for (const k of new Set([...Object.keys(db), ...Object.keys(disk)])) {
      const m = db[k];
      const t = disk[k];
      if (typeof m === 'number' && typeof t === 'number' && !sameJSON(m, base[k])) {
        db[k] = Math.max(m, t);
        continue;
      }
      const v = merge3(m, base[k], t);
      if (v === undefined) delete db[k];
      else if (v !== m) put(db, k, v);
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

  /**
   * Run `fn` while no other copy of the app saves (files kept beside the data, such as an account's cart or its
   * saved designs' list, read, changed and written in one go). `fn` must not call mutate().
   */
  exclusive(fn) {
    const locked = this.lock();
    try {
      return fn();
    } finally {
      if (locked) fs.rmSync(this.lockPath, { force: true });
    }
  }

  /** Run `fn` with the latest data, then save; nothing else can save in between. */
  mutate(fn) {
    const locked = this.lock();
    try {
      this.sync();
      const result = fn ? fn(this.db) : undefined;
      let text;
      try {
        text = JSON.stringify(this.db, null, 2);
        writeAtomic(this.dbPath, text);
      } catch (e) {
        // The data couldn't be written (something in it can't be saved): back to the last saved data, so one bad
        // change never stops every later save (orders, sign-ups...). QA 25 Nov.
        if (this.base) this.db = JSON.parse(JSON.stringify(this.base));
        throw e;
      }
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

  createOrder(order, check) {
    // The number is taken under the lock from the latest file, so two copies never hand out the same one;
    // `check` runs there too (e.g. "these designs are still free"), so two copies can't order the same design.
    return this.mutate((db) => {
      if (check) check(db);
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
