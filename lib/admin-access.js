import crypto from 'crypto';
import nodemailer from 'nodemailer';

/**
 * Admin dashboard access — email one-time codes.
 *
 * The admin panel is unlocked with a 6-digit code mailed to the configured
 * admin inbox. The address is never returned to the browser: the client only
 * ever sees "code sent". A successful check mints an HttpOnly session cookie
 * that keeps the panel open for the rest of the day.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 20 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 6;
const COOKIE_NAME = 'hz_admin';

const pending = new Map(); // mailbox -> { otp, expiresAt, attempts }
const sessions = new Map(); // token -> { email, expiresAt }
const sendsByIp = new Map(); // ip -> number[] (timestamps)

function mailboxList() {
  const explicit = String(process.env.ADMIN_OTP_EMAIL || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes('@'));
  if (explicit.length) return explicit;
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes('@'));
}

const SOCKET_OPTS = { connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000 };

function mailTransport() {
  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailPass = String(process.env.GMAIL_APP_PASS || '').trim();
  if (gmailUser && gmailPass) {
    // Gmail resets the implicit-TLS socket now and then; the STARTTLS port is
    // the same mailbox, so try it before telling the admin the send failed.
    return {
      from: `"Hamzooh" <${gmailUser}>`,
      transports: [465, 587].map((port) => nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: { user: gmailUser, pass: gmailPass },
        ...SOCKET_OPTS,
      })),
    };
  }
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.COMPANY_MAIL_USER || '').trim();
  const pass = String(process.env.COMPANY_MAIL_PASS || '').trim();
  if (host && user && pass) {
    const port = Number(process.env.SMTP_PORT || 587) || 587;
    return {
      from: `"Hamzooh" <${user}>`,
      transports: [nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        ...SOCKET_OPTS,
      })],
    };
  }
  return null;
}

function cookieValue(req, name) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

function isHttps(req) {
  const forwarded = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https' || Boolean(req?.secure);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function ipOf(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown');
}

function prune(now = Date.now()) {
  for (const [mailbox, entry] of pending) {
    if (!entry || entry.expiresAt <= now) pending.delete(mailbox);
  }
  for (const [token, entry] of sessions) {
    if (!entry || entry.expiresAt <= now) sessions.delete(token);
  }
  for (const [ip, stamps] of sendsByIp) {
    const fresh = stamps.filter((stamp) => stamp > now - WINDOW_MS);
    if (fresh.length) sendsByIp.set(ip, fresh);
    else sendsByIp.delete(ip);
  }
}

function noteSend(ip, now) {
  const stamps = (sendsByIp.get(ip) || []).filter((stamp) => stamp > now - WINDOW_MS);
  stamps.push(now);
  sendsByIp.set(ip, stamps);
  return stamps;
}

/** True when this request carries a live admin session cookie. */
export function hasAdminSession(req) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return false;
  const entry = sessions.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(res, req, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function otpEmailHtml(otp) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 16px; color: #0f172a; font-size: 22px; font-weight: 700;">Admin access code</h2>
      <p style="margin: 0 0 24px; color: #475569; font-size: 15px; line-height: 1.5;">Use this one-time code to unlock the Hamzooh admin dashboard:</p>
      <div style="background: #f1f5f9; padding: 18px 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0f172a; font-family: monospace;">${otp}</span>
      </div>
      <p style="margin: 0; color: #94a3b8; font-size: 13px;">This code expires in 10 minutes. If you did not ask for it, someone tried to open the admin dashboard — the code is useless without this inbox.</p>
    </div>
  `;
}

export function registerAdminAccess(app) {
  app.post('/api/admin/otp/request', async (req, res) => {
    const now = Date.now();
    prune(now);

    const mailboxes = mailboxList();
    if (!mailboxes.length) {
      return res.status(503).json({ error: 'Admin access is not configured on this server.' });
    }

    const ip = ipOf(req);
    const stamps = sendsByIp.get(ip) || [];
    const last = stamps[stamps.length - 1] || 0;
    if (last && now - last < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000);
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: `Wait ${wait}s before asking for another code.` });
    }
    if (stamps.filter((stamp) => stamp > now - WINDOW_MS).length >= MAX_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many codes requested. Try again in a few minutes.' });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    for (const mailbox of mailboxes) {
      pending.set(mailbox, { otp, expiresAt: now + OTP_TTL_MS, attempts: 0 });
    }
    noteSend(ip, now);

    const mailer = mailTransport();
    if (!mailer) {
      // Development shortcut: only a local caller is handed the code back.
      const remote = String(req.socket?.remoteAddress || '');
      const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      if (process.env.NODE_ENV !== 'production' && loopback) {
        return res.json({ success: true, message: 'Code generated for local development.', devOtp: otp });
      }
      for (const mailbox of mailboxes) pending.delete(mailbox);
      return res.status(503).json({ error: 'Email delivery is not configured on this server.' });
    }

    const message = {
      from: mailer.from,
      to: mailboxes.join(', '),
      subject: 'Your Hamzooh admin access code',
      text: `Your Hamzooh admin access code is ${otp}. It expires in 10 minutes.`,
      html: otpEmailHtml(otp),
    };
    let lastError = null;
    for (const transporter of mailer.transports) {
      try {
        await transporter.sendMail(message);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.warn('Admin OTP send attempt failed:', err?.code || err?.message || err);
      }
    }
    if (lastError) {
      for (const mailbox of mailboxes) pending.delete(mailbox);
      console.error('Error sending admin OTP:', lastError?.message || lastError);
      return res.status(500).json({ error: 'Could not send the admin code. Check the server mail settings and try again.' });
    }

    // The response never names the inbox.
    return res.json({ success: true, message: 'Code sent to the admin inbox.' });
  });

  app.post('/api/admin/otp/verify', (req, res) => {
    const now = Date.now();
    prune(now);

    const otp = String(req.body?.otp || '').trim();
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: 'Enter the 6-digit code.' });
    }

    const candidates = [...pending.entries()].filter(([, entry]) => entry && entry.expiresAt > now);
    if (!candidates.length) {
      return res.status(400).json({ error: 'The code has expired. Ask for a new one.' });
    }

    const match = candidates.find(([, entry]) => safeEqual(entry.otp, otp));
    if (!match) {
      for (const [mailbox, entry] of candidates) {
        const attempts = Number(entry.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) pending.delete(mailbox);
        else entry.attempts = attempts;
      }
      return res.status(400).json({ error: 'That code is not valid.' });
    }

    const [mailbox] = match;
    pending.delete(mailbox);

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { email: mailbox, expiresAt: now + SESSION_TTL_MS });
    setSessionCookie(res, req, token);
    return res.json({ success: true });
  });

  app.get('/api/admin/otp/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ authenticated: hasAdminSession(req) });
  });

  app.post('/api/admin/otp/logout', (req, res) => {
    const token = cookieValue(req, COOKIE_NAME);
    if (token) sessions.delete(token);
    res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true });
  });
}
