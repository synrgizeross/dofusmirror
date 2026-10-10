export const ControlMsgType = {
  Config: 0x01,
  InjectKeycode: 0x10,
  InjectText: 0x11,
  InjectTouchEvent: 0x12,
  InjectScrollEvent: 0x13,
  BackOrScreenOn: 0x20,
  ExpandNotificationPanel: 0x21,
  ExpandSettingsPanel: 0x22,
  CollapsePanels: 0x23,
  SetDisplayPower: 0x24,
  RotateDevice: 0x25,
  OpenHardKeyboardSettings: 0x26,
  StartApp: 0x27,
  ScanFile: 0x28,
  ResetVideo: 0x30,
  ResizeDisplay: 0x31,
  SetVideoParams: 0x32,
  RequestSyncFrame: 0x33,
  GetClipboard: 0x40,
  SetClipboard: 0x41,
  UhidCreate: 0x50,
  UhidInput: 0x51,
  UhidDestroy: 0x52,
} as const;

export const DeviceMsgType = {
  Clipboard: 0x50,
  AckClipboard: 0x51,
  UhidOutput: 0x60,
  UhidError: 0x61,
} as const;

export const MotionEvent = {
  ActionDown: 0,
  ActionUp: 1,
  ActionMove: 2,
  ActionPointerDown: 5,
  ActionPointerUp: 6,
  ButtonPrimary: 1,
  ButtonSecondary: 2,
  ButtonTertiary: 4,
  ButtonBack: 8,
  ButtonForward: 16,
  PointerIdMouse: 0xffffffffffffffffn,
  PointerIdGenericFinger: 0xfffffffffffffffen,
  PointerIdVirtualFinger: 0xfffffffffffffffdn,
};

export const KeyCode = {
  Home: 3,
  Back: 4,
  DpadUp: 19,
  DpadDown: 20,
  DpadLeft: 21,
  DpadRight: 22,
  VolumeUp: 24,
  VolumeDown: 25,
  Power: 26,
  Wakeup: 224,
  Tab: 61,
  Space: 62,
  Enter: 66,
  Del: 67,
  Escape: 111,
  AppSwitch: 187,
};

export interface EngineOptions {
  maxSize: number;
  maxFps: number;
  videoBitRate: number;
  videoCodec: "auto" | "h264" | "h265" | "av1";
  stayAwake: boolean;
  audio: boolean;
  newDisplay?: string | null;
  autoLaunchPackage?: string | null;
  clipboardAutosync: boolean;
}

const CHAN_CONTROL = 3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class ControlChannel {
  private socket: import("net").Socket | null = null;
  private queue: Buffer[] = [];
  private closed = false;

  constructor(
    private onClipboard: (text: string) => void,
    private onFault: () => void
  ) {}

  attach(socket: import("net").Socket) {
    this.socket = socket;
    const queued = this.queue;
    this.queue = [];
    for (const frame of queued) this.rawWrite(frame);
  }

  private rawWrite(frame: Buffer) {
    if (!this.socket || this.socket.destroyed) return;
    try {
      this.socket.write(frame);
    } catch {
      this.onFault();
    }
  }

  private send(msg: Buffer) {
    if (this.closed) return;
    const frame = Buffer.allocUnsafe(5 + msg.length);
    frame[0] = CHAN_CONTROL;
    frame.writeUInt32BE(msg.length, 1);
    msg.copy(frame, 5);
    if (!this.socket) {
      if (this.queue.length < 1024) this.queue.push(frame);
      else this.onFault();
      return;
    }
    this.rawWrite(frame);
  }

  feedDeviceMessage(payload: Buffer) {
    if (payload.length < 1) return;
    const type = payload[0];
    if (type === DeviceMsgType.Clipboard) {
      if (payload.length < 5) return;
      const len = payload.readUInt32BE(1);
      if (len > payload.length - 5) return;
      this.onClipboard(payload.slice(5, 5 + len).toString("utf8"));
    }
  }

  sendConfig(o: EngineOptions) {
    const fields: { id: number; value: Buffer }[] = [];
    const field = (id: number, v: Buffer) => fields.push({ id, value: v });
    const u8 = (id: number, v: number) => field(id, Buffer.from([v]));
    const u16 = (id: number, v: number) => {
      const b = Buffer.allocUnsafe(2);
      b.writeUInt16BE(v, 0);
      field(id, b);
    };
    const u32 = (id: number, v: number) => {
      const b = Buffer.allocUnsafe(4);
      b.writeUInt32BE(v >>> 0, 0);
      field(id, b);
    };

    u8(0x01, o.audio ? 1 : 0);
    u8(0x02, o.videoCodec === "h264" ? 1 : o.videoCodec === "h265" ? 2 : o.videoCodec === "av1" ? 3 : 0);
    u8(0x03, 0);
    if (o.maxSize > 0) u16(0x04, Math.min(o.maxSize, 0xffff));
    if (o.maxFps > 0) u8(0x05, Math.min(o.maxFps, 0xff));
    if (o.videoBitRate > 0) u32(0x06, o.videoBitRate);
    const flags = (o.stayAwake ? 2 : 0) | 4 | 8 | 16 | (o.clipboardAutosync ? 32 : 0) | 1;
    u16(0x07, flags);
    if (o.newDisplay) {
      const m = /^(\d+)x(\d+)(?:\/(\d+))?$/.exec(o.newDisplay);
      if (m) {
        const nd = Buffer.allocUnsafe(6);
        nd.writeUInt16BE(parseInt(m[1], 10), 0);
        nd.writeUInt16BE(parseInt(m[2], 10), 2);
        nd.writeUInt16BE(m[3] ? parseInt(m[3], 10) : 0, 4);
        field(0x08, nd);
      }
    }
    if (o.autoLaunchPackage) field(0x09, Buffer.from(o.autoLaunchPackage, "utf8"));
    u8(0x0a, 2);

    const tlvParts: Buffer[] = [];
    for (const f of fields) tlvParts.push(Buffer.from([f.id, f.value.length]), f.value);
    const tlv = Buffer.concat(tlvParts);
    const msg = Buffer.concat([Buffer.from([ControlMsgType.Config]), tlv]);
    this.send(msg);
  }

  injectTouch(
    action: number,
    pointerId: bigint,
    x: number,
    y: number,
    w: number,
    h: number,
    pressure: number,
    actionButton: number,
    buttons: number
  ) {
    const buf = Buffer.allocUnsafe(32);
    buf[0] = ControlMsgType.InjectTouchEvent;
    buf[1] = action;
    buf.writeBigUInt64BE(pointerId, 2);
    buf.writeUInt32BE(x >>> 0, 10);
    buf.writeUInt32BE(y >>> 0, 14);
    buf.writeUInt16BE(w, 18);
    buf.writeUInt16BE(h, 20);
    buf.writeUInt16BE(clamp(Math.round(pressure * 0xffff), 0, 0xffff), 22);
    buf.writeUInt32BE(actionButton >>> 0, 24);
    buf.writeUInt32BE(buttons >>> 0, 28);
    this.send(buf);
  }

  injectScroll(x: number, y: number, w: number, h: number, hscroll: number, vscroll: number, buttons: number) {
    const buf = Buffer.allocUnsafe(21);
    buf[0] = ControlMsgType.InjectScrollEvent;
    buf.writeUInt32BE(x >>> 0, 1);
    buf.writeUInt32BE(y >>> 0, 5);
    buf.writeUInt16BE(w, 9);
    buf.writeUInt16BE(h, 11);
    const enc = (v: number) => (clamp(Math.round(clamp(v, -16, 16) * 2048), -32768, 32767) & 0xffff);
    buf.writeUInt16BE(enc(hscroll), 13);
    buf.writeUInt16BE(enc(vscroll), 15);
    buf.writeUInt32BE(buttons >>> 0, 17);
    this.send(buf);
  }

  injectKey(action: number, keycode: number, repeat = 0, metastate = 0) {
    const buf = Buffer.allocUnsafe(14);
    buf[0] = ControlMsgType.InjectKeycode;
    buf[1] = action;
    buf.writeInt32BE(keycode, 2);
    buf.writeUInt32BE(repeat >>> 0, 6);
    buf.writeUInt32BE(metastate >>> 0, 10);
    this.send(buf);
  }

  injectKeyPress(keycode: number, metastate = 0) {
    this.injectKey(0, keycode, 0, metastate);
    this.injectKey(1, keycode, 0, metastate);
  }

  injectText(text: string) {
    let bytes = Buffer.from(text, "utf8");
    if (bytes.length > 300) bytes = bytes.slice(0, 300);
    const buf = Buffer.allocUnsafe(5 + bytes.length);
    buf[0] = ControlMsgType.InjectText;
    buf.writeUInt32BE(bytes.length, 1);
    bytes.copy(buf, 5);
    this.send(buf);
  }

  pinch(cx: number, cy: number, w: number, h: number, zoomIn: boolean) {
    const d0 = Math.round(h * 0.08);
    const d1 = Math.round(h * (zoomIn ? 0.3 : 0.02));
    const from = zoomIn ? d0 : d1;
    const to = zoomIn ? d1 : d0;
    const id1 = MotionEvent.PointerIdMouse;
    const id2 = MotionEvent.PointerIdVirtualFinger;

    this.injectTouch(MotionEvent.ActionDown, id1, cx, Math.max(0, cy - from), w, h, 1, MotionEvent.ButtonPrimary, MotionEvent.ButtonPrimary);
    this.injectTouch(
      (MotionEvent.ActionPointerDown | (1 << 8)) >>> 0,
      id2,
      cx,
      Math.min(h - 1, cy + from),
      w,
      h,
      1,
      0,
      MotionEvent.ButtonPrimary
    );

    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const d = Math.max(0, Math.round(from + (to - from) * t));
      this.injectTouch(MotionEvent.ActionMove, id1, cx, Math.max(0, cy - d), w, h, 1, 0, MotionEvent.ButtonPrimary);
      this.injectTouch(MotionEvent.ActionMove, id2, cx, Math.min(h - 1, cy + d), w, h, 1, 0, MotionEvent.ButtonPrimary);
    }

    this.injectTouch(
      (MotionEvent.ActionPointerUp | (1 << 8)) >>> 0,
      id2,
      cx,
      Math.min(h - 1, cy + to),
      w,
      h,
      MotionEvent.ButtonPrimary,
      0,
      0
    );
    this.injectTouch(MotionEvent.ActionUp, id1, cx, Math.max(0, cy - to), w, h, 0, MotionEvent.ButtonPrimary, 0);
  }

  startApp(spec: string) {
    let bytes = Buffer.from(spec, "utf8");
    if (bytes.length > 255) bytes = bytes.slice(0, 255);
    const buf = Buffer.allocUnsafe(2 + bytes.length);
    buf[0] = ControlMsgType.StartApp;
    buf[1] = bytes.length;
    bytes.copy(buf, 2);
    this.send(buf);
  }

  backOrScreenOn(action: number) {
    const buf = Buffer.from([ControlMsgType.BackOrScreenOn, action]);
    this.send(buf);
  }

  sendSimple(type: number) {
    this.send(Buffer.from([type]));
  }

  setDisplayPower(on: boolean) {
    this.send(Buffer.from([ControlMsgType.SetDisplayPower, on ? 1 : 0]));
  }

  setVideoParams(bitRate: number, suspend: boolean) {
    const buf = Buffer.allocUnsafe(6);
    buf[0] = ControlMsgType.SetVideoParams;
    buf.writeInt32BE(bitRate, 1);
    buf[5] = suspend ? 1 : 0;
    this.send(buf);
  }

  setClipboard(text: string, paste: boolean) {
    const bytes = Buffer.from(text, "utf8");
    const buf = Buffer.allocUnsafe(14 + bytes.length);
    buf[0] = ControlMsgType.SetClipboard;
    buf.writeBigUInt64BE(BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)), 1);
    buf[9] = paste ? 1 : 0;
    buf.writeUInt32BE(bytes.length, 10);
    bytes.copy(buf, 14);
    this.send(buf);
  }

  dispose() {
    this.closed = true;
    this.queue = [];
  }
}
