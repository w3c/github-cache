"use strict";
const nodemailer = require('nodemailer');


const transporter = nodemailer.createTransport({
  sendmail: true,
  newline: 'unix',
  path: '/usr/sbin/sendmail',
});

let MAILING_LIST, SENDER_EMAIL;

if (process.env.NODE_ENV == 'production') {
  MAILING_LIST = "plh@w3.org";
  SENDER_EMAIL = "plh@w3.org";
} else {
  MAILING_LIST = "plh@w3.org";
  SENDER_EMAIL = "plh@w3.org";
}

function email(msg) {
  const mailOptions = {
    from: "GitHub Cache error <" + SENDER_EMAIL + ">",
    to: MAILING_LIST,
    subject: "GitHub Cache error report",
    text: msg
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(error);
      return sendError(error); // notify plh
    }
    console.log('Message sent: %s', info.messageId);
  });

}

function sendError(error) {
  // if things go wrong, please call the maintainer
  const mailOptions = {
    from: "GitHub Cache error <" + SENDER_EMAIL + ">",
    to: "plh@w3.org",
    subject: "GitHub Cache error report",
    text: "We've got an error on the github cache email. You might want to look at this JSON object:\n" + JSON.stringify(error)
  };

  return transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.error(JSON.stringify(error));
    }
    console.log('Error message sent: %s', info.messageId);
  });

}

module.exports = email;
