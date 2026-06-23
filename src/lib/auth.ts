import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAMES } from './constants';

const encoder = new TextEncoder();

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }
  return encoder.encode(secret);
}

export type AdminTokenPayload = {
  type: 'admin';
  email: string;
};

export type ParticipantTokenPayload = {
  type: 'participant';
  sessionId: string;
  participantId: string;
  loginToken?: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: AdminTokenPayload | ParticipantTokenPayload, maxAgeSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifyToken<T extends AdminTokenPayload | ParticipantTokenPayload>(token?: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as T;
  } catch {
    return null;
  }
}

export async function requireAdmin(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAMES.admin)?.value;
  const payload = await verifyToken<AdminTokenPayload>(token);
  if (!payload || payload.type !== 'admin') return null;
  return payload;
}

export async function requireParticipant(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAMES.participant)?.value;
  const payload = await verifyToken<ParticipantTokenPayload>(token);
  if (!payload || payload.type !== 'participant') return null;
  return payload;
}

export function setSecureCookie(response: NextResponse, name: string, token: string, maxAgeSeconds: number) {
  response.cookies.set(name, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds
  });
}

export function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  });
}
