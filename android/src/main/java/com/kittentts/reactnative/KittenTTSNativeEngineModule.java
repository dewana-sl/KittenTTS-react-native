package com.kittentts.reactnative;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableNativeArray;

public final class KittenTTSNativeEngineModule extends ReactContextBaseJavaModule {
  static {
    System.loadLibrary("kittenttsnative");
  }

  public KittenTTSNativeEngineModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @Override
  public String getName() {
    return "KittenTTSNativeEngine";
  }

  @ReactMethod
  public void createModel(String archPath, String weightsPath, Promise promise) {
    try {
      promise.resolve((double) nativeCreateModel(archPath, weightsPath));
    } catch (Exception error) {
      promise.reject("KITTENTTS_NATIVE_CREATE_FAILED", error);
    }
  }

  @ReactMethod
  public void destroyModel(double modelId, Promise promise) {
    nativeDestroyModel((long) modelId);
    promise.resolve(null);
  }

  @ReactMethod
  public void loadVoiceStyle(String voicePath, Promise promise) {
    try {
      promise.resolve(toWritableArray(nativeLoadVoiceStyle(voicePath)));
    } catch (Exception error) {
      promise.reject("KITTENTTS_NATIVE_VOICE_FAILED", error);
    }
  }

  @ReactMethod
  public void synthesize(double modelId, ReadableArray tokenIds, ReadableArray style, Promise promise) {
    try {
      promise.resolve(toWritableArray(nativeSynthesize((long) modelId, toFloatArray(tokenIds), toFloatArray(style))));
    } catch (Exception error) {
      promise.reject("KITTENTTS_NATIVE_SYNTH_FAILED", error);
    }
  }

  private static float[] toFloatArray(ReadableArray array) {
    float[] values = new float[array.size()];
    for (int i = 0; i < array.size(); i += 1) {
      values[i] = (float) array.getDouble(i);
    }
    return values;
  }

  private static WritableArray toWritableArray(float[] values) {
    WritableArray array = new WritableNativeArray();
    for (float value : values) {
      array.pushDouble(value);
    }
    return array;
  }

  private static native long nativeCreateModel(String archPath, String weightsPath);
  private static native void nativeDestroyModel(long modelId);
  private static native float[] nativeLoadVoiceStyle(String voicePath);
  private static native float[] nativeSynthesize(long modelId, float[] tokenIds, float[] style);
}
