package com.hanazar.langames;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private TextView statusView;
    private TextView addressView;
    private ImageView qrView;
    private LinearLayout gamesList;
    private Button openButton;
    private Button copyButton;

    private static final int REQUEST_NOTIFY = 1001;

    private String lanAddress;      // 优选局域网地址
    private List<LanGame> games = new ArrayList<>();
    private LanGame selected;       // 当前选中的游戏

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusView = findViewById(R.id.tvStatus);
        addressView = findViewById(R.id.tvAddress);
        qrView = findViewById(R.id.ivQr);
        gamesList = findViewById(R.id.llGames);
        openButton = findViewById(R.id.btnOpen);
        copyButton = findViewById(R.id.btnCopy);

        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFY);
            }
        }

        // 启动前台服务，服务内复制 assets 并拉起 host.js（全部游戏 + /api/catalog）
        Intent service = new Intent(this, NodeService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(service);
        } else {
            startService(service);
        }

        openButton.setOnClickListener(v -> {
            if (selected == null) { Toast.makeText(this, "请先选择一款游戏", Toast.LENGTH_SHORT).show(); return; }
            Intent i = new Intent(this, GameActivity.class);
            i.putExtra("url", selected.buildUrl(lanAddress));
            startActivity(i);
        });

        copyButton.setOnClickListener(v -> {
            String text = addressView.getText().toString();
            if (text.isEmpty() || text.contains("…")) { Toast.makeText(this, "请先选择游戏并等待服务器就绪", Toast.LENGTH_SHORT).show(); return; }
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("game-url", text));
            Toast.makeText(this, "地址已复制：" + text, Toast.LENGTH_SHORT).show();
        });

        pollCatalog();
    }

    /** 轮询 host.js 的 /api/catalog，直到拿到可用游戏列表与局域网地址 */
    private void pollCatalog() {
        new Thread(() -> {
            for (int attempt = 0; attempt < 90; attempt++) {
                try {
                    URL url = new URL("http://127.0.0.1:" + NodeService.CATALOG_PORT + "/api/catalog");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(1000);
                    conn.setReadTimeout(1000);
                    if (conn.getResponseCode() == 200) {
                        JSONObject obj = new JSONObject(readAll(conn));
                        JSONArray addressArray = obj.getJSONArray("addresses");
                        JSONArray gamesArray = obj.getJSONArray("games");
                        List<String> addrs = new ArrayList<>();
                        for (int i = 0; i < addressArray.length(); i++) addrs.add(addressArray.optString(i));
                        String ip = pickLanAddress(addrs);

                        List<LanGame> list = new ArrayList<>();
                        for (int i = 0; i < gamesArray.length(); i++) {
                            JSONObject g = gamesArray.getJSONObject(i);
                            list.add(new LanGame(g.getString("id"), g.getString("name"), g.getInt("port")));
                        }
                        runOnUiThread(() -> onCatalogReady(ip, list));
                        return;
                    }
                    conn.disconnect();
                } catch (Exception ignored) { }
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
            }
            runOnUiThread(() -> statusView.setText("服务器启动失败，请查看日志"));
        }).start();
    }

    private String readAll(HttpURLConnection conn) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = in.readLine()) != null) sb.append(line);
        in.close();
        conn.disconnect();
        return sb.toString();
    }

    private String pickLanAddress(List<String> addresses) {
        String fallback = null;
        for (String ip : addresses) {
            if (ip == null) continue;
            if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..*")) return ip;
            if (fallback == null) fallback = ip;
        }
        return fallback != null ? fallback : "127.0.0.1";
    }

    private void onCatalogReady(String ip, List<LanGame> list) {
        lanAddress = ip;
        games = list;
        statusView.setText("● 服务器运行中 · 共 " + games.size() + " 款游戏");
        buildGameButtons();
        if (!games.isEmpty()) selectGame(games.get(0));
        NodeService.updateNotification(this, "服务器运行中 · " + games.size() + " 款游戏");
    }

    private void buildGameButtons() {
        gamesList.removeAllViews();
        for (LanGame game : games) {
            Button b = new Button(this);
            b.setText(game.name);
            b.setTextSize(16);
            b.setAllCaps(false);
            b.setGravity(Gravity.CENTER);
            b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xFF1B5E20));
            b.setOnClickListener(v -> {
                selectGame(game);
                Toast.makeText(this, "已选择：" + game.name, Toast.LENGTH_SHORT).show();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 0, 12);
            b.setLayoutParams(lp);
            gamesList.addView(b);
        }
    }

    private void selectGame(LanGame game) {
        selected = game;
        String url = game.buildUrl(lanAddress);
        statusView.setText("● 已选择：" + game.name + " · 服务器运行中");
        addressView.setText(url);
        Bitmap qr = generateQr(url, 440);
        if (qr != null) qrView.setImageBitmap(qr);
        for (int i = 0; i < gamesList.getChildCount(); i++) {
            Button b = (Button) gamesList.getChildAt(i);
            b.setAlpha(i < games.indexOf(game) ? 0.6f : (games.indexOf(game) == i ? 1.0f : 0.6f));
        }
    }

    private Bitmap generateQr(String text, int size) {
        try {
            BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size);
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565);
            for (int x = 0; x < size; x++) {
                for (int y = 0; y < size; y++) {
                    bmp.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
                }
            }
            return bmp;
        } catch (WriterException e) {
            e.printStackTrace();
            return null;
        }
    }
}
