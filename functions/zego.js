// ZEGOCLOUD Token04, ported from the official reference
// (github.com/ZEGOCLOUD/zego_server_assistant, token/nodejs/server/zegoServerAssistant.ts),
// with crypto-grade randomness for the nonce and IV instead of Math.random.
import { createCipheriv, randomBytes, randomInt } from 'node:crypto';

const IV_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const randomIv = () => Array.from(randomBytes(16), (b) => IV_CHARS[b % IV_CHARS.length]).join('');

/**
 * @param {number} appId ZEGOCLOUD AppID
 * @param {string} userId the user joining
 * @param {string} secret 32-character ServerSecret
 * @param {number} seconds validity
 * @param {string} roomId the token only lets the user log in to (and publish in) this room
 */
export function generateToken04(appId, userId, secret, seconds, roomId) {
  if (!appId || typeof appId !== 'number') throw new Error('appID invalid');
  if (!userId || typeof userId !== 'string') throw new Error('userId invalid');
  if (typeof secret !== 'string' || secret.length !== 32) throw new Error('secret must be a 32 byte string');
  if (!seconds || typeof seconds !== 'number') throw new Error('effectiveTimeInSeconds invalid');
  const ctime = Math.floor(Date.now() / 1000);
  const payload = roomId ? JSON.stringify({ room_id: roomId, privilege: { 1: 1, 2: 1 }, stream_id_list: null }) : '';
  const info = { app_id: appId, user_id: userId, nonce: randomInt(-2147483648, 2147483647), ctime, expire: ctime + seconds, payload };
  const iv = randomIv();
  const cipher = createCipheriv('aes-256-cbc', secret, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(info)), cipher.final()]);
  const head = Buffer.alloc(8);
  head.writeBigInt64BE(BigInt(info.expire));
  const len = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  return `04${Buffer.concat([head, len(iv.length), Buffer.from(iv), len(enc.length), enc]).toString('base64')}`;
}
