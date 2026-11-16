#!/bin/sh
set -eu

apk=$1
package=io.github.ghaffariz.maktabkhooneh
adb install "$apk"
adb shell am start -W -n "$package/.MainActivity" --ez demo true

port=$(adb forward tcp:0 tcp:3210)
trap 'adb forward --remove "tcp:$port"' EXIT
for delay in 1 2 3 4 5 6 7 8 9 10; do
    code=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' -H 'Host: 127.0.0.1:3210' \
        "http://127.0.0.1:$port/api/courses" || true)
    if [ "$code" = 403 ]; then break; fi
    sleep 2
done
test "$code" = 403

for attempt in 1 2 3 4 5; do
    if adb shell uiautomator dump /sdcard/study-preview.xml >/dev/null 2>&1 &&
        adb shell cat /sdcard/study-preview.xml | grep -q 'پایتون'; then
        printf 'The Android app booted its local server and rendered the demo library.\n'
        exit 0
    fi
    sleep 2
done
printf 'The demo library was not visible in the Android WebView.\n' >&2
exit 1
