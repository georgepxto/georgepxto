import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN;
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_FILE ?? "assets/atividade.svg";
const MOCK = process.env.MOCK_FILE;

const ACCENT = "#1f8f4e";
const LEVELS = ["#161b22", "#0f3b23", "#146b37", "#1f8f4e", "#3fbf73"];
const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans', Helvetica, Arial, sans-serif";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const QUERY = `query($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
      totalCount
      nodes {
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount date weekday } }
      }
    }
  }
}`;

async function load() {
  if (MOCK) return JSON.parse(readFileSync(MOCK, "utf8"));
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data.user;
}

const fmt = (n) => n.toLocaleString("pt-BR");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function languageShares(repos) {
  const totals = new Map();
  for (const repo of repos.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const prev = totals.get(node.name) ?? { size: 0, color: node.color ?? "#8b949e" };
      prev.size += size;
      totals.set(node.name, prev);
    }
  }
  const sum = [...totals.values()].reduce((a, b) => a + b.size, 0) || 1;
  const sorted = [...totals.entries()].sort((a, b) => b[1].size - a[1].size);
  const top = sorted.slice(0, 5).map(([name, v]) => ({ name, color: v.color, share: v.size / sum }));
  const rest = sorted.slice(5).reduce((a, [, v]) => a + v.size, 0) / sum;
  if (rest > 0.005) top.push({ name: "Outras", color: "#6e7681", share: rest });
  return top;
}

function levelFor(count, thresholds) {
  if (count === 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

function render(user) {
  const c = user.contributionsCollection;
  const cal = c.contributionCalendar;
  const W = 860;
  const P = 28;
  const parts = [];

  parts.push(`<text x="${P}" y="${P + 10}" class="eyebrow">ATIVIDADE NO GITHUB</text>`);
  parts.push(`<text x="${W - P}" y="${P + 10}" class="eyebrow" text-anchor="end">ÚLTIMOS 12 MESES</text>`);

  const stats = [
    [cal.totalContributions, "contribuições"],
    [c.totalCommitContributions + c.restrictedContributionsCount, "commits"],
    [c.totalPullRequestContributions, "pull requests"],
    [user.repositories.totalCount, "repositórios públicos"],
  ];
  const colW = (W - P * 2) / stats.length;
  stats.forEach(([value, label], i) => {
    const x = P + i * colW;
    if (i > 0) parts.push(`<line x1="${x - 16}" y1="${P + 32}" x2="${x - 16}" y2="${P + 78}" class="rule"/>`);
    parts.push(`<text x="${x}" y="${P + 62}" class="value">${fmt(value)}</text>`);
    parts.push(`<text x="${x}" y="${P + 82}" class="label">${label}</text>`);
  });

  const days = cal.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)).filter((n) => n > 0).sort((a, b) => a - b);
  const q = (p) => days[Math.floor((days.length - 1) * p)] ?? 1;
  const thresholds = [q(0.25), q(0.5), q(0.75)];

  const weeks = cal.weeks.slice(-53);
  const gap = 3;
  const cell = Math.floor((W - P * 2 - gap * (weeks.length - 1)) / weeks.length);
  const gridW = weeks.length * cell + (weeks.length - 1) * gap;
  const gx = P + Math.floor((W - P * 2 - gridW) / 2);
  const gy = P + 132;

  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const x = gx + wi * (cell + gap);
    const first = week.contributionDays[0];
    const month = Number(first.date.slice(5, 7)) - 1;
    if (month !== lastMonth && wi < weeks.length - 2) {
      if (lastMonth !== -1 || Number(first.date.slice(8, 10)) <= 7) {
        parts.push(`<text x="${x}" y="${gy - 10}" class="month">${MONTHS[month]}</text>`);
      }
      lastMonth = month;
    }
    for (const day of week.contributionDays) {
      const y = gy + day.weekday * (cell + gap);
      const fill = LEVELS[levelFor(day.contributionCount, thresholds)];
      parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"><title>${day.date}: ${day.contributionCount}</title></rect>`);
    }
  });

  const gridBottom = gy + 7 * (cell + gap) - gap;
  const legendY = gridBottom + 18;
  const lx = gx + gridW - 34;
  parts.push(`<text x="${lx - 5 * (cell + gap) - 8}" y="${legendY + cell - 2}" class="label" text-anchor="end">menos</text>`);
  LEVELS.forEach((color, i) => {
    parts.push(`<rect x="${lx - (5 - i) * (cell + gap) + gap}" y="${legendY}" width="${cell}" height="${cell}" rx="2" fill="${color}"/>`);
  });
  parts.push(`<text x="${lx + 8}" y="${legendY + cell - 2}" class="label">mais</text>`);

  const langs = languageShares(user.repositories);
  const barY = legendY + 44;
  const barW = W - P * 2;
  parts.push(`<text x="${P}" y="${barY - 12}" class="eyebrow">LINGUAGENS NOS REPOSITÓRIOS</text>`);
  parts.push(`<clipPath id="bar"><rect x="${P}" y="${barY}" width="${barW}" height="8" rx="4"/></clipPath>`);
  let bx = P;
  const segs = [];
  langs.forEach((l, i) => {
    const w = i === langs.length - 1 ? P + barW - bx : Math.round(l.share * barW);
    segs.push(`<rect x="${bx}" y="${barY}" width="${Math.max(w, 0)}" height="8" fill="${l.color}"/>`);
    bx += w;
  });
  parts.push(`<g clip-path="url(#bar)">${segs.join("")}</g>`);

  let tx = P;
  const ty = barY + 32;
  for (const l of langs) {
    const pct = `${(l.share * 100).toFixed(1).replace(".", ",")}%`;
    const width = 22 + (l.name.length + pct.length + 1) * 7.2;
    parts.push(`<circle cx="${tx + 5}" cy="${ty - 4}" r="5" fill="${l.color}"/>`);
    parts.push(`<text x="${tx + 16}" y="${ty}" class="lang">${esc(l.name)} <tspan class="pct">${pct}</tspan></text>`);
    tx += width + 14;
  }

  const H = ty + P - 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Atividade de ${esc(LOGIN ?? "")} no GitHub">
<style>
text { font-family: ${FONT}; }
.eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; fill: #9198a1; }
.value { font-size: 30px; font-weight: 600; fill: #f0f6fc; }
.label { font-size: 12px; fill: #9198a1; }
.month { font-size: 11px; fill: #9198a1; }
.lang { font-size: 12px; fill: #f0f6fc; }
.pct { fill: #9198a1; }
.rule { stroke: #3d444d; stroke-width: 1; }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="#0d1117" stroke="#3d444d"/>
<rect x="${P}" y="${P + 22}" width="24" height="2" fill="${ACCENT}"/>
${parts.join("\n")}
</svg>
`;
}

const user = await load();
mkdirSync(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true });
writeFileSync(OUT, render(user));
console.log(`Gerado ${OUT}`);
