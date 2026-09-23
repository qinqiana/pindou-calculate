package com.pindou.ledger;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** A fixed set of local operations, never arbitrary SQL, filesystem paths or Java calls. */
public final class AndroidBridge {
    private static final int PICK_DOCUMENT = 1;
    private static final int MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    private final Activity activity;
    private final WebView web;
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private SQLiteDatabase database;
    private String pendingId;
    private String pendingKind;

    AndroidBridge(Activity activity, WebView web) { this.activity = activity; this.web = web; }

    @JavascriptInterface public synchronized String call(String action, String payload) {
        try {
            JSONObject args = new JSONObject(payload);
            Object value;
            switch (action) {
                case "readLedger": value = readLedger(); break;
                case "writeLedger": writeLedger(args.getString("text")); value = true; break;
                case "thumbnail": value = thumbnail(args); break;
                case "writeText": value = publish(args.getString("filename"), args.getString("text").getBytes(StandardCharsets.UTF_8), false); break;
                case "saveImage": value = publish(args.getString("filename"), decodeImageBytes(args.getString("base64")), true); break;
                default: throw new IllegalArgumentException("不支持的手机操作");
            }
            return success(value).toString();
        } catch (Exception error) {
            return failure(error.getMessage()).toString();
        }
    }

    private SQLiteDatabase database() {
        if (database == null) {
            // A corrupt database must fail closed: never invoke the default handler that deletes it.
            database = activity.openOrCreateDatabase("ledger.db", Activity.MODE_PRIVATE, null,
                db -> { throw new android.database.sqlite.SQLiteException("账本损坏，原文件已保留"); });
            database.execSQL("CREATE TABLE IF NOT EXISTS pindou_ledger (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL)");
        }
        return database;
    }

    private Object readLedger() {
        SQLiteDatabase db = database();
        int length;
        try (Cursor cursor = db.rawQuery("SELECT length(payload) FROM pindou_ledger WHERE id=1", null)) {
            if (!cursor.moveToFirst()) return JSONObject.NULL;
            length = cursor.getInt(0);
        }
        // Thumbnails can make the ledger larger than Android's CursorWindow. Read bounded pieces.
        StringBuilder text = new StringBuilder();
        for (int offset = 1; offset <= length; offset += 256 * 1024) {
            try (Cursor cursor = db.rawQuery("SELECT substr(payload, ?, 262144) FROM pindou_ledger WHERE id=1", new String[]{Integer.toString(offset)})) {
                if (!cursor.moveToFirst()) throw new IllegalStateException("读取账本未完成");
                text.append(cursor.getString(0));
            }
        }
        return text.toString();
    }

    private void writeLedger(String text) throws Exception {
        new JSONObject(text); // Full domain validation remains in the shared ledger module.
        SQLiteDatabase db = database();
        db.beginTransaction();
        try {
            db.execSQL("INSERT OR REPLACE INTO pindou_ledger (id, payload) VALUES (1, ?)", new Object[]{text});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private byte[] decodeImageBytes(String encoded) {
        if (encoded.length() > (MAX_IMAGE_BYTES + 2) / 3 * 4) throw new IllegalArgumentException("图片超过 20 MiB 上限");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length > MAX_IMAGE_BYTES) throw new IllegalArgumentException("图片超过 20 MiB 上限");
        return bytes;
    }

    private String thumbnail(JSONObject args) throws Exception {
        byte[] bytes = decodeImageBytes(args.getString("base64"));
        int expectedWidth = args.getInt("width"), expectedHeight = args.getInt("height");
        Bitmap bitmap = null, small = null, white = null;
        try {
            bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes)), (decoder, info, source) -> {
                int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                if (width != expectedWidth || height != expectedHeight || width < 1 || height < 1 || (long) width * height > 32000000) {
                    throw new IllegalArgumentException("图片解码尺寸与文件不符或超过 3200 万像素");
                }
                if (info.isAnimated()) throw new IllegalArgumentException("请选择静态图纸");
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                // Decode the complete original. No partial-image listener accepts damaged input.
            });
            float ratio = Math.min(1f, 256f / Math.max(bitmap.getWidth(), bitmap.getHeight()));
            small = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)), Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
            white = Bitmap.createBitmap(small.getWidth(), small.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(white);
            canvas.drawColor(0xffffffff);
            canvas.drawBitmap(small, 0, 0, null);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!white.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new IllegalStateException("缩略图转换失败");
            return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } finally {
            if (white != null) white.recycle();
            if (small != null && small != bitmap) small.recycle();
            if (bitmap != null) bitmap.recycle();
        }
    }

    @JavascriptInterface public void pick(String id, String kind) {
        activity.runOnUiThread(() -> {
            if (pendingId != null || !("image".equals(kind) || "text".equals(kind))) {
                send(id, failure("已有文件选择尚未完成"));
                return;
            }
            pendingId = id;
            pendingKind = kind;
            try {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("image".equals(kind) ? "image/*" : "*/*");
                intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
                activity.startActivityForResult(intent, PICK_DOCUMENT);
            } catch (Exception error) {
                pendingId = null;
                pendingKind = null;
                send(id, failure("无法打开系统文件选择器"));
            }
        });
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_DOCUMENT || pendingId == null) return;
        final String id = pendingId, kind = pendingKind;
        pendingId = null;
        pendingKind = null;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSONObject result = failure("已取消选择，已有输入保留");
            try { result.put("cancelled", true); } catch (Exception ignored) { }
            send(id, result);
            return;
        }
        final Uri uri = data.getData();
        reader.execute(() -> {
            try (InputStream input = activity.getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new IllegalStateException("无法打开所选文件");
                byte[] buffer = new byte[65536];
                int count;
                // Backups include thumbnails and can be larger than a single source image.
                int limit = "image".equals(kind) ? MAX_IMAGE_BYTES : 128 * 1024 * 1024;
                while ((count = input.read(buffer)) != -1) {
                    if ((long) output.size() + count > limit) throw new IllegalArgumentException("image".equals(kind) ? "图片超过 20 MiB 上限" : "备份超过 128 MiB 上限");
                    output.write(buffer, 0, count);
                }
                JSONObject value = new JSONObject();
                if ("image".equals(kind)) {
                    value.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    value.put("mime", activity.getContentResolver().getType(uri));
                } else value.put("text", output.toString(StandardCharsets.UTF_8.name()));
                send(id, success(value));
            } catch (Exception error) { send(id, failure("读取文件失败：" + error.getMessage())); }
        });
    }

    private JSONObject publish(String filename, byte[] bytes, boolean image) throws Exception {
        if (!filename.matches("[A-Za-z0-9._-]{1,160}") || filename.contains("..")) throw new IllegalArgumentException("文件名无效");
        if (image && (bytes.length < 8 || bytes[0] != (byte) 137 || bytes[1] != 80 || bytes[2] != 78 || bytes[3] != 71)) {
            throw new IllegalArgumentException("分享图片必须为 PNG");
        }
        String directory = (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/豆计";
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, image ? "image/png" : filename.endsWith(".csv") ? "text/csv" : "application/json");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, directory);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = activity.getContentResolver().insert(image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("无法创建输出文件");
        try {
            try (OutputStream output = activity.getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("无法写入输出文件");
                output.write(bytes);
                output.flush();
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (activity.getContentResolver().update(uri, values, null, null) != 1) throw new IllegalStateException("文件保存未确认");
            // The system may disambiguate duplicate names; report the actual saved name.
            try (Cursor cursor = activity.getContentResolver().query(uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) filename = cursor.getString(0);
            }
            return new JSONObject().put("path", directory + "/" + filename);
        } catch (Exception error) {
            activity.getContentResolver().delete(uri, null, null);
            throw error;
        }
    }

    private static JSONObject success(Object value) {
        try { return new JSONObject().put("ok", true).put("value", value); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    private static JSONObject failure(String message) {
        try { return new JSONObject().put("ok", false).put("message", message == null ? "手机操作失败" : message); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    private void send(String id, JSONObject result) {
        activity.runOnUiThread(() -> {
            if (!activity.isDestroyed()) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('pindou-document',{detail:{id:"
                + JSONObject.quote(id) + ",result:" + result + "}}))", null);
        });
    }

    synchronized void close() {
        reader.shutdownNow();
        if (database != null) database.close();
    }
}
