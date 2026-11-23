'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file store. Metadata lives in db.json; the heavy parts of each
 * design (editor JSON, print files, previews) live in files/<designId>/.
 *
 * All writes are synchronous and atomic (write to temp file, then rename),
 * which is plenty for a single-process shop and keeps the setup dependency-free.
 */
class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.filesDir = path.join(dataDir, 'files');
    this.dbPath = path.join(dataDir, 'db.json');
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.db = { designs: {}, orders: [], nextOrderNumber: 1001 };
    if (fs.existsSync(this.dbPath)) {
      this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) };
    }
  }

  save() {
    writeAtomic(this.dbPath, JSON.stringify(this.db, null, 2));
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
    this.db.designs[design.id] = design;
    this.save();
    return design;
  }

  getDesign(id) {
    return Object.prototype.hasOwnProperty.call(this.db.designs, id) ? this.db.designs[id] : null;
  }

  createOrder(order) {
    order.number = `POD-${this.db.nextOrderNumber++}`;
    this.db.orders.push(order);
    for (const item of order.items) {
      this.db.designs[item.designId].orderId = order.id;
    }
    this.save();
    return order;
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
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

module.exports = { Store };
