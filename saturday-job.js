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

var emailMessage = "<h3>" + dayText + "</h3><br><p>Today's Date is: " + todayDate.toLocaleString() + "</p>";

let mailOptions = {
  from: 'gwadegraham@gmail.com',
  to: 'garrett_graham@icloud.com',
  subject: 'Campus Clash | Saturday Update',
  html: emailMessage
};

if (todayDate.getDay() == 6) {
  if ((todayDate.getHours() % 15 == 0) || (todayDate.getHours() % 18 == 0) || (todayDate.getHours() % 20 == 0)) {
    dayText = "Today is Saturday, so games & scores are being updated during the 3PM, 6PM, and 10PM windows.";
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
    dayText = "Today is not Saturday, so games & scores are NOT being updated.";
    console.log(dayText);
    console.log("Current Date", todayDate.toLocaleString());
}