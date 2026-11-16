package io.github.ghaffariz.maktabkhooneh;

import android.app.Activity;
import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "http://127.0.0.1:3210/";
    private static CompletableFuture<String> boot;
    private FrameLayout root;
    private WebView dashboard;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private static native int startNode(String[] arguments);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        }
        setContentView(root);
        TextView status = new TextView(this);
        status.setText("در حال باز کردن کتابخانه…");
        status.setGravity(Gravity.CENTER);
        root.addView(status, new FrameLayout.LayoutParams(-1, -1));
        boolean demo = BuildConfig.DEBUG && getIntent().getBooleanExtra("demo", false);
        startServer(getApplicationContext(), demo).whenComplete((token, error) -> runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            if (error != null) {
                status.setText("سرور محلی آماده نشد. برنامه را ببندید و دوباره باز کنید.");
                return;
            }
            root.removeView(status);
            openDashboard(token);
        }));
    }

    private void openDashboard(String token) {
        dashboard = new WebView(this);
        WebSettings settings = dashboard.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(dashboard, false);
        dashboard.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                return !"http".equals(url.getScheme()) || !"127.0.0.1".equals(url.getHost()) || url.getPort() != 3210;
            }
        });
        dashboard.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view;
                fullscreenCallback = callback;
                dashboard.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
            }

            @Override
            public void onHideCustomView() { leaveFullscreen(); }
        });
        root.addView(dashboard, new FrameLayout.LayoutParams(-1, -1));
        dashboard.loadUrl(ORIGIN + "__mobile/start", Collections.singletonMap("X-MK-Mobile-Token", token));
    }

    private void leaveFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        dashboard.setVisibility(View.VISIBLE);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        callback.onCustomViewHidden();
    }

    @Override
    public void onBackPressed() {
        if (fullscreen != null) leaveFullscreen();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        leaveFullscreen();
        if (dashboard != null) {
            root.removeView(dashboard);
            dashboard.destroy();
        }
        super.onDestroy();
    }

    private static synchronized CompletableFuture<String> startServer(Context context, boolean demo) {
        if (boot != null) return boot;
        CompletableFuture<String> result = new CompletableFuture<>();
        boot = result;
        new Thread(() -> {
            File ready = null;
            try {
                System.loadLibrary("studylibrary");
                File bundle = new File(context.getFilesDir(), "bundle-" + BuildConfig.VERSION_CODE);
                copyAssets(context.getAssets(), "app", bundle);
                File profile = new File(context.getFilesDir(), "library-data");
                if (!profile.isDirectory() && !profile.mkdirs()) throw new IOException("Profile unavailable");
                ready = File.createTempFile("startup-", ".ready", context.getCacheDir());
                byte[] bytes = new byte[32];
                new SecureRandom().nextBytes(bytes);
                StringBuilder hex = new StringBuilder(64);
                for (byte value : bytes) hex.append(Character.forDigit((value >>> 4) & 15, 16)).append(Character.forDigit(value & 15, 16));
                String token = hex.toString();
                String[] args = { "node", new File(bundle, "mobile.mjs").getAbsolutePath(),
                    profile.getAbsolutePath(), ready.getAbsolutePath(), token };
                String[] launchArgs = demo ? java.util.Arrays.copyOf(args, args.length + 1) : args;
                if (demo) launchArgs[args.length] = "--demo";
                new Thread(() -> {
                    try {
                        startNode(launchArgs);
                        result.completeExceptionally(new IOException("Local server stopped"));
                    } catch (LinkageError error) {
                        result.completeExceptionally(error);
                    }
                }, "study-library-node").start();
                for (int attempt = 0; attempt < 150 && !result.isDone(); attempt++) {
                    String address = new String(Files.readAllBytes(ready.toPath()), StandardCharsets.US_ASCII);
                    if (ORIGIN.equals(address)) { result.complete(token); return; }
                    SystemClock.sleep(200);
                }
                result.completeExceptionally(new IOException("Local server startup timed out"));
            } catch (IOException | LinkageError error) {
                result.completeExceptionally(error);
            } finally {
                if (ready != null) ready.delete();
            }
        }, "study-library-bootstrap").start();
        return result;
    }

    private static void copyAssets(AssetManager assets, String source, File output) throws IOException {
        String[] entries = assets.list(source);
        if (entries != null && entries.length > 0) {
            if (!output.isDirectory() && !output.mkdirs()) throw new IOException("Asset folder unavailable");
            for (String entry : entries) copyAssets(assets, source + "/" + entry, new File(output, entry));
        } else {
            try (InputStream input = assets.open(source); FileOutputStream file = new FileOutputStream(output)) {
                byte[] buffer = new byte[16384];
                for (int count; (count = input.read(buffer)) != -1; ) file.write(buffer, 0, count);
            }
        }
    }
}
