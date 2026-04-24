import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "pm_auth";

function sign(value: string) {
  const secret = process.env.APP_SESSION_SECRET ?? "dev-secret-change-me";
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function setAuth() {
  const value = sign("ok");
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function isAuthed() {
  const c = await cookies();
  const cookie = c.get(COOKIE)?.value;
  if (!cookie) return false;
  const expected = sign("ok");
  const a = Buffer.from(cookie);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(input: string) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}
