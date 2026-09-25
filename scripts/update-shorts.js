#!/usr/bin/env node
const fs = require("node:fs");

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) throw new Error("O segredo YOUTUBE_API_KEY não está disponível.");

const FILE = "shorts.json";
const LIMIT = 10;
const MAX_SHORT_SECONDS = 180;
const QUERIES = [
  "hino gospel a capela português sem instrumentos",
  "música gospel acapella português sem instrumento",
  "hino da harpa a capela português",
  "harpa cristã acapella português",
  "louvor gospel a capela português",
  "cover gospel acapella português",
  "hino evangélico a capela português",
  "hino cristão acapella português"
];
const REQUIRED = /\b(a\s*cappella|a\s*capela|acapella|sem\s+instrument)/i;
const GOSPEL = /\b(hino|harpa|gospel|louvor|adoração|crist[ãa]|jesus|deus|senhor|cristo|igreja)\b/i;
const PORTUGUESE = /\b(deus|jesus|senhor|cristo|louvor|hino|harpa|adoração|graça|salvação|pecador|remido|cruz|santo|igreja|irmãos|porque|vive|caminho|chuvas|amor|fé)\b/i;
const REJECTED = /\b(violão|guitarra|piano|teclado|bateria|playback|instrumental|karaok[eê]|cover instrumental)\b/i;

function isoDurationToSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || "");
  if (!match) return Infinity;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

async function youtube(path, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [key, value] of Object.entries({ ...params, key: API_KEY })) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "Falha na YouTube Data API.");
  return body;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const today = new Date().toISOString().slice(0, 10);

  // Não repete vídeos de dias anteriores. Em uma nova execução no mesmo dia,
  // os vídeos do próprio dia podem reaparecer para não forçar uma troca vazia.
  const usedIds = new Set(
    data.days
      .filter((day) => day.date !== today)
      .flatMap((day) => day.items.map((item) => item.id))
  );
  const searchResults = new Map();

  for (const query of QUERIES) {
    let pageToken = "";
    for (let page = 0; page < 2; page += 1) {
      const params = {
        part: "snippet",
        q: query,
        type: "video",
        videoDuration: "short",
        relevanceLanguage: "pt",
        regionCode: "BR",
        maxResults: "50"
      };
      if (pageToken) params.pageToken = pageToken;

      const result = await youtube("search", params);

      for (const item of result.items || []) {
        const id = item.id?.videoId;
        const text = [item.snippet?.title, item.snippet?.description].join(" ");
        if (
          id &&
          !usedIds.has(id) &&
          REQUIRED.test(text) &&
          GOSPEL.test(text) &&
          PORTUGUESE.test(text) &&
          !REJECTED.test(text)
        ) {
          searchResults.set(id, item);
        }
      }

      pageToken = result.nextPageToken || "";
      if (!pageToken) break;
    }
  }

  const ids = [...searchResults.keys()];
  const details = new Map();
  for (let index = 0; index < ids.length; index += 50) {
    const result = await youtube("videos", {
      part: "contentDetails,snippet",
      id: ids.slice(index, index + 50).join(",")
    });
    for (const item of result.items || []) details.set(item.id, item);
  }

  const items = ids
    .map((id) => details.get(id))
    .filter((item) => item && isoDurationToSeconds(item.contentDetails?.duration) <= MAX_SHORT_SECONDS)
    .map((item) => ({
      id: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      url: "https://www.youtube.com/shorts/" + item.id
    }))
    .slice(0, LIMIT);

  if (items.length === 0) {
    console.log("Nenhuma alteração: nenhum candidato inédito passou pelos filtros.");
    return;
  }

  if (items.length < LIMIT) {
    console.log(
      "Aviso: foram encontrados apenas " + items.length +
      " candidatos confirmados. O dia será atualizado mesmo assim, sem preencher com vídeos inadequados."
    );
  }

  const dayIndex = data.days.findIndex((day) => day.date === today);
  const day = { date: today, items };
  if (dayIndex >= 0) data.days[dayIndex] = day;
  else data.days.push(day);

  data.updated_at = today;
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log("shorts.json atualizado com " + items.length + " vídeo(s) para " + today + ".");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
