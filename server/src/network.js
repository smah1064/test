// Office-network check: a location can list the public internet address(es)
// of its office Wi-Fi. Check-ins at that location are then only accepted from
// those networks. A fake-GPS app can't change which network a request comes
// from, so this is a strong proof of presence for office staff.
const net = require('net');

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

/**
 * Parse "203.0.113.7, 198.51.100.0/24, 2001:db8:1::/48" into entries.
 * Returns { entries, error } — error names the first invalid entry.
 */
function parseIpList(text) {
  const entries = [];
  for (const raw of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const [addr, prefixStr, extra] = raw.split('/');
    const ip = normalizeIp(addr);
    const family = net.isIP(ip);
    if (!family || extra !== undefined) return { entries, error: `"${raw}" is not a valid IP address or range` };
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

/** Canonical stored form: "a, b/24, c". */
function formatIpList(entries) {
  return entries.map((e) => (e.prefix === null ? e.ip : `${e.ip}/${e.prefix}`)).join(', ');
}

function ipMatches(listText, ip) {
  const addr = normalizeIp(ip);
  const family = net.isIP(addr);
  if (!family) return false;
  const { entries } = parseIpList(listText);
  if (!entries.length) return false;
  const list = new net.BlockList();
  for (const e of entries) {
    const type = e.family === 4 ? 'ipv4' : 'ipv6';
    if (e.prefix === null) list.addAddress(e.ip, type);
    else list.addSubnet(e.ip, e.prefix, type);
  }
  return list.check(addr, family === 4 ? 'ipv4' : 'ipv6');
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

module.exports = { normalizeIp, clientIp, parseIpList, formatIpList, ipMatches, suggestEntry, isPrivate };
