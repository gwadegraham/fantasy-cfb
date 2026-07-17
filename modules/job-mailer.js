const nodemailer = require('nodemailer');

// Shared status email for the scheduled jobs (was duplicated ~90 lines per job
// file). Best-effort — a mail failure is logged, never thrown.
async function sendJobEmail({ label, when, ok, detail }) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    const heading = ok ? '✅ Update Complete' : '❌ Update Failed';
    const accent = ok ? '#90caf9' : '#ef5350';
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Campus Clash - ${label}</title></head>
<body style="font-family:Arial,sans-serif;background-color:#121212;margin:0;padding:0;color:#e0e0e0;">
  <div style="max-width:600px;margin:0 auto;background-color:#1e1e1e;border-radius:8px;overflow:hidden;">
    <div style="background-color:#0d47a1;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:24px;">🏈 Campus Clash - ${label}</h1></div>
    <div style="padding:20px;border-bottom:1px solid #333;"><h2 style="margin-top:0;font-size:18px;color:${accent};">${heading}</h2><p style="color:#e0e0e0;">${detail || ''}</p></div>
    <div style="padding:20px;"><h2 style="margin-top:0;font-size:18px;color:#90caf9;">📅 When</h2><p style="color:#e0e0e0;">${when}</p></div>
  </div>
</body></html>`;

    try {
        const info = await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: 'gwadegraham@gmail.com',
            subject: `Campus Clash | ${label}${ok ? '' : ' FAILED'}`,
            html
        });
        console.log('Email sent: ' + info.response);
    } catch (mailErr) {
        console.log(mailErr);
    }
}

module.exports = { sendJobEmail };
