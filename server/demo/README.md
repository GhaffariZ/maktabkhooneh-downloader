# Demo Fixtures & Synthetic Media

This directory contains clearly-labeled mock data and synthetic media fixtures for browser QA and offline UI verification without requiring Maktabkhooneh account credentials or contacting platform servers.

## `sample.mp4`
- **Origin**: 100% synthetic test pattern generated with FFmpeg `testsrc` filter (`-f lavfi -i testsrc=duration=2:size=320x240:rate=10 -c:v libx264 -pix_fmt yuv420p -b:v 40k -movflags +faststart`).
- **Duration**: 2.0 seconds.
- **Resolution**: 320x240, 10 fps.
- **Codec**: H.264 (yuv420p, moov atom at beginning of file via faststart).
- **Size**: 6,754 bytes (<50 KB).
- **Purpose**: Offline media serving and HTTP range request (206 Partial Content) verification for demo mode. Contains zero copyrighted or platform assets.
