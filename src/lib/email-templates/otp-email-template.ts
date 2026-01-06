export type OtpEmailTemplateOptions = {
  heading?: string;
  message?: string;
  tagline?: string;
};

export const renderOtpEmailHtml = (
  safeCode: string,
  options: OtpEmailTemplateOptions = {}
) => {
  const heading = options.heading ?? "Verify your email";
  const message =
    options.message ??
    "Use the code below to finish signing in. This code expires in 10 minutes.";
  const tagline = options.tagline ?? "Finyx Wallet Access";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Finyx Verification</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:Arial, sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background:#ffffff;border-radius:24px;border:1px solid #e2e8f0;box-shadow:0 24px 60px rgba(15,23,42,0.08);">
            <tr>
              <td style="padding:32px;">
                <p style="font-size:12px;letter-spacing:0.3em;text-transform:uppercase;color:#ffad40;margin:0 0 12px 0;">${tagline}</p>
                <h1 style="font-size:26px;margin:0 0 8px 0;color:#0f172a;">${heading}</h1>
                <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px 0;">
                  ${message}
                </p>
                <div style="background:#f1f5f9;border-radius:16px;padding:20px;text-align:center;">
                  <span style="font-size:24px;letter-spacing:0.4em;font-weight:700;color:#0f172a;">${safeCode}</span>
                </div>
                <p style="font-size:12px;color:#94a3b8;margin:24px 0 0 0;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
