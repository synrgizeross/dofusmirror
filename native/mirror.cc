#include <napi.h>

Napi::Value Version(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, "mirrordeck-native 0.1.0");
}

Napi::Object InitNative(Napi::Env env, Napi::Object exports) {
  exports.Set("version", Napi::Function::New(env, Version));
  return exports;
}

NODE_API_MODULE(mirror_native, InitNative)
