// A zip archive of files stored as they are (no compression: a WAV does not shrink to anything worth the time), for
// the export of stems: one download of many files, which a browser would otherwise ask the person to allow. Written
// by hand because it is a page of code and the site has no dependency for it. No DOM, and nothing at import time.
//
//   const blob = zipBlob([{ name: "a.wav", data: arrayBufferOrUint8Array }, ...]);   // a Blob of type application/zip
//   const parts = zipParts(files);   // the same archive as a list of pieces, for `new Blob(parts)`
//   crc32(bytes);                    // the checksum a zip keeps for each file
//   const files = readZip(bytes);    // [{ name, data }] from an archive made like this one; throws an Error saying what is wrong
//
// A file's bytes go into `zipParts` as the parts they already are, and are not copied there: a stem is megabytes, and
// there are many. (The Blob made of the parts is the browser's: it keeps a copy of the bytes, so while the parts are still held
// the page has the files twice.) Not zip64: a file or an archive of 4 GiB, or 65,536 files, is refused before anything is read (a
// page cannot hold that in memory in any case).

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const VERSION = 20; // 2.0: the version that has stored files and directories, what every reader understands
const UTF8_NAMES = 0x0800; // general purpose flag, bit 11: names are UTF-8, not code page 437
const STORED = 0;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_BYTES = 22;
const MAX_FILES = 0xffff;
const MAX_BYTES = 0xfffffffe; // 0xffffffff in a header means "see the zip64 record"
const MAX_NAME_BYTES = 0xffff; // the name's length is two bytes
const MAX_COMMENT_BYTES = 0xffff; // the end record may be followed by a comment this long, so the record can sit this far from the end
const ENCRYPTED = 0x0001; // general purpose flag, bit 0
const ZIP64_MARK = 0xffff; // in a count or size field, "see the zip64 record"

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// The date and time of a file in the form a zip keeps them: two bytes each, local time, to two seconds, for the years 1980
// to 2107 (a clock that reads the epoch is held to the first of them, and one far ahead to the last, not wrapped round).
const FIRST_DOS_YEAR = 1980;
const LAST_DOS_YEAR = 2107;
function clampDate(date) {
  if (date.getFullYear() < FIRST_DOS_YEAR) return new Date(FIRST_DOS_YEAR, 0, 1, 0, 0, 0);
  if (date.getFullYear() > LAST_DOS_YEAR) return new Date(LAST_DOS_YEAR, 11, 31, 23, 59, 58);
  return date;
}
const dosTime = (date) => (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
const dosDate = (date) => ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

// A file's bytes as a Uint8Array over the same memory: an ArrayBuffer, or any view of one (a typed array, a DataView),
// whole as far as its `byteLength` goes (an Int16Array of four values is eight bytes, not four).
const viewOf = (data) =>
  ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);

// What the archive will be, checked before any byte of a file is read: the format's limits, and a name for each file.
function check(files) {
  if (files.length > MAX_FILES)
    throw new Error(`A zip cannot hold ${files.length} files: too many (the most is ${MAX_FILES}).`);
  const seen = new Set();
  let offset = 0;
  for (const { name, data } of files) {
    if (!name) throw new Error("A file in a zip needs a name.");
    if (seen.has(name)) throw new Error(`Two files in a zip are named ${name}.`);
    seen.add(name);
    const nameBytes = new TextEncoder().encode(name).length;
    if (nameBytes > MAX_NAME_BYTES) throw new Error(`The name of a file in a zip is too long (${nameBytes} bytes).`);
    if (data.byteLength > MAX_BYTES) throw new Error(`${name} is too large for a zip (4 GiB or more).`);
    offset += LOCAL_HEADER_BYTES + nameBytes + data.byteLength;
    if (offset > MAX_BYTES) throw new Error("The zip is too large (4 GiB or more).");
  }
}

export function zipParts(files, date = new Date()) {
  check(files);
  const encoder = new TextEncoder();
  const stamp = clampDate(date);
  const time = dosTime(stamp);
  const day = dosDate(stamp);
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of files) {
    const bytes = viewOf(data);
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(LOCAL_HEADER_BYTES));
    local.setUint32(0, LOCAL_SIGNATURE, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, STORED, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true); // compressed size: the same, stored
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    // (no extra field: offset 28 stays 0)
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);
    directory.push({ nameBytes, crc, size: bytes.length, offset });
    offset += LOCAL_HEADER_BYTES + nameBytes.length + bytes.length;
  }
  let directorySize = 0;
  for (const { nameBytes, crc, size, offset: at } of directory) {
    const central = new DataView(new ArrayBuffer(CENTRAL_HEADER_BYTES));
    central.setUint32(0, CENTRAL_SIGNATURE, true);
    central.setUint16(4, VERSION, true); // made by
    central.setUint16(6, VERSION, true); // needed to extract
    central.setUint16(8, UTF8_NAMES, true);
    central.setUint16(10, STORED, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    // (no extra field, comment, disk number or attributes: offsets 30 to 41 stay 0)
    central.setUint32(42, at, true);
    parts.push(new Uint8Array(central.buffer), nameBytes);
    directorySize += CENTRAL_HEADER_BYTES + nameBytes.length;
  }
  const end = new DataView(new ArrayBuffer(END_BYTES));
  end.setUint32(0, END_SIGNATURE, true);
  end.setUint16(8, directory.length, true); // entries on this disk
  end.setUint16(10, directory.length, true); // entries in all
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  parts.push(new Uint8Array(end.buffer));
  return parts;
}

export const zipBlob = (files, date) => new Blob(zipParts(files, date), { type: "application/zip" });

// The offset of the end record, which is the last thing in the file but for a comment of up to 65,535 bytes: the one
// whose comment length ends exactly at the file's end (so a comment that happens to contain the signature is not taken).
function findEnd(bytes, view) {
  const last = bytes.byteLength - END_BYTES;
  for (let at = last; at >= 0 && last - at <= MAX_COMMENT_BYTES; at--) {
    if (view.getUint32(at, true) !== END_SIGNATURE) continue;
    if (at + END_BYTES + view.getUint16(at + 20, true) === bytes.byteLength) return at;
  }
  return -1;
}

// The files of an archive written like `zipParts` does (and by any tool that stores files without compressing them), each
// as { name, data } with `data` a Uint8Array of its own (not a view into `input`). Directory entries are left out.
// Anything this cannot read for certain throws an Error: a file that is not a zip, is cut short, is encrypted or compressed
// (the reader has no inflate: it is for what this site writes), is zip64, or has a file whose checksum is wrong.
export function readZip(input) {
  const bytes = viewOf(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(bytes, view);
  if (end < 0) throw new Error("This is not a zip file (or it is cut short).");
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryAt = view.getUint32(end + 16, true);
  if (count === ZIP64_MARK || directorySize === 0xffffffff || directoryAt === 0xffffffff)
    throw new Error("Zip64 archives are not supported.");
  if (directoryAt + directorySize > end) throw new Error("The zip's directory is damaged.");

  const decoder = new TextDecoder();
  const files = [];
  const seen = new Set();
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER_BYTES > end || view.getUint32(at, true) !== CENTRAL_SIGNATURE)
      throw new Error("The zip's directory is damaged.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const nameStart = at + CENTRAL_HEADER_BYTES;
    if (nameStart + nameLength > end) throw new Error("The zip's directory is damaged.");
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    at = nameStart + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);

    if (flags & ENCRYPTED) throw new Error(`${name} is encrypted: it cannot be read.`);
    if (method !== STORED || compressed !== size) throw new Error(`${name} is compressed: it cannot be read.`);
    if (seen.has(name)) throw new Error(`Two files in the zip are named ${name}.`);
    seen.add(name);

    // The data follows the local header, which has its own name and extra field lengths. It has to end before the directory.
    if (localAt + LOCAL_HEADER_BYTES > directoryAt || view.getUint32(localAt, true) !== LOCAL_SIGNATURE)
      throw new Error(`${name} is damaged.`);
    const start =
      localAt + LOCAL_HEADER_BYTES + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (start + size > directoryAt) throw new Error(`${name} is cut short.`);
    const data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw new Error(`${name} is damaged (its checksum is wrong).`);
    if (name.endsWith("/")) continue; // a folder
    files.push({ name, data });
  }
  return files;
}
