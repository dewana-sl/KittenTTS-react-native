#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <unordered_map>
#include <vector>

#include "kitten_native_engine.h"

@interface KittenTTSNativeEngine : NSObject <RCTBridgeModule>
@end

namespace {

std::mutex g_models_mutex;
std::unordered_map<int64_t, KTNativeModelHandle> g_models;
int64_t g_next_model_id = 1;

std::vector<float> numbers_to_floats(NSArray* values)
{
  std::vector<float> out;
  out.reserve(values.count);
  for (NSNumber* number in values) {
    out.push_back(number.floatValue);
  }
  return out;
}

NSArray<NSNumber*>* floats_to_numbers(const float* data, size_t count)
{
  NSMutableArray<NSNumber*>* out = [NSMutableArray arrayWithCapacity:count];
  for (size_t i = 0; i < count; ++i) {
    [out addObject:@(data[i])];
  }
  return out;
}

NSString* consume_error(char* error, NSString* fallback)
{
  if (!error) return fallback;
  NSString* message = [NSString stringWithUTF8String:error] ?: fallback;
  kt_native_string_free(error);
  return message;
}

} // namespace

@implementation KittenTTSNativeEngine

RCT_EXPORT_MODULE(KittenTTSNativeEngine)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("com.kittentts.native-engine", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

RCT_REMAP_METHOD(createModel,
                 createModelWithArchPath:(NSString*)archPath
                 weightsPath:(NSString*)weightsPath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  char* error = nullptr;
  KTNativeModelHandle handle = kt_native_model_create(archPath.UTF8String, weightsPath.UTF8String, &error);
  if (!handle) {
    reject(@"kitten_native_create_failed", consume_error(error, @"Native model creation failed"), nil);
    return;
  }

  int64_t modelId = 0;
  {
    std::lock_guard<std::mutex> lock(g_models_mutex);
    modelId = g_next_model_id++;
    g_models[modelId] = handle;
  }
  resolve(@(modelId));
}

RCT_REMAP_METHOD(destroyModel,
                 destroyModelWithId:(nonnull NSNumber*)modelId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  KTNativeModelHandle handle = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_models_mutex);
    auto it = g_models.find(modelId.longLongValue);
    if (it != g_models.end()) {
      handle = it->second;
      g_models.erase(it);
    }
  }
  if (handle) kt_native_model_destroy(handle);
  resolve(nil);
}

RCT_REMAP_METHOD(loadVoiceStyle,
                 loadVoiceStyleAtPath:(NSString*)voicePath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSData* data = [NSData dataWithContentsOfFile:voicePath];
  if (!data || data.length < 256 * sizeof(float)) {
    reject(@"kitten_native_invalid_voice", [NSString stringWithFormat:@"Invalid native voice style file: %@", voicePath], nil);
    return;
  }

  const float* floats = static_cast<const float*>(data.bytes);
  resolve(floats_to_numbers(floats, 256));
}

RCT_REMAP_METHOD(synthesize,
                 synthesizeWithModelId:(nonnull NSNumber*)modelId
                 tokenIds:(NSArray*)tokenIds
                 style:(NSArray*)style
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  KTNativeModelHandle handle = nullptr;
  {
    std::lock_guard<std::mutex> lock(g_models_mutex);
    auto it = g_models.find(modelId.longLongValue);
    if (it != g_models.end()) handle = it->second;
  }

  if (!handle) {
    reject(@"kitten_native_unknown_model", @"Unknown native model id", nil);
    return;
  }

  std::vector<float> tokenVector = numbers_to_floats(tokenIds);
  std::vector<float> styleVector = numbers_to_floats(style);

  KTNativeFloatArray output{};
  char* error = nullptr;
  const int ok = kt_native_model_synthesize(
    handle,
    tokenVector.data(),
    static_cast<int>(tokenVector.size()),
    styleVector.data(),
    static_cast<int>(styleVector.size()),
    &output,
    &error
  );

  if (!ok || !output.data || output.length <= 0) {
    NSString* message = consume_error(error, @"Native synthesis failed");
    kt_native_float_array_free(&output);
    reject(@"kitten_native_synthesize_failed", message, nil);
    return;
  }

  NSArray<NSNumber*>* samples = floats_to_numbers(output.data, static_cast<size_t>(output.length));
  kt_native_float_array_free(&output);
  resolve(samples);
}

@end
