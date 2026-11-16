#include <jni.h>
#include <node.h>
#include <cstdlib>
#include <string>
#include <vector>

extern "C" JNIEXPORT jint JNICALL
Java_io_github_ghaffariz_maktabkhooneh_MainActivity_startNode(JNIEnv* env, jclass, jobjectArray array) {
    const jsize count = env->GetArrayLength(array);
    if (count < 5) return 1;
    std::vector<std::string> arguments;
    arguments.reserve(count);
    for (jsize index = 0; index < count; ++index) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(array, index));
        const char* utf8 = env->GetStringUTFChars(value, nullptr);
        if (utf8 == nullptr) return 1;
        arguments.emplace_back(utf8);
        env->ReleaseStringUTFChars(value, utf8);
        env->DeleteLocalRef(value);
    }

    setenv("HOME", arguments[2].c_str(), 1);
    setenv("TMPDIR", arguments[2].c_str(), 1);
    unsetenv("NODE_OPTIONS");
    std::vector<char*> argv;
    for (auto& argument : arguments) argv.push_back(argument.data());
    argv.push_back(nullptr);
    return node::Start(count, argv.data());
}
