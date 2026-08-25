// Field zod yang dipakai bersama beberapa route.
const { z } = require("zod");
const { isValidDateStr } = require("./dates");

// Query string kosong ("?platform=") diperlakukan seperti tidak dikirim —
// sama dengan perilaku lama yang menganggap "" falsy.
function emptyToUndef(schema) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema);
}

// Tanggal "YYYY-MM-DD" yang benar-benar valid di kalender.
const dateStr = z
  .string({ message: "Harus format YYYY-MM-DD" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Harus format YYYY-MM-DD" })
  .refine(isValidDateStr, { message: "Tanggal tidak valid" });

// superRefine helper: from <= to bila keduanya dikirim (dan formatnya sudah
// benar — kalau format salah, cukup error format saja yang muncul).
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function fromLteTo(val, ctx) {
  if (
    typeof val.from === "string" &&
    typeof val.to === "string" &&
    YMD_RE.test(val.from) &&
    YMD_RE.test(val.to) &&
    val.from > val.to
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["from"],
      message: "Parameter from harus <= to",
    });
  }
}

module.exports = { emptyToUndef, dateStr, fromLteTo };
