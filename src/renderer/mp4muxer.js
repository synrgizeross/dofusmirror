const u8 = (...v) => Uint8Array.from(v);

class Box {
  constructor(type) {
    this.type = type;
    this.parts = [];
    this.size = 8;
  }
  add(...payloads) {
    for (const p of payloads) {
      this.parts.push(p);
      this.size += p.length;
    }
    return this;
  }
  build() {
    const out = new Uint8Array(this.size);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, this.size);
    for (let i = 0; i < 4; i++) out[4 + i] = this.type.charCodeAt(i);
    let off = 8;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  buildLen() {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, this.size);
    return out;
  }
}

const u16a = (...vals) => {
  const a = new Uint8Array(2 * vals.length);
  const dv = new DataView(a.buffer);
  vals.forEach((v, i) => dv.setUint16(i * 2, v & 0xffff));
  return a;
};

const u32a = (...vals) => {
  const a = new Uint8Array(4 * vals.length);
  const dv = new DataView(a.buffer);
  vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0));
  return a;
};

function box(type, ...payloads) {
  return new Box(type).add(...payloads).build();
}

function fullBox(type, version, flags, ...payloads) {
  return new Box(type).add(u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...payloads).build();
}

function findStartCodes(data) {
  const starts = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts;
}

function annexBToLengthPrefixed(data) {
  const starts = findStartCodes(data);
  const parts = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    let end = data.length;
    if (i + 1 < starts.length) end = starts[i + 1] - 3;
    while (end > start && data[end - 1] === 0) end--;
    const len = end - start;
    if (len <= 0) continue;
    parts.push(u32a(len), data.slice(start, end));
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const MATRIX = u32a(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

class MP4Writer {
  constructor(opts = {}) {
    this.width = opts.width || 0;
    this.height = opts.height || 0;
    this.timescale = 1000000;
    this.codec = "avc";
    this.sps = null;
    this.pps = null;
    this.vps = null;
    this.ptl = null;
    this.samples = [];
    this.firstPts = null;
    this.duration = 0;
  }

  setParameterSets(sps, pps, codec = "avc", extra = null) {
    this.codec = codec;
    if (sps && !this.sps) this.sps = Uint8Array.from(sps);
    if (pps && !this.pps) this.pps = Uint8Array.from(pps);
    if (extra) {
      this.vps = extra.vps ? Uint8Array.from(extra.vps) : null;
      this.ptl = extra.ptl || null;
    }
  }

  isReady() {
    if (this.codec === "hev") return !!(this.sps && this.pps);
    return !!(this.sps && this.pps && this.width && this.height);
  }

  addSample(data, ptsUs, isKey) {
    if (!this.isReady()) return false;
    if (this.firstPts === null) this.firstPts = ptsUs;
    this.samples.push({ bytes: annexBToLengthPrefixed(data), pts: ptsUs - this.firstPts, key: !!isKey });
    this.duration = Math.max(this.duration, ptsUs - this.firstPts);
    return true;
  }

  avcC() {
    const sps = this.sps;
    const pps = this.pps;
    return box(
      "avcC",
      u8(1, sps[1], sps[2], sps[3], 0xff, 0xe1, (sps.length >> 8) & 0xff, sps.length & 0xff),
      sps,
      u8(1, (pps.length >> 8) & 0xff, pps.length & 0xff),
      pps
    );
  }

  hvcC() {
    const p = this.ptl || {};
    const naluArray = (type, data) => {
      if (!data) return null;
      return [u8(0x80 | type), u16a(1), u16a(data.length), data];
    };
    const arrays = [naluArray(32, this.vps), naluArray(33, this.sps), naluArray(34, this.pps)].filter(Boolean);
    return box(
      "hvcC",
      u8(
        1,
        ((p.profileSpace || 0) << 6) | ((p.tier || 0) << 5) | (p.profileIdc || 1),
        ((p.compat >>> 24) & 0xff) & 0xff,
        (p.compat >>> 16) & 0xff,
        (p.compat >>> 8) & 0xff,
        p.compat & 0xff,
        ...(p.constraints || [0, 0, 0, 0, 0, 0]),
        p.levelIdc || 0,
        0xf0,
        0,
        0xfc,
        0xfd,
        0xf8,
        0xf8,
        0,
        0,
        0x0f,
        arrays.length
      ),
      ...arrays.flat()
    );
  }

  sampleEntry() {
    if (this.codec === "hev") {
      const name = "MirrorDeck";
      const compressorname = new Uint8Array(32);
      compressorname[0] = name.length;
      for (let i = 0; i < name.length; i++) compressorname[i + 1] = name.charCodeAt(i);
      return box(
        "hvc1",
        new Uint8Array(6),
        u16a(1),
        new Uint8Array(16),
        u16a(this.width, this.height),
        u32a(0x00480000, 0x00480000, 0),
        u16a(1),
        compressorname,
        u16a(0x0018, 0xffff),
        this.hvcC()
      );
    }
    return this.avc1();
  }

  avc1() {
    const name = "MirrorDeck";
    const compressorname = new Uint8Array(32);
    compressorname[0] = name.length;
    for (let i = 0; i < name.length; i++) compressorname[i + 1] = name.charCodeAt(i);
    return box(
      "avc1",
      new Uint8Array(6),
      u16a(1),
      new Uint8Array(16),
      u16a(this.width, this.height),
      u32a(0x00480000, 0x00480000, 0),
      u16a(1),
      compressorname,
      u16a(0x0018, 0xffff),
      this.avcC()
    );
  }

  moov(sampleTable) {
    const duration = Math.max(this.duration, 0);
    const mvhd = fullBox(
      "mvhd",
      0,
      0,
      u32a(0, 0, this.timescale, duration),
      u32a(0x00010000),
      u16a(0x0100, 0),
      u32a(0, 0),
      MATRIX,
      new Uint8Array(24),
      u32a(2)
    );
    const tkhd = fullBox(
      "tkhd",
      0,
      0x000007,
      u32a(0, 0, 1, 0, duration),
      new Uint8Array(8),
      u16a(0, 0, 0, 0),
      MATRIX,
      u32a((this.width << 16) >>> 0, (this.height << 16) >>> 0)
    );
    const mdhd = fullBox("mdhd", 0, 0, u32a(0, 0, this.timescale, duration), u16a(0x55c4, 0));
    const hdlr = fullBox(
      "hdlr",
      0,
      0,
      u32a(0),
      u8(0x76, 0x69, 0x64, 0x65, 0x6f, 0x72),
      new Uint8Array(12),
      box("nmhd", new Uint8Array(4))
    );
    const dinf = box("dinf", fullBox("dref", 0, 0, u32a(1), fullBox("url ", 0, 1)));
    const stsd = fullBox("stsd", 0, 0, u32a(1), this.sampleEntry());
    const stbl = box("stbl", stsd, sampleTable.stts, sampleTable.stsc, sampleTable.stsz, sampleTable.stco);
    const minf = box("minf", fullBox("vmhd", 0, 1, u16a(0, 0, 0, 0)), dinf, stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    const trak = box("trak", tkhd, mdia);
    return box("moov", mvhd, trak);
  }

  buildSampleTables() {
    const n = this.samples.length;
    const sizes = new Uint8Array(4 * n);
    const sdv = new DataView(sizes.buffer);
    for (let i = 0; i < n; i++) sdv.setUint32(i * 4, this.samples[i].bytes.length);

    const runs = [];
    for (let i = 0; i < n; i++) {
      const next = i + 1 < n ? this.samples[i + 1].pts : this.samples[i].pts + 33333;
      const dur = Math.max(1, next - this.samples[i].pts);
      const last = runs[runs.length - 1];
      if (last && last[1] === dur) last[0]++;
      else runs.push([1, dur]);
    }
    const sttsData = new Uint8Array(8 * runs.length);
    const tdv = new DataView(sttsData.buffer);
    runs.forEach((r, i) => {
      tdv.setUint32(i * 8, r[0]);
      tdv.setUint32(i * 8 + 4, r[1]);
    });

    const stts = fullBox("stts", 0, 0, u32a(runs.length), sttsData);
    const stsz = fullBox("stsz", 0, 0, u32a(0, n), sizes);
    const stsc = fullBox("stsc", 0, 0, u32a(1), u32a(1, n, 1));
    return { stts, stsz, stsc };
  }

  ftyp() {
    return box(
      "ftyp",
      u8(0x69, 0x73, 0x6f, 0x6d),
      u32a(0x200),
      u8(0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31)
    );
  }

  fragment(sample) {
    const idx = this.samples.indexOf(sample);
    const next = idx + 1 < this.samples.length ? this.samples[idx + 1].pts : sample.pts + 33333;
    const dur = Math.max(1, next - sample.pts);

    const mfhd = fullBox("mfhd", 0, 0, u32a(idx + 1));
    const tfhd = fullBox("tfhd", 0, 0x020000, u32a(1));
    const tfdt = fullBox("tfdt", 1, 0, u32a(sample.pts >>> 0, Math.floor(sample.pts / 4294967296)));
    const trun = new Box("trun")
      .add(u8(1, 0x00, 0x07, 0x01), u32a(1), u32a(0), u32a(dur), u32a(sample.bytes.length), u32a(sample.key ? 0x02000000 : 0x01010000))
      .build();
    const traf = new Box("traf").add(tfhd, tfdt, trun).build();
    const moof = new Box("moof").add(mfhd, traf).build();

    const dv = new DataView(moof.buffer);
    const trunStart = 8 + mfhd.length + 8 + tfhd.length + tfdt.length;
    dv.setUint32(trunStart + 16, moof.length + 8);

    const mdatSize = 8 + sample.bytes.length;
    const mdat = new Uint8Array(8);
    new DataView(mdat.buffer).setUint32(0, mdatSize);
    mdat[4] = 0x6d;
    mdat[5] = 0x64;
    mdat[6] = 0x61;
    mdat[7] = 0x74;

    return { parts: [moof, mdat, sample.bytes] };
  }

  finalize() {
    if (!this.isReady() || this.samples.length === 0) return null;

    const tables = this.buildSampleTables();
    const ftyp = this.ftyp();

    const withOffset = (offset) =>
      this.moov({
        stts: tables.stts,
        stsz: tables.stsz,
        stsc: tables.stsc,
        stco: fullBox("stco", 0, 0, u32a(1), u32a(offset)),
      });

    const moofLen = withOffset(0).length;
    const mdatDataOffset = ftyp.length + moofLen + 8;
    const moov = withOffset(mdatDataOffset);

    let mdatSize = 8;
    for (const s of this.samples) mdatSize += s.bytes.length;
    const mdat = new Uint8Array(mdatSize);
    new DataView(mdat.buffer).setUint32(0, mdatSize);
    mdat[4] = 0x6d;
    mdat[5] = 0x64;
    mdat[6] = 0x61;
    mdat[7] = 0x74;
    let off = 8;
    for (const s of this.samples) {
      mdat.set(s.bytes, off);
      off += s.bytes.length;
    }

    const parts = [ftyp, moov, mdat];
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { MP4Writer, annexBToLengthPrefixed };
} else {
  window.MP4Writer = MP4Writer;
}