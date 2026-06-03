{
  "targets": [
    {
      "target_name": "kittentts_native",
      "sources": [
        "native/node/kittentts_native_node.cpp",
        "<!@(node scripts/list-native-engine-sources.js)"
      ],
      "include_dirs": [
        "native/cpp-engine/include",
        "native/cpp-engine/src"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-O3",
        "-march=native",
        "-DNDEBUG",
        "-fexceptions",
        "-frtti",
        "-ffast-math",
        "-fno-finite-math-only",
        "-funroll-loops",
        "-ftree-vectorize",
        "-flto=thin"
      ],
      "ldflags": [
        "-flto=thin"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "GCC_ENABLE_CPP_RTTI": "YES",
        "OTHER_CPLUSPLUSFLAGS": [
          "-std=c++17",
          "-O3",
          "-march=native",
          "-DNDEBUG",
          "-fexceptions",
          "-frtti",
          "-ffast-math",
          "-fno-finite-math-only",
          "-funroll-loops",
          "-ftree-vectorize",
          "-flto=thin"
        ],
        "OTHER_LDFLAGS": [
          "-flto=thin"
        ]
      }
    }
  ]
}
