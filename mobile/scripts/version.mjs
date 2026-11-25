#!/usr/bin/env node
/*
 * The apps' version number, kept in one place: "version" in mobile/package.json (e.g. "1.2.3").
 * The stores also need a whole number that grows with every upload; it's worked out from the version:
 * major × 10000 + minor × 100 + patch (1.2.3 → 10203). So every store upload needs a new version.
 *
 *   node scripts/version.mjs                    show the version and build number
 *   node scripts/version.mjs bump [patch|minor|major]   raise the version (default: patch) and sync
 *   node scripts/version.mjs sync               write them into the iOS project (Android reads package.json)
 *   node scripts/version.mjs check              fail if the iOS project doesn't match package.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = path.join(MOBILE, 'package.json');
const PBXPROJ = path.join(MOBILE, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

export function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!m) throw new Error(`The version must look like 1.2.3, not "${version}"`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`Minor and patch go up to 99 ("${version}")`);
  if (major < 1 || major > 2000) throw new Error(`Major must be 1 to 2000 ("${version}")`);
  return { major, minor, patch };
}

export function buildNumber(version) {
  const { major, minor, patch } = parseVersion(version);
  return major * 10000 + minor * 100 + patch;
}

export function bumpVersion(version, part = 'patch') {
  const v = parseVersion(version);
  if (part === 'major') return `${v.major + 1}.0.0`;
  if (part === 'minor') return v.minor === 99 ? `${v.major + 1}.0.0` : `${v.major}.${v.minor + 1}.0`;
  if (part !== 'patch') throw new Error(`Unknown part "${part}" (patch, minor or major)`);
  if (v.patch < 99) return `${v.major}.${v.minor}.${v.patch + 1}`;
  return v.minor < 99 ? `${v.major}.${v.minor + 1}.0` : `${v.major + 1}.0.0`;
}

/** The iOS project's text with MARKETING_VERSION / CURRENT_PROJECT_VERSION set (every build configuration). */
export function syncPbxproj(text, version) {
  const build = buildNumber(version);
  const marketing = text.match(/MARKETING_VERSION = [^;]+;/g) || [];
  const current = text.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) || [];
  if (marketing.length === 0 || current.length === 0) throw new Error('No MARKETING_VERSION / CURRENT_PROJECT_VERSION in the iOS project');
  return text
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
}

export function readVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE, 'utf8')).version;
}

function writeVersion(version) {
  const text = fs.readFileSync(PACKAGE, 'utf8');
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (next === text && readVersion() !== version) throw new Error('Could not find "version" in package.json');
  fs.writeFileSync(PACKAGE, next);
}

function sync(version) {
  const text = fs.readFileSync(PBXPROJ, 'utf8');
  const next = syncPbxproj(text, version);
  if (next !== text) fs.writeFileSync(PBXPROJ, next);
}

function main([command = 'show', part]) {
  const version = readVersion();
  if (command === 'show') {
    console.log(`version ${version}, build ${buildNumber(version)}`);
  } else if (command === 'sync') {
    sync(version);
    console.log(`iOS project set to ${version} (${buildNumber(version)})`);
  } else if (command === 'bump') {
    const next = bumpVersion(version, part || 'patch');
    writeVersion(next);
    sync(next);
    console.log(`version ${version} → ${next}, build ${buildNumber(next)}`);
  } else if (command === 'check') {
    const text = fs.readFileSync(PBXPROJ, 'utf8');
    if (syncPbxproj(text, version) !== text) {
      console.error(`The iOS project isn't at version ${version}: run "npm run version:sync"`);
      process.exit(1);
    }
    console.log(`ok: ${version} (${buildNumber(version)}) everywhere`);
  } else {
    console.error('Usage: node scripts/version.mjs [show | sync | check | bump [patch|minor|major]]');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
