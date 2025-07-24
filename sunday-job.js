if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const todayDate = new Date();
todayDate.setHours(todayDate.getHours() - 5);

var dayText = "";

let nodemailer = require('nodemailer');

let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'gwadegraham@gmail.com',
    pass: 'flgb pbdh dewn lhmw'
  }
});

var emailMessage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Campus Clash - Weekly Recap</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #121212;
      margin: 0;
      padding: 0;
      color: #e0e0e0;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #1e1e1e;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background-color: #0d47a1;
      color: #ffffff;
      padding: 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .section {
      padding: 20px;
      border-bottom: 1px solid #333333;
    }
    .section h2 {
      margin-top: 0;
      font-size: 18px;
      color: #90caf9;
    }
    .stat {
      margin: 6px 0;
      line-height: 1.4em;
    }
    .highlight {
      font-weight: bold;
      color: #64b5f6;
    }
    .footer {
      text-align: center;
      padding: 15px;
      font-size: 12px;
      color: #888888;
      background-color: #121212;
    }
    ol {
      padding-left: 18px;
    }
    @media (max-width: 600px) {
      .section h2 {
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container" style="background-color: #1e1e1e;">

    <div class="header">
      <h1>🏈 Campus Clash - Sunday Update</h1>
    </div>

    <div class="section">
      <h2>✅ Update Complete</h2>
      <p class="stat" style="color: #e0e0e0;">Games & scores are being updated during the 3AM & 6AM windows.</p>
    </div>

    <div class="section">
      <h2>📅 Current Date & Time</h2>
      <p style="color: #e0e0e0;">${todayDate.toLocaleString()}</p>
    </div>
    
  </div>
</body>
</html>
`;

let mailOptions = {
  from: 'gwadegraham@gmail.com',
  to: 'garrett_graham@icloud.com',
  subject: 'Campus Clash | Sunday Update',
  html: emailMessage
};

if (todayDate.getDay() == 0) {
  if ((todayDate.getHours() == 3) || (todayDate.getHours() == 6)) {
    dayText = "Today is Sunday, so games & scores are being updated during the 3AM & 6AM windows.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString());

    transporter.sendMail(mailOptions, function(error, info){
      if (error) {
        console.log(error);
      } else {
        console.log('Email sent: ' + info.response);
      }
    });
  }
} else {
    dayText = "Today is not Sunday, so games & scores are NOT being updated.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString());
}