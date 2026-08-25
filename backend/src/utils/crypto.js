// Enkripsi token ads (at-rest) — AES-256-GCM.
//
// Format ciphertext: enc:v1:<iv>:<tag>:<ct>  (masing-masing base64)
// - iv  : 12 byte acak, baru untuk SETIAP enkripsi
// - tag : GCM auth tag (16 byte)
// - ct  : ciphertext
//
// Key dari env TOKEN_ENCRYPTION_KEY (64 hex char = 32 byte).
// - Key kosong + NODE_ENV=production → tolak boot (throw saat modul dimuat).
// - Key kosong di dev/test → warning keras SEKALI saat boot, token disimpan
//   plaintext (encryptToken mengembalikan input apa adanya).
// - decryptToken: string tanpa prefix "enc:v1:" dianggap plaintext lama dan
//   dikembalikan apa adanya (kompatibel data sebelum v1.1).
const crypto = require("crypto");
const config = require("../config");

const PREFIX = "enc:v1:";
const KEY_RE = /^[0-9a-fA-F]{64}$/;
const IV_BYTES = 12;

let key = null;

if (config.tokenEncryptionKey) {
  if (!KEY_RE.test(config.tokenEncryptionKey)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY tidak valid: harus 64 karakter hex (32 byte). " +
        "Generate dengan: openssl rand -hex 32"
    );
  }
  key = Buffer.from(config.tokenEncryptionKey, "hex");
} else if (config.nodeEnv === "production") {
  throw new Error(
    "TOKEN_ENCRYPTION_KEY wajib diisi saat NODE_ENV=production. " +
      "Generate 64 hex char dengan: openssl rand -hex 32, lalu set di .env. " +
      "Server menolak boot supaya token ads tidak tersimpan plaintext."
  );
} else {
  // Peringatan keras sekali saat boot (dev/test): token disimpan plaintext.
  // Sengaja console.warn (bukan logger) agar tidak ada dependensi melingkar
  // dan selalu terlihat apa pun LOG_LEVEL.
  // eslint-disable-next-line no-console
  console.warn(
    "==================================================================\n" +
      "[crypto] PERINGATAN: TOKEN_ENCRYPTION_KEY kosong!\n" +
      "[crypto] Token ads akan disimpan PLAINTEXT di database.\n" +
      "[crypto] Generate key: openssl rand -hex 32  → set TOKEN_ENCRYPTION_KEY.\n" +
      "[crypto] Di NODE_ENV=production server akan MENOLAK boot tanpa key.\n" +
      "=================================================================="
  );
}

function hasKey() {
  return key !== null;
}

// Enkripsi satu string token. null/undefined/"" dikembalikan apa adanya.
// Tanpa key (dev): kembalikan plaintext (sudah diperingatkan saat boot).
function encryptToken(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return plaintext;
  }
  const value = String(plaintext);
  if (!key) return value;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString("base64") +
    ":" +
    tag.toString("base64") +
    ":" +
    ct.toString("base64")
  );
}

// Dekripsi string berformat enc:v1:<iv>:<tag>:<ct>. String tanpa prefix
// dianggap plaintext lama (passthrough).
function decryptToken(value) {
  if (value === null || value === undefined || value === "") return value;
  const str = String(value);
  if (!str.startsWith(PREFIX)) return str; // data lama / plaintext
  if (!key) {
    throw new Error(
      "Menemukan token terenkripsi (enc:v1:) tapi TOKEN_ENCRYPTION_KEY kosong — " +
        "set key yang sama dengan saat enkripsi."
    );
  }
  const parts = str.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Format token terenkripsi tidak valid (harus enc:v1:<iv>:<tag>:<ct>).");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

// sha256 hex — dipakai untuk hash refresh/reset token di DB.
function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

module.exports = { encryptToken, decryptToken, sha256Hex, hasKey };
