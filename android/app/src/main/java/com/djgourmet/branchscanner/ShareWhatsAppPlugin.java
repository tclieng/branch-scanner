package com.djgourmet.branchscanner;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;

@CapacitorPlugin(name = "ShareWhatsApp")
public class ShareWhatsAppPlugin extends Plugin {

    @PluginMethod
    public void shareXlsx(PluginCall call) {
        try {
            String base64 = call.getString("base64");
            String fileName = call.getString("fileName", "BranchScanner.xlsx");
            String number = call.getString("number"); // e.g. "60168027076"

            byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            File file = new File(getContext().getCacheDir(), fileName);
            FileOutputStream fos = new FileOutputStream(file);
            fos.write(bytes);
            fos.close();

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );

            // Prefer WhatsApp; fall back to any app if not installed
            String waPackage = "com.whatsapp";
            boolean hasWhatsApp = true;
            try {
                getContext().getPackageManager().getPackageInfo(waPackage, 0);
            } catch (Exception e) {
                hasWhatsApp = false;
            }

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (number != null && !number.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, "Branch Scanner export: " + fileName);
            }
            if (hasWhatsApp) {
                intent.setPackage(waPackage);
            }

            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("WhatsApp share failed: " + e.getMessage());
        }
    }
}
