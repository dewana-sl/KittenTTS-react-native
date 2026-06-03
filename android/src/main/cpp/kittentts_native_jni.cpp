#include <jni.h>

#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "kitten_native_engine.h"

namespace {

std::unordered_map<jlong, KTNativeModelHandle> g_models;
jlong g_next_model_id = 1;

std::string jstring_to_string(JNIEnv* env, jstring value) {
  const char* chars = env->GetStringUTFChars(value, nullptr);
  std::string out(chars ? chars : "");
  if (chars) env->ReleaseStringUTFChars(value, chars);
  return out;
}

void throw_runtime(JNIEnv* env, const std::string& message) {
  jclass cls = env->FindClass("java/lang/RuntimeException");
  env->ThrowNew(cls, message.c_str());
}

std::vector<float> jfloat_array_to_vector(JNIEnv* env, jfloatArray array) {
  const jsize length = env->GetArrayLength(array);
  std::vector<float> values(static_cast<size_t>(length));
  env->GetFloatArrayRegion(array, 0, length, values.data());
  return values;
}

jfloatArray vector_to_jfloat_array(JNIEnv* env, const std::vector<float>& values) {
  jfloatArray array = env->NewFloatArray(static_cast<jsize>(values.size()));
  env->SetFloatArrayRegion(array, 0, static_cast<jsize>(values.size()), values.data());
  return array;
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

} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_kittentts_reactnative_KittenTTSNativeEngineModule_nativeCreateModel(
    JNIEnv* env,
    jclass,
    jstring arch_path,
    jstring weights_path) {
  const std::string arch = jstring_to_string(env, arch_path);
  const std::string weights = jstring_to_string(env, weights_path);
  char* error = nullptr;
  KTNativeModelHandle handle = kt_native_model_create(arch.c_str(), weights.c_str(), &error);
  if (!handle) {
    std::string message = error ? error : "Native model creation failed";
    kt_native_string_free(error);
    throw_runtime(env, message);
    return 0;
  }

  const jlong id = g_next_model_id++;
  g_models[id] = handle;
  return id;
}

extern "C" JNIEXPORT void JNICALL
Java_com_kittentts_reactnative_KittenTTSNativeEngineModule_nativeDestroyModel(
    JNIEnv*,
    jclass,
    jlong model_id) {
  auto it = g_models.find(model_id);
  if (it != g_models.end()) {
    kt_native_model_destroy(it->second);
    g_models.erase(it);
  }
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_kittentts_reactnative_KittenTTSNativeEngineModule_nativeLoadVoiceStyle(
    JNIEnv* env,
    jclass,
    jstring voice_path) {
  const std::string path = jstring_to_string(env, voice_path);
  std::vector<float> style;
  if (!read_f32_file(path, style) || style.size() < 256) {
    throw_runtime(env, "Invalid native voice style file");
    return nullptr;
  }
  style.resize(256);
  return vector_to_jfloat_array(env, style);
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_kittentts_reactnative_KittenTTSNativeEngineModule_nativeSynthesize(
    JNIEnv* env,
    jclass,
    jlong model_id,
    jfloatArray token_ids,
    jfloatArray style) {
  auto it = g_models.find(model_id);
  if (it == g_models.end()) {
    throw_runtime(env, "Unknown native model id");
    return nullptr;
  }

  std::vector<float> tokens = jfloat_array_to_vector(env, token_ids);
  std::vector<float> style_values = jfloat_array_to_vector(env, style);
  KTNativeFloatArray output{};
  char* error = nullptr;
  const int ok = kt_native_model_synthesize(
      it->second,
      tokens.data(),
      static_cast<int>(tokens.size()),
      style_values.data(),
      static_cast<int>(style_values.size()),
      &output,
      &error);
  if (!ok || !output.data || output.length <= 0) {
    std::string message = error ? error : "Native synthesis failed";
    kt_native_string_free(error);
    kt_native_float_array_free(&output);
    throw_runtime(env, message);
    return nullptr;
  }

  std::vector<float> samples(output.data, output.data + output.length);
  kt_native_float_array_free(&output);
  return vector_to_jfloat_array(env, samples);
}
