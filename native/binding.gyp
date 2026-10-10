{
  "targets": [
    {
      "target_name": "mirror_native",
      "sources": ["mirror.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}
