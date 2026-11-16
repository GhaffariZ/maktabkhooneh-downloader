cmake_minimum_required(VERSION 3.22.1)
project(studylibrary LANGUAGES CXX)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION "${MK_RUNTIME_DIR}/lib/${ANDROID_ABI}/libnode.so")

add_library(studylibrary SHARED node_bridge.cpp)
target_include_directories(studylibrary PRIVATE "${MK_RUNTIME_DIR}/include/node")
target_compile_features(studylibrary PRIVATE cxx_std_20)
target_link_libraries(studylibrary PRIVATE node)
