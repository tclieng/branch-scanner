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

@CapacitorPlugin(name = "ShareGmail")
public class ShareGmailPlugin extends Plugin {

    @PluginMethod
    public void shareXlsx(PluginCall call) {
        try {
            String base64 = call.getString("base64");
            String fileName = call.getString("fileName", "BranchScanner.xlsx");
            String email = call.getString("email");
            String subject = call.getString("subject", "Branch Scanner Report");
            String body = call.getString("body", "");

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

            // Prefer Gmail; fall back to any email app if not installed
            String gmailPackage = "com.google.android.gm";
            boolean hasGmail = true;
            try {
                getContext().getPackageManager().getPackageInfo(gmailPackage, 0);
            } catch (Exception e) {
                hasGmail = false;
            }

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (email != null && !email.isEmpty()) {
                intent.putExtra(Intent.EXTRA_EMAIL, new String[]{ email });
            }
            if (subject != null && !subject.isEmpty()) {
                intent.putExtra(Intent.EXTRA_SUBJECT, subject);
            }
            if (body != null && !body.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, body);
            }
            if (hasGmail) {
                intent.setPackage(gmailPackage);
            }

            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Gmail share failed: " + e.getMessage());
        }
    }
}
