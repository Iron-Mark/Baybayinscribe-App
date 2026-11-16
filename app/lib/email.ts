import "server-only";

import nodemailer from 'nodemailer';

type EmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export const sendEmail = async (options: EmailOptions) => {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("Email delivery is not configured");
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER, 
      to: options.to,
      subject: options.subject,
      text: options.text,
      ...(options.html ? { html: options.html } : {}),
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
      throw new Error("Email was not accepted");
    }
    
    return { success: true, messageId: info.messageId };
  } catch {
    // Never log recipients, verification URLs/tokens or provider credential errors.
    // Development must fail closed too; tests inject an isolated transport.
    throw new Error("Email delivery failed");
  }
};
