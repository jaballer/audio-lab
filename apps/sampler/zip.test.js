import { describe, expect, it } from "vitest";
import { crc32, readZip as readArchive, zipBlob, zipParts } from "./zip.js";

const bytes = (text) => new TextEncoder().encode(text);
const DATE = new Date(2026, 10, 9, 13, 45, 30); // 9 Nov 2026, 13:45:30 local time

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(new Uint8Array(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength), at);
    at += part.byteLength;
  }
  return out;
};

// A reader as small as the writer, so the archive is checked against the format and not against the writer's own idea of it:
// the end record, then the central directory it points to, then each local header and the data after it.
function readZip(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.byteLength - 22; // no comment, so the end record is the last 22 bytes
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  const directorySize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  expect(at + directorySize).toBe(end);
  const files = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const entry = {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      crc: view.getUint32(at + 16, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
    };
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    entry.name = new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    // The local header repeats the entry, and the data follows it.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint16(offset + 6, true)).toBe(entry.flags); // a reader that goes by the local header needs the flag there too
    expect(view.getUint32(offset + 14, true)).toBe(entry.crc);
    expect(view.getUint32(offset + 18, true)).toBe(entry.compressed);
    expect(view.getUint32(offset + 22, true)).toBe(entry.size);
    const localName = view.getUint16(offset + 26, true);
    const start = offset + 30 + localName + view.getUint16(offset + 28, true);
    entry.data = archive.subarray(start, start + entry.size);
    files.push(entry);
  }
  return files;
}

describe("crc32", () => {
  it("is the standard check value for '123456789'", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("is 0 for nothing, and not negative for a value with the top bit set", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes("123456789"))).toBeGreaterThan(0);
  });

  it("depends on every byte, and on their order", () => {
    expect(crc32(bytes("ab"))).not.toBe(crc32(bytes("ba")));
    expect(crc32(bytes("abc"))).not.toBe(crc32(bytes("abd")));
  });

  it("reads only the view it is given, not the whole buffer behind it", () => {
    const whole = bytes("xx123456789yy");
    expect(crc32(whole.subarray(2, 11))).toBe(0xcbf43926);
  });
});

describe("zipParts", () => {
  const files = [
    { name: "one.wav", data: bytes("first file") },
    { name: "two.wav", data: bytes("the second, a little longer") },
  ];

  it("is an archive that stores each file as it is, with its name, size and checksum, in order", () => {
    const entries = readZip(join(zipParts(files, DATE)));
    expect(entries.map((entry) => entry.name)).toEqual(["one.wav", "two.wav"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe("first file");
    expect(new TextDecoder().decode(entries[1].data)).toBe("the second, a little longer");
    for (const entry of entries) {
      expect(entry.method).toBe(0); // stored: a WAV does not compress to anything worth the time
      expect(entry.compressed).toBe(entry.size);
      expect(entry.crc).toBe(crc32(entry.data));
    }
  });

  it("takes a file's bytes from an ArrayBuffer or a view of one", () => {
    const buffer = bytes("xxhelloyy").buffer;
    const entries = readZip(
      join(
        zipParts(
          [
            { name: "a", data: buffer },
            { name: "b", data: new Uint8Array(buffer, 2, 5) },
          ],
          DATE,
        ),
      ),
    );
    expect(new TextDecoder().decode(entries[0].data)).toBe("xxhelloyy");
    expect(new TextDecoder().decode(entries[1].data)).toBe("hello");
  });

  it("does not copy a file's bytes: they go into the archive as the parts they already are", () => {
    const data = bytes("not copied");
    const parts = zipParts([{ name: "a", data }], DATE);
    expect(parts.some((part) => part.buffer === data.buffer && part.byteLength === data.byteLength)).toBe(true);
  });

  it("takes every byte of a typed array or a DataView, not the number of its elements", () => {
    const ints = Int16Array.of(1000, -2000, 300, 4000);
    const view = new DataView(Uint8Array.of(9, 8, 7, 6, 5).buffer, 1, 3);
    const entries = readZip(
      join(
        zipParts(
          [
            { name: "ints", data: ints },
            { name: "view", data: view },
            { name: "floats", data: Float32Array.of(0.5, -0.5) },
          ],
          DATE,
        ),
      ),
    );
    expect(entries.map((entry) => entry.size)).toEqual([8, 3, 8]);
    expect([...entries[0].data]).toEqual([...new Uint8Array(ints.buffer)]);
    expect([...entries[1].data]).toEqual([8, 7, 6]);
    expect(entries[2].crc).toBe(crc32(new Uint8Array(Float32Array.of(0.5, -0.5).buffer)));
  });

  it("holds a date outside what a zip can say to its first or last year, and does not wrap it round", () => {
    const [early] = readZip(join(zipParts([files[0]], new Date(1970, 0, 1, 0, 0, 0))));
    expect(early.date).toBe(((1980 - 1980) << 9) | (1 << 5) | 1);
    expect(early.time).toBe(0);
    const [late] = readZip(join(zipParts([files[0]], new Date(2200, 5, 5, 12, 0, 0))));
    expect(late.date).toBe(((2107 - 1980) << 9) | (12 << 5) | 31);
    expect(late.time).toBe((23 << 11) | (59 << 5) | 29);
  });

  it("writes the time and date in DOS form, local, to two seconds", () => {
    const [entry] = readZip(join(zipParts([files[0]], DATE)));
    expect(entry.time).toBe((13 << 11) | (45 << 5) | 15);
    expect(entry.date).toBe(((2026 - 1980) << 9) | (11 << 5) | 9);
  });

  it("marks a name as UTF-8, and keeps it", () => {
    const [entry] = readZip(join(zipParts([{ name: "pad03-caja-é.wav", data: bytes("x") }], DATE)));
    expect(entry.flags & 0x0800).toBe(0x0800);
    expect(entry.name).toBe("pad03-caja-é.wav");
  });

  it("is a valid, empty archive for no files", () => {
    const archive = join(zipParts([], DATE));
    expect(archive).toHaveLength(22);
    expect(readZip(archive)).toEqual([]);
  });

  it("handles a file with no bytes", () => {
    const [entry] = readZip(join(zipParts([{ name: "empty", data: new Uint8Array(0) }], DATE)));
    expect(entry).toMatchObject({ name: "empty", size: 0, crc: 0 });
  });

  it("refuses two files of one name (an archive with two is ambiguous), and an empty name", () => {
    expect(() => zipParts([files[0], { ...files[1], name: "one.wav" }], DATE)).toThrow(/one\.wav/);
    expect(() => zipParts([{ name: "", data: bytes("x") }], DATE)).toThrow(/name/);
  });

  it("refuses a name too long for the two bytes that say how long it is (counted in bytes, not characters)", () => {
    expect(() => zipParts([{ name: "a".repeat(65536), data: bytes("x") }], DATE)).toThrow(/too long/i);
    expect(() => zipParts([{ name: "é".repeat(40000), data: bytes("x") }], DATE)).toThrow(/too long/i); // 80,000 bytes
    expect(() => zipParts([{ name: "a".repeat(65535), data: bytes("x") }], DATE)).not.toThrow();
  });

  it("refuses what the format cannot hold, before it reads the bytes: a file of 4 GiB, or 65,536 files", () => {
    const huge = { name: "huge", data: { byteLength: 2 ** 32 } };
    expect(() => zipParts([huge], DATE)).toThrow(/too large/i);
    const many = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: new Uint8Array(0) }));
    expect(() => zipParts(many, DATE)).toThrow(/too many/i);
  });

  it("refuses an archive that, with its headers, would pass 4 GiB", () => {
    const nearly = (name) => ({ name, data: { byteLength: 2 ** 32 - 1000 } });
    // Each file is just under the limit alone; two of them together put the second one's offset past it.
    expect(() => zipParts([nearly("a"), nearly("b")], DATE)).toThrow(/too large/i);
  });
});

describe("zipBlob", () => {
  it("is the archive as one Blob, typed as a zip", async () => {
    const blob = zipBlob([{ name: "a.txt", data: bytes("hello") }], DATE);
    expect(blob.type).toBe("application/zip");
    const [entry] = readZip(new Uint8Array(await blob.arrayBuffer()));
    expect(new TextDecoder().decode(entry.data)).toBe("hello");
  });
});

describe("readZip", () => {
  const archive = (files) => join(zipParts(files, DATE));
  const text = (data) => new TextDecoder().decode(data);

  it("gives back the files that zipParts wrote, in order, with their bytes", () => {
    const files = readArchive(
      archive([
        { name: "a.txt", data: bytes("hello") },
        { name: "b/c.bin", data: new Uint8Array([0, 255, 7]) },
      ]),
    );
    expect(files.map((file) => file.name)).toEqual(["a.txt", "b/c.bin"]);
    expect(text(files[0].data)).toBe("hello");
    expect([...files[1].data]).toEqual([0, 255, 7]);
  });

  it("reads an empty archive, an empty file and a name that is not ASCII", () => {
    expect(readArchive(archive([]))).toEqual([]);
    const files = readArchive(archive([{ name: "é-音.txt", data: new Uint8Array(0) }]));
    expect(files[0].name).toBe("é-音.txt");
    expect(files[0].data.length).toBe(0);
  });

  it("gives each file its own bytes, not a view of the archive", () => {
    const whole = archive([{ name: "a", data: bytes("abc") }]);
    const [file] = readArchive(whole);
    expect(file.data.buffer.byteLength).toBe(3);
    whole.fill(0);
    expect(text(file.data)).toBe("abc");
  });

  it("leaves out folders", () => {
    const files = readArchive(
      archive([
        { name: "dir/", data: new Uint8Array(0) },
        { name: "dir/a", data: bytes("x") },
      ]),
    );
    expect(files.map((file) => file.name)).toEqual(["dir/a"]);
  });

  it("finds the end record before a comment, even one that holds the signature", () => {
    const whole = archive([{ name: "a", data: bytes("abc") }]);
    const comment = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 1, 2, 3, 4]);
    const withComment = new Uint8Array(whole.length + comment.length);
    withComment.set(whole);
    withComment.set(comment, whole.length);
    new DataView(withComment.buffer).setUint16(whole.length - 2, comment.length, true);
    expect(readArchive(withComment).map((file) => file.name)).toEqual(["a"]);
  });

  it("takes an ArrayBuffer as well as a Uint8Array", () => {
    const whole = archive([{ name: "a", data: bytes("abc") }]);
    expect(readArchive(whole.buffer)[0].name).toBe("a");
  });

  it("refuses what is not a zip, or is cut short", () => {
    expect(() => readArchive(bytes("this is not a zip file at all, just text"))).toThrow(/not a zip/);
    expect(() => readArchive(new Uint8Array(0))).toThrow(/not a zip/);
    const whole = archive([{ name: "a", data: bytes("abcdef") }]);
    expect(() => readArchive(whole.subarray(0, whole.length - 10))).toThrow(/not a zip/);
  });

  it("refuses a file whose checksum is wrong", () => {
    const whole = archive([{ name: "a", data: bytes("abcdef") }]);
    whole[30 + 1] ^= 0xff; // a byte of the data: after the 30 byte header and the one byte name
    expect(() => readArchive(whole)).toThrow(/checksum/);
  });

  it("refuses a compressed or encrypted file instead of reading its bytes as they are", () => {
    const compressed = archive([{ name: "a", data: bytes("abc") }]);
    const view = new DataView(compressed.buffer);
    const central = view.getUint32(compressed.length - 22 + 16, true);
    view.setUint16(central + 10, 8, true); // deflate
    expect(() => readArchive(compressed)).toThrow(/compressed/);

    const encrypted = archive([{ name: "a", data: bytes("abc") }]);
    const at = new DataView(encrypted.buffer).getUint32(encrypted.length - 22 + 16, true);
    new DataView(encrypted.buffer).setUint16(at + 8, 1, true);
    expect(() => readArchive(encrypted)).toThrow(/encrypted/);
  });

  it("refuses a directory that points outside the file", () => {
    const whole = archive([{ name: "a", data: bytes("abc") }]);
    new DataView(whole.buffer).setUint32(whole.length - 22 + 16, whole.length + 100, true);
    expect(() => readArchive(whole)).toThrow(/damaged/);
  });

  it("refuses a local header offset that does not point at one", () => {
    const whole = archive([{ name: "a", data: bytes("abc") }]);
    const view = new DataView(whole.buffer);
    const central = view.getUint32(whole.length - 22 + 16, true);
    view.setUint32(central + 42, 5, true);
    expect(() => readArchive(whole)).toThrow(/damaged/);
  });

  it("refuses entries that share the same bytes, which would give far more data than the file holds", () => {
    const whole = archive([{ name: "a", data: new Uint8Array(1000) }]);
    // Add a second central entry for another name, pointing at the same local header, by rebuilding the directory.
    const view = new DataView(whole.buffer, whole.byteOffset);
    const endAt = whole.length - 22;
    const directoryAt = view.getUint32(endAt + 16, true);
    const entry = whole.slice(directoryAt, endAt); // the one central record, with its name "a"
    const twin = entry.slice();
    twin[46] = "b".charCodeAt(0);
    const out = new Uint8Array(directoryAt + entry.length * 2 + 22);
    out.set(whole.subarray(0, directoryAt));
    out.set(entry, directoryAt);
    out.set(twin, directoryAt + entry.length);
    out.set(whole.subarray(endAt), directoryAt + entry.length * 2);
    const end = new DataView(out.buffer, directoryAt + entry.length * 2);
    end.setUint16(8, 2, true);
    end.setUint16(10, 2, true);
    end.setUint32(12, entry.length * 2, true);
    expect(() => readArchive(out)).toThrow(/overlap|more data/);
  });
});
