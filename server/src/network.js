// Office-network check: a location can list the public internet address(es)
// of its office Wi-Fi. Check-ins at that location are then only accepted from
// those networks. A fake-GPS app can't change which network a request comes
// from, so this is a strong proof of presence for office staff.
const net = require('net');
const dns = require('dns').promises;

/** Strip the IPv4-in-IPv6 prefix ("::ffff:1.2.3.4" -> "1.2.3.4"). */
function normalizeIp(ip) {
  if (!ip) return '';
  const s = String(ip).trim();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  return m ? m[1] : s;
}

/** The address the request came from (honours TRUST_PROXY via req.ip). */
function clientIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress);
}

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;

/**
 * Parse "203.0.113.7, 198.51.100.0/24, 2001:db8:1::/48, myoffice.ddns.net".
 * Hostnames are dynamic-DNS names whose current address is looked up.
 * Returns { entries, error } — error names the first invalid entry.
 */
function parseIpList(text) {
  const entries = [];
  for (const raw of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const [addr, prefixStr, extra] = raw.split('/');
    const ip = normalizeIp(addr);
    const family = net.isIP(ip);
    if (!family && prefixStr === undefined && HOSTNAME.test(raw)) {
      entries.push({ host: raw.toLowerCase() });
      continue;
    }
    if (!family || extra !== undefined) {
      return { entries, error: `"${raw}" is not a valid IP address, range or dynamic DNS name` };
    }
    if (prefixStr !== undefined) {
      const prefix = Number(prefixStr);
      const max = family === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefixStr) || prefix < 8 || prefix > max) {
        return { entries, error: `"${raw}" has an invalid range size (use /8 to /${max})` };
      }
      entries.push({ ip, prefix, family });
    } else {
      entries.push({ ip, prefix: null, family });
    }
  }
  return { entries, error: null };
}

/** Canonical stored form: "a, b/24, host.example". */
function formatIpList(entries) {
  return entries.map((e) => (e.host ? e.host : e.prefix === null ? e.ip : `${e.ip}/${e.prefix}`)).join(', ');
}

/**
 * True when `ip` is in the static part of the list (addresses and ranges).
 * Hostnames are ignored here — see siteAllowsIp for the full check.
 */
function ipMatches(listText, ip) {
  const addr = normalizeIp(ip);
  const family = net.isIP(addr);
  if (!family) return false;
  const statics = parseIpList(listText).entries.filter((e) => !e.host);
  if (!statics.length) return false;
  const list = new net.BlockList();
  for (const e of statics) {
    const type = e.family === 4 ? 'ipv4' : 'ipv6';
    if (e.prefix === null) list.addAddress(e.ip, type);
    else list.addSubnet(e.ip, e.prefix, type);
  }
  return list.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Same network? IPv4 offices share one public address. With IPv6 every
 * device gets its own address inside the office's /64, so compare that.
 */
function sameNetwork(a, b) {
  const x = normalizeIp(a);
  const y = normalizeIp(b);
  const fx = net.isIP(x);
  if (!fx || fx !== net.isIP(y)) return false;
  if (fx === 4) return x === y;
  const list = new net.BlockList();
  list.addSubnet(y, 64, 'ipv6');
  return list.check(x, 'ipv6');
}

// --- Dynamic DNS -----------------------------------------------------------
// Routers with dynamic DNS keep a name (e.g. myoffice.ddns.net) pointing at
// the office's current address. Look it up, caching for a minute; if a lookup
// fails, keep using the last answer for up to a day.
const dnsCache = new Map(); // host -> { at, addrs }
const DNS_TTL_MS = 60 * 1000;
const DNS_STALE_MS = 24 * 3600 * 1000;
let lookupImpl = (host) => dns.lookup(host, { all: true, verbatim: true }).then((r) => r.map((x) => x.address));

async function resolveHost(host) {
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.at < DNS_TTL_MS) return hit.addrs;
  try {
    const addrs = (await lookupImpl(host)).map(normalizeIp);
    dnsCache.set(host, { at: Date.now(), addrs });
    return addrs;
  } catch {
    return hit && Date.now() - hit.at < DNS_STALE_MS ? hit.addrs : [];
  }
}

// --- Office connector --------------------------------------------------------
// A page left open on a computer in the office reports the office's current
// address every minute. We keep the latest address per IP family (always
// valid) plus recently replaced ones for an hour, so check-ins don't fail
// in the minute after the provider changes the address.
const CONNECTOR_GRACE_MS = 60 * 60 * 1000;

function connectorAddresses(site) {
  try {
    return JSON.parse(site.connector_ips || '[]');
  } catch {
    return [];
  }
}

/** Record a connector ping. Returns { list, isNew } for storage/logging. */
function recordConnectorPing(site, ip, now = Date.now()) {
  const addr = normalizeIp(ip);
  const family = net.isIP(addr);
  let list = connectorAddresses(site);
  const isNew = !list.some((e) => sameNetwork(addr, e.ip));
  list = list.filter((e) => !sameNetwork(addr, e.ip));
  list.push({ ip: addr, family, last_seen: now });
  // keep the newest per family + anything seen within the grace period
  const newest = {};
  for (const e of list) if (!newest[e.family] || e.last_seen > newest[e.family].last_seen) newest[e.family] = e;
  list = list.filter((e) => newest[e.family] === e || now - e.last_seen < CONNECTOR_GRACE_MS);
  return { list, isNew };
}

function connectorAllows(site, ip, now = Date.now()) {
  const list = connectorAddresses(site);
  const newest = {};
  for (const e of list) if (!newest[e.family] || e.last_seen > newest[e.family].last_seen) newest[e.family] = e;
  return list.some((e) => (newest[e.family] === e || now - e.last_seen < CONNECTOR_GRACE_MS) && sameNetwork(ip, e.ip));
}

/** Does this location require office Wi-Fi at all? */
function siteRequiresNetwork(site) {
  return Boolean(site.office_ips || site.connector_token);
}

/** Full check: static addresses, dynamic DNS names, and the office connector. */
async function siteAllowsIp(site, ip) {
  if (!siteRequiresNetwork(site)) return false;
  if (ipMatches(site.office_ips, ip)) return true;
  if (site.connector_token && connectorAllows(site, ip)) return true;
  for (const e of parseIpList(site.office_ips).entries.filter((x) => x.host)) {
    for (const a of await resolveHost(e.host)) if (sameNetwork(ip, a)) return true;
  }
  return false;
}

/**
 * What an admin standing in the office should enter for this network.
 * IPv4 offices share one public address; with IPv6 every device has its own
 * address, so suggest the network's /64 range instead.
 */
function suggestEntry(ip) {
  const addr = normalizeIp(ip);
  if (net.isIP(addr) !== 6) return addr;
  const [head, tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** True for addresses that can't be an office's public internet address. */
function isPrivate(ip) {
  const addr = normalizeIp(ip);
  const list = new net.BlockList();
  for (const [a, p] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10]]) {
    list.addSubnet(a, p, 'ipv4');
  }
  list.addSubnet('fc00::', 7, 'ipv6');
  list.addSubnet('fe80::', 10, 'ipv6');
  list.addAddress('::1', 'ipv6');
  const family = net.isIP(addr);
  return family ? list.check(addr, family === 4 ? 'ipv4' : 'ipv6') : true;
}

module.exports = {
  normalizeIp, clientIp, parseIpList, formatIpList, ipMatches, sameNetwork, suggestEntry, isPrivate,
  resolveHost, recordConnectorPing, connectorAddresses, siteRequiresNetwork, siteAllowsIp,
  // tests only
  _setLookup: (fn) => { lookupImpl = fn; dnsCache.clear(); },
};
