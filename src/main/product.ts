export const APP_NAME = "DofusMirror";
export const ENGINE_TAG = "dofusmirror";
export const SOCKET_TAG = "touchmirror";
export const SERVER_MAIN_CLASS = "com.touchmirror.engine.Server";
export const SERVER_VERSION = "3.0";
export const PROTOCOL_VERSION = 3;
export const HELLO_MAGIC = 0x544d4952;

/** Title bar height in px. Must match the renderer header (h-12). */
export const TITLE_BAR_HEIGHT = 48;

/** Colours for the Windows/Linux native title bar overlay. Derived from the
 *  shadcn tokens in src/renderer/src/index.css (oklch -> sRGB hex). */
export const OVERLAY = {
  color: "#07080a", // --sidebar
  symbolColor: "#f3f3f5", // --foreground
};
