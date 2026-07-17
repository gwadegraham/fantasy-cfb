const nodemailer = require('nodemailer');

function escapeHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Builds the run-report email HTML: outcome, a stat table (season/week/games/
// teams/duration on success), and the error stack on failure. Pure (no I/O) so
// it can be unit-tested and previewed.
function buildJobEmailHtml({ label, when, ok, rows, error }) {
    const heading = ok ? '✅ Update complete' : '❌ Update failed';
    const accent = ok ? '#71d28d' : '#ef5350';

    const statRows = (rows || []).map(function (r) {
        return `<tr>
            <td style="padding:6px 12px;color:#9e9e9e;border-bottom:1px solid #2a2a2a;">${escapeHtml(r[0])}</td>
            <td style="padding:6px 12px;color:#e0e0e0;text-align:right;border-bottom:1px solid #2a2a2a;">${escapeHtml(r[1])}</td>
        </tr>`;
    }).join('');

    const statTable = statRows
        ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">${statRows}</table>`
        : '';

    const errorBlock = (!ok && error)
        ? `<div style="padding:20px;"><h2 style="margin:0 0 8px;font-size:16px;color:#ef5350;">Error</h2>
            <pre style="white-space:pre-wrap;word-break:break-word;background:#121212;color:#ef9a9a;padding:12px;border-radius:6px;font-size:12px;margin:0;">${escapeHtml(error)}</pre></div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Campus Clash - ${escapeHtml(label)}</title></head>
<body style="font-family:Arial,sans-serif;background-color:#eceff1;margin:0;padding:24px 12px;color:#e0e0e0;">
  <div style="max-width:600px;margin:0 auto;background-color:#1e1e1e;border-radius:8px;overflow:hidden;">
    <div style="background-color:#0d47a1;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:24px;">🏈 Campus Clash · ${escapeHtml(label)}</h1></div>
    <div style="padding:20px;border-bottom:1px solid #333;">
      <h2 style="margin:0 0 4px;font-size:18px;color:${accent};">${heading}</h2>
      ${statTable}
    </div>
    ${errorBlock}
    <div style="padding:16px 20px;font-size:12px;color:#888;">Run at ${escapeHtml(when)} (Central)</div>
  </div>
</body></html>`;
}

// Sends the run-report email. Best-effort — a mail failure is logged, never thrown.
async function sendJobEmail(opts) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
    const html = buildJobEmailHtml(opts);
    try {
        const info = await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: 'gwadegraham@gmail.com',
            subject: `Campus Clash | ${opts.label}${opts.ok ? '' : ' FAILED'}`,
            html
        });
        console.log('Email sent: ' + info.response);
    } catch (mailErr) {
        console.log(mailErr);
    }
}

module.exports = { sendJobEmail, buildJobEmailHtml };
