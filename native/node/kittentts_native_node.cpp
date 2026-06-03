#include <node_api.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "../cpp-engine/include/kitten_native_engine.h"

namespace {

std::unordered_map<int64_t, KTNativeModelHandle> g_models;
int64_t g_next_model_id = 1;

void throw_error(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
}

bool get_string(napi_env env, napi_value value, std::string& out) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return false;
  }
  out.resize(length);
  size_t copied = 0;
  return napi_get_value_string_utf8(env, value, out.data(), length + 1, &copied) == napi_ok;
}

bool get_i64(napi_env env, napi_value value, int64_t& out) {
  double number = 0;
  if (napi_get_value_double(env, value, &number) != napi_ok) return false;
  out = static_cast<int64_t>(number);
  return true;
}

bool read_f32_file(const std::string& path, std::vector<float>& out) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return false;
  file.seekg(0, std::ios::end);
  const auto size = file.tellg();
  if (size <= 0 || size % static_cast<std::streamoff>(sizeof(float)) != 0) return false;
  file.seekg(0, std::ios::beg);
  out.resize(static_cast<size_t>(size) / sizeof(float));
  file.read(reinterpret_cast<char*>(out.data()), size);
  return static_cast<bool>(file);
}

bool read_f32_array(napi_env env, napi_value value, std::vector<float>& out) {
  bool is_typed_array = false;
  if (napi_is_typedarray(env, value, &is_typed_array) != napi_ok) return false;
  if (is_typed_array) {
    napi_typedarray_type type;
    size_t length = 0;
    void* data = nullptr;
    napi_value array_buffer;
    size_t byte_offset = 0;
    if (napi_get_typedarray_info(env, value, &type, &length, &data, &array_buffer, &byte_offset) != napi_ok) {
      return false;
    }
    if (type != napi_float32_array) return false;
    auto* floats = static_cast<float*>(data);
    out.assign(floats, floats + length);
    return true;
  }

  bool is_array = false;
  if (napi_is_array(env, value, &is_array) != napi_ok || !is_array) return false;
  uint32_t length = 0;
  if (napi_get_array_length(env, value, &length) != napi_ok) return false;
  out.resize(length);
  for (uint32_t i = 0; i < length; ++i) {
    napi_value item;
    double number = 0;
    if (napi_get_element(env, value, i, &item) != napi_ok ||
        napi_get_value_double(env, item, &number) != napi_ok) {
      return false;
    }
    out[i] = static_cast<float>(number);
  }
  return true;
}

napi_value create_model(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) {
    throw_error(env, "createModel expects archPath and weightsPath");
    return nullptr;
  }

  std::string arch_path;
  std::string weights_path;
  if (!get_string(env, args[0], arch_path) || !get_string(env, args[1], weights_path)) {
    throw_error(env, "createModel expects string paths");
    return nullptr;
  }

  char* error = nullptr;
  KTNativeModelHandle handle = kt_native_model_create(arch_path.c_str(), weights_path.c_str(), &error);
  if (!handle) {
    std::string message = error ? error : "Native model creation failed";
    kt_native_string_free(error);
    throw_error(env, message);
    return nullptr;
  }

  const int64_t id = g_next_model_id++;
  g_models[id] = handle;
  napi_value result;
  napi_create_double(env, static_cast<double>(id), &result);
  return result;
}

napi_value destroy_model(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    throw_error(env, "destroyModel expects modelId");
    return nullptr;
  }
  int64_t id = 0;
  if (!get_i64(env, args[0], id)) {
    throw_error(env, "destroyModel expects numeric modelId");
    return nullptr;
  }
  auto it = g_models.find(id);
  if (it != g_models.end()) {
    kt_native_model_destroy(it->second);
    g_models.erase(it);
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value load_voice_style(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1) {
    throw_error(env, "loadVoiceStyle expects voicePath");
    return nullptr;
  }
  std::string voice_path;
  if (!get_string(env, args[0], voice_path)) {
    throw_error(env, "loadVoiceStyle expects a string path");
    return nullptr;
  }
  std::vector<float> style;
  if (!read_f32_file(voice_path, style) || style.size() < 256) {
    throw_error(env, "Invalid native voice style file");
    return nullptr;
  }

  napi_value array_buffer;
  void* data = nullptr;
  napi_create_arraybuffer(env, 256 * sizeof(float), &data, &array_buffer);
  std::memcpy(data, style.data(), 256 * sizeof(float));
  napi_value typed_array;
  napi_create_typedarray(env, napi_float32_array, 256, array_buffer, 0, &typed_array);
  return typed_array;
}

napi_value synthesize(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 3) {
    throw_error(env, "synthesize expects modelId, tokenIds, and style");
    return nullptr;
  }
  int64_t id = 0;
  std::vector<float> tokens;
  std::vector<float> style;
  if (!get_i64(env, args[0], id) ||
      !read_f32_array(env, args[1], tokens) ||
      !read_f32_array(env, args[2], style)) {
    throw_error(env, "Invalid synthesize arguments");
    return nullptr;
  }

  auto it = g_models.find(id);
  if (it == g_models.end()) {
    throw_error(env, "Unknown native model id");
    return nullptr;
  }

  KTNativeFloatArray output{};
  char* error = nullptr;
  const int ok = kt_native_model_synthesize(
    it->second,
    tokens.data(),
    static_cast<int>(tokens.size()),
    style.data(),
    static_cast<int>(style.size()),
    &output,
    &error
  );
  if (!ok || !output.data || output.length <= 0) {
    std::string message = error ? error : "Native synthesis failed";
    kt_native_string_free(error);
    kt_native_float_array_free(&output);
    throw_error(env, message);
    return nullptr;
  }

  napi_value array_buffer;
  void* data = nullptr;
  napi_create_arraybuffer(env, static_cast<size_t>(output.length) * sizeof(float), &data, &array_buffer);
  std::memcpy(data, output.data, static_cast<size_t>(output.length) * sizeof(float));
  napi_value typed_array;
  napi_create_typedarray(env, napi_float32_array, static_cast<size_t>(output.length), array_buffer, 0, &typed_array);
  kt_native_float_array_free(&output);
  return typed_array;
}

napi_value synthesize_profile(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 3) {
    throw_error(env, "synthesizeProfile expects modelId, tokenIds, and style");
    return nullptr;
  }
  int64_t id = 0;
  std::vector<float> tokens;
  std::vector<float> style;
  if (!get_i64(env, args[0], id) ||
      !read_f32_array(env, args[1], tokens) ||
      !read_f32_array(env, args[2], style)) {
    throw_error(env, "Invalid synthesizeProfile arguments");
    return nullptr;
  }

  auto it = g_models.find(id);
  if (it == g_models.end()) {
    throw_error(env, "Unknown native model id");
    return nullptr;
  }

  KTNativeFloatArray output{};
  char* error = nullptr;
  const auto synth_start = std::chrono::steady_clock::now();
  const int ok = kt_native_model_synthesize(
    it->second,
    tokens.data(),
    static_cast<int>(tokens.size()),
    style.data(),
    static_cast<int>(style.size()),
    &output,
    &error
  );
  const auto synth_end = std::chrono::steady_clock::now();
  if (!ok || !output.data || output.length <= 0) {
    std::string message = error ? error : "Native synthesis failed";
    kt_native_string_free(error);
    kt_native_float_array_free(&output);
    throw_error(env, message);
    return nullptr;
  }

  const auto copy_start = std::chrono::steady_clock::now();
  napi_value array_buffer;
  void* data = nullptr;
  napi_create_arraybuffer(env, static_cast<size_t>(output.length) * sizeof(float), &data, &array_buffer);
  std::memcpy(data, output.data, static_cast<size_t>(output.length) * sizeof(float));
  napi_value typed_array;
  napi_create_typedarray(env, napi_float32_array, static_cast<size_t>(output.length), array_buffer, 0, &typed_array);
  kt_native_float_array_free(&output);
  const auto copy_end = std::chrono::steady_clock::now();

  const double synth_ms = std::chrono::duration<double, std::milli>(synth_end - synth_start).count();
  const double copy_ms = std::chrono::duration<double, std::milli>(copy_end - copy_start).count();

  napi_value result;
  napi_create_object(env, &result);

  napi_value audio_key;
  napi_create_string_utf8(env, "audio", NAPI_AUTO_LENGTH, &audio_key);
  napi_set_property(env, result, audio_key, typed_array);

  napi_value synth_key;
  napi_create_string_utf8(env, "synthMs", NAPI_AUTO_LENGTH, &synth_key);
  napi_value synth_value;
  napi_create_double(env, synth_ms, &synth_value);
  napi_set_property(env, result, synth_key, synth_value);

  napi_value copy_key;
  napi_create_string_utf8(env, "copyMs", NAPI_AUTO_LENGTH, &copy_key);
  napi_value copy_value;
  napi_create_double(env, copy_ms, &copy_value);
  napi_set_property(env, result, copy_key, copy_value);

  napi_value samples_key;
  napi_create_string_utf8(env, "samples", NAPI_AUTO_LENGTH, &samples_key);
  napi_value samples_value;
  napi_create_double(env, static_cast<double>(output.length), &samples_value);
  napi_set_property(env, result, samples_key, samples_value);

  return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"createModel", nullptr, create_model, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"destroyModel", nullptr, destroy_model, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"loadVoiceStyle", nullptr, load_voice_style, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"synthesize", nullptr, synthesize, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"synthesizeProfile", nullptr, synthesize_profile, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
