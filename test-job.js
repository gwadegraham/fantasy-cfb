if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const todayDate = new Date();

if (todayDate.getDay() == 0) {
    console.log("Today is Sunday, so games & scores are being updated.");
    console.log("Current Date", todayDate.toLocaleString())
} else {
    console.log("Today is not Sunday, so games & scores are NOT being updated.");
    console.log("Current Date", todayDate.toLocaleString())
}