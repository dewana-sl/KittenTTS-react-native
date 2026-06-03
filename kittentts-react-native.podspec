require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'kittentts-react-native'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.author       = package['author']
  s.source       = { :git => package.dig('repository', 'url'), :tag => "#{s.version}" }

  s.platforms    = { :ios => '15.1' }
  s.source_files = [
    'ios/**/*.{h,m,mm}',
    'native/cpp-engine/include/**/*.h',
    'native/cpp-engine/src/**/*.{h,hpp,cpp}'
  ]
  s.public_header_files = 'native/cpp-engine/include/**/*.h'

  s.dependency 'React-Core'

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'GCC_ENABLE_CPP_EXCEPTIONS' => 'YES',
    'GCC_ENABLE_CPP_RTTI' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/native/cpp-engine/include" "$(PODS_TARGET_SRCROOT)/native/cpp-engine/src"',
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -O3 -ffast-math -fno-finite-math-only -funroll-loops -ftree-vectorize'
  }
end
