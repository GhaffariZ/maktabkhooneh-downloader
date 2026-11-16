# Local phone app previews

The Android and iPhone shells use the same Persian dashboard as desktop. Each shell starts its own embedded Node runtime on `127.0.0.1`, opens a private WebView session, and keeps downloads in the app's private directory. Sign-in and online playback connect to Maktabkhooneh from the phone. Saved lessons use the local player and the same file-backed seek support as desktop.

## Build previews

The **Mobile previews** GitHub Actions workflow stages the reproducible binaries and creates an Android debug APK and an Apple Silicon iPhone simulator app. The simulator app is for build verification. Distributing an app to iPhones requires a signed device build and an Apple distribution path such as TestFlight.

Use `npm ci` then `npm run build` to build the shared UI and server. The runtime archive URLs and SHA-256 values are in [`mobile/runtime.json`](../mobile/runtime.json). Download that platform's archive and the Node license, then run the matching commands below.

```sh
node scripts/prepare-mobile.mjs android /path/to/runtime.zip /path/to/Node-LICENSE.txt
gradle -p mobile/android :app:assembleDebug
```

Android builds use Java 17, Gradle 8.13, SDK 36, NDK 28.2.13676358, and CMake 3.22.1. The APK is under `mobile/android/app/build/outputs/apk/debug/`.

```sh
node scripts/prepare-mobile.mjs ios /path/to/runtime.zip /path/to/Node-LICENSE.txt
cd mobile/ios
xcodegen generate
xcodebuild -project StudyLibrary.xcodeproj -scheme StudyLibrary -sdk iphonesimulator -arch arm64 -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

The embedded runtime is a digest-pinned prerelease of [Node.js for Mobile Apps](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0). Keep the dashboard open while downloading in previews. Verify sign-in, playback, a downloaded lesson in airplane mode, and resuming after relaunch on a real phone before distributing a release.
