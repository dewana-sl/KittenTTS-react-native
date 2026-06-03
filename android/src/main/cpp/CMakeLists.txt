cmake_minimum_required(VERSION 3.18)
project(kittenttsnative)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(KITTENTTS_NATIVE_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../../native/cpp-engine")

file(GLOB_RECURSE KITTENTTS_NATIVE_SOURCES
  "${KITTENTTS_NATIVE_ROOT}/src/*.cpp"
)

add_library(kittenttsnative SHARED
  kittentts_native_jni.cpp
  ${KITTENTTS_NATIVE_SOURCES}
)

target_include_directories(kittenttsnative PRIVATE
  "${KITTENTTS_NATIVE_ROOT}/include"
  "${KITTENTTS_NATIVE_ROOT}/src"
)

target_compile_options(kittenttsnative PRIVATE
  -O3
  -ffast-math
  -fno-finite-math-only
  -funroll-loops
  -frtti
  -fexceptions
)
