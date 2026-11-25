package me.ebda3.app.shell;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.Logger;
import com.getcapacitor.util.PermissionHelper;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import me.ebda3.app.R;

/**
 * Picking files in the shop's upload buttons. For inputs that take pictures, the phone shows one choice of
 * "take a photo" (camera) or "pick a file/photo"; other inputs (e.g. a spreadsheet) keep Capacitor's picker.
 * Must be created while the screen is being created (it registers for activity results).
 */
public class ShellChromeClient extends BridgeWebChromeClient {

    private final Bridge bridge;
    private final ActivityResultLauncher<Intent> launcher;
    private ValueCallback<Uri[]> pending;
    private File cameraFile;
    private Uri cameraUri;

    public ShellChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.launcher = bridge.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), this::onResult);
    }

    @Override
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
        String[] accept = params.getAcceptTypes();
        if (params.isCaptureEnabled() || !takesPictures(accept)) return super.onShowFileChooser(webView, callback, params);
        if (pending != null) pending.onReceiveValue(null);
        pending = callback;

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        List<String> types = mimeTypes(accept);
        if (types.size() == 1) {
            pick.setType(types.get(0));
        } else {
            pick.setType("*/*");
            if (!types.isEmpty()) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        }
        if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        Intent chooser = Intent.createChooser(pick, bridge.getContext().getString(R.string.choose_photo));
        Intent camera = cameraIntent();
        if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
        try {
            launcher.launch(chooser);
        } catch (Exception e) {
            Logger.error(ShellPlugin.TAG, "No file picker", e);
            finish(null);
        }
        return true;
    }

    /** A camera intent that saves the photo to the app's cache, or null when there is no usable camera app. */
    private Intent cameraIntent() {
        // If some library adds the CAMERA permission, Android requires it to be granted for the camera app too.
        if (
            PermissionHelper.hasDefinedPermission(bridge.getContext(), Manifest.permission.CAMERA) &&
            !PermissionHelper.hasPermissions(bridge.getContext(), new String[] { Manifest.permission.CAMERA })
        ) {
            return null;
        }
        Activity activity = bridge.getActivity();
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        if (intent.resolveActivity(activity.getPackageManager()) == null) return null;
        try {
            // Photos stay a day: the page may read a picked photo again later (e.g. the photo-prints editor).
            File dir = new File(activity.getCacheDir(), "camera");
            ShellPlugin.deleteOlderThan(dir, 24 * 3600 * 1000L);
            if (!dir.exists() && !dir.mkdirs()) return null;
            cameraFile = File.createTempFile("photo-", ".jpg", dir);
            cameraUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", cameraFile);
        } catch (IOException | IllegalArgumentException e) {
            Logger.error(ShellPlugin.TAG, "No camera file", e);
            return null;
        }
        intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("", cameraUri));
        return intent;
    }

    private void onResult(ActivityResult result) {
        Uri[] uris = null;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK) {
            if (data != null && data.getClipData() != null && data.getData() == null && !isCamera(data.getClipData())) {
                ClipData clip = data.getClipData();
                uris = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                uris = new Uri[] { data.getData() };
            } else if (cameraFile != null && cameraFile.length() > 0) {
                uris = new Uri[] { cameraUri };
            }
        }
        finish(uris);
    }

    private boolean isCamera(ClipData clip) {
        return cameraUri != null && clip.getItemCount() == 1 && cameraUri.equals(clip.getItemAt(0).getUri());
    }

    private void finish(Uri[] uris) {
        ValueCallback<Uri[]> cb = pending;
        pending = null;
        if (cb != null) cb.onReceiveValue(uris);
    }

    /** True when the input accepts pictures (an empty accept list means any file). */
    static boolean takesPictures(String[] accept) {
        if (accept == null || accept.length == 0) return true;
        boolean any = true;
        for (String raw : accept) {
            if (raw == null) continue;
            for (String part : raw.split(",")) {
                String t = part.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty()) continue;
                any = false;
                if (t.startsWith("image/") || t.equals(".png") || t.equals(".jpg") || t.equals(".jpeg") || t.equals(".webp") || t.equals(".heic")) {
                    return true;
                }
            }
        }
        return any;
    }

    /** MIME types for the picker from the accept list (".png" → "image/png"). */
    static List<String> mimeTypes(String[] accept) {
        Set<String> out = new LinkedHashSet<>();
        if (accept != null) {
            MimeTypeMap map = MimeTypeMap.getSingleton();
            for (String raw : accept) {
                if (raw == null) continue;
                for (String part : raw.split(",")) {
                    String t = part.trim().toLowerCase(Locale.ROOT);
                    if (t.isEmpty()) continue;
                    if (t.startsWith(".")) {
                        String m = map.getMimeTypeFromExtension(t.substring(1));
                        if (m != null) out.add(m);
                    } else if (t.contains("/")) {
                        out.add(t);
                    }
                }
            }
        }
        return new ArrayList<>(out);
    }
}
