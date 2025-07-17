if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const todayDate = new Date();
var dayText = "";

if (todayDate.getDay() == 0) {
    dayText = "Today is Sunday, so games & scores are being updated.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString())
} else {
    dayText = "Today is not Sunday, so games & scores are NOT being updated.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString())
}

let nodemailer = require('nodemailer');

let transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'gwadegraham@gmail.com',
    pass: 'flgb pbdh dewn lhmw'
  }
});

var emailMessage = "<h3>" + dayText + "</h3><br><p>Today's Date is: " + todayDate.toLocaleString() + "</p>";

let mailOptions = {
  from: 'gwadegraham@gmail.com',
  to: 'garrett_graham@icloud.com',
  subject: 'Campus Clash | Daily Test Job',
  html: emailMessage
};

transporter.sendMail(mailOptions, function(error, info){
  if (error) {
    console.log(error);
  } else {
    console.log('Email sent: ' + info.response);
  }
});