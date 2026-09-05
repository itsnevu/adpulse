// Renderer markdown ringkas untuk jawaban agent.
//
// Sengaja tanpa dependency dan tanpa dangerouslySetInnerHTML: teks yang
// dirender di sini berasal dari model, yang membacanya dari halaman web dan
// hasil tool. Menyuntikkan string itu sebagai HTML mentah berarti halaman
// kompetitor yang di-scrape bisa menitipkan <script> ke dashboard user.
// Semua output di bawah adalah elemen React, jadi teks tetap teks.
//
// Yang didukung: heading, paragraf, daftar berpoin/bernomor, blok kode, tabel,
// **tebal**, dan `kode inline` — persis yang diminta system prompt agent.

function inline(text, keyPrefix) {
  // Pecah pada **tebal** dan `kode` sekaligus supaya keduanya bisa muncul
  // dalam satu baris tanpa saling menelan.
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-i${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

const isTableRow = (line) => line.trim().startsWith("|");
const isTableDivider = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line);
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export default function Markdown({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blok kode berpagar
    if (line.trim().startsWith("```")) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // lewati penutup
      blocks.push(
        <pre
          key={`b${blocks.length}`}
          className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800"
        >
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Tabel: baris header + baris pemisah + isi
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        // Tabel lebar harus menggulir di dalam kotaknya sendiri, bukan
        // membuat seluruh halaman ikut bergeser ke samping.
        <div key={`b${blocks.length}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                {header.map((cell, c) => (
                  <th key={c} className="px-2 py-1.5 text-left font-semibold text-gray-700">
                    {inline(cell, `th${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-gray-100 last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1.5 text-gray-700">
                      {inline(cell, `td${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={`b${blocks.length}`} className="mt-1 text-sm font-semibold text-gray-900">
          {inline(heading[2], `h${blocks.length}`)}
        </p>
      );
      i += 1;
      continue;
    }

    // Daftar berpoin / bernomor
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={`b${blocks.length}`}
          className={`ml-4 space-y-1 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, n) => (
            <li key={n} className="text-sm leading-relaxed text-gray-700">
              {inline(item, `li${blocks.length}-${n}`)}
            </li>
          ))}
        </List>
      );
      continue;
    }

    // Baris kosong
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Paragraf: kumpulkan baris berturut-turut sampai ketemu blok lain.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !isTableRow(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`b${blocks.length}`} className="text-sm leading-relaxed text-gray-700">
        {inline(para.join(" "), `p${blocks.length}`)}
      </p>
    );
  }

  return <div className="space-y-2.5">{blocks}</div>;
}
