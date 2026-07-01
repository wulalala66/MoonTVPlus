import { Buffer } from 'node:buffer';

const DEFAULT_CONFIG = {
  parserApi: 'https://json.jlvungo.cn/api.php/',
  parserKey: '',
  parserCandidatesText: '',
  publicBaseUrl: '',
  playMode: 'direct',
  cacheTtlMinutes: 30,
  biliCookie: '',
  enabledPlatforms: ['mgtv', 'qq', 'iqiyi', 'youku', 'bili'],
  includeAggregateSource: false,
};

const PC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const parseCache = new Map();
const parseInflight = new Map();
const parserFailureCache = new Map();
const PLATFORM_SITES = {
  mgtv: {
    key: 'jlvungo_mgtv',
    name: '芒果TV｜官方',
    typeName: '芒果TV',
  },
  qq: {
    key: 'jlvungo_qq',
    name: '腾讯视频｜官方',
    typeName: '腾讯视频',
  },
  iqiyi: {
    key: 'jlvungo_iqiyi',
    name: '爱奇艺｜官方',
    typeName: '爱奇艺',
  },
  youku: {
    key: 'jlvungo_youku',
    name: '优酷｜官方',
    typeName: '优酷',
  },
  bili: {
    key: 'jlvungo_bili',
    name: 'B站｜官方',
    typeName: 'B站',
  },
};
let appConfig = normalizeConfig();

function uniqValidPlatforms(platforms) {
  const allowed = Object.keys(PLATFORM_SITES);
  const selected = Array.isArray(platforms) ? platforms.filter((item) => allowed.includes(item)) : [];
  return [...new Set(selected)].length ? [...new Set(selected)] : allowed;
}

function normalizeParserCandidates(value = [], fallbackApi = '', fallbackKey = '') {
  const raw = Array.isArray(value) ? value : [];
  const candidates = raw
    .map((item) => ({
      api: String(item?.api || '').trim(),
      key: String(item?.key || '').trim(),
      name: String(item?.name || '').trim(),
    }))
    .filter((item) => item.api);

  if (fallbackApi) {
    candidates.unshift({
      api: String(fallbackApi).trim(),
      key: String(fallbackKey).trim(),
      name: '默认解析',
    });
  }

  const seen = new Set();
  return candidates.filter((item) => {
    const id = `${item.api}::${item.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function parseParserCandidatesText(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split('|').map((part) => part.trim());
      return {
        api: parts[0] || '',
        key: parts[1] || '',
        name: parts[2] || '',
      };
    })
    .filter((item) => item.api);
}

function normalizeConfig(value = {}) {
  const merged = { ...DEFAULT_CONFIG, ...value };
  const cacheTtlMinutes = Number(merged.cacheTtlMinutes);
  const parserApi = String(merged.parserApi || DEFAULT_CONFIG.parserApi).trim();
  const parserKey = String(merged.parserKey || '').trim();
  const parserCandidates = Array.isArray(merged.parserCandidates)
    ? merged.parserCandidates
    : parseParserCandidatesText(merged.parserCandidatesText);
  return {
    parserApi,
    parserKey,
    parserCandidates: normalizeParserCandidates(parserCandidates, parserApi, parserKey),
    publicBaseUrl: String(merged.publicBaseUrl || '').trim().replace(/\/$/, ''),
    playMode: merged.playMode === 'direct' ? 'direct' : 'proxy',
    cacheTtlMinutes: Number.isFinite(cacheTtlMinutes) ? Math.max(1, Math.round(cacheTtlMinutes)) : 30,
    biliCookie: String(merged.biliCookie || ''),
    enabledPlatforms: uniqValidPlatforms(merged.enabledPlatforms),
    includeAggregateSource: merged.includeAggregateSource === true,
  };
}

function splitCsv(value, fallback) {
  const items = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function configFromEnv(env = {}) {
  return normalizeConfig({
    parserApi: env.PARSER_API || DEFAULT_CONFIG.parserApi,
    parserKey: env.JLVUNGO_API_KEY || env.PARSER_KEY || DEFAULT_CONFIG.parserKey,
    parserCandidatesText: String(env.PARSER_CANDIDATES || '').replace(/\\n/g, '\n'),
    publicBaseUrl: env.PUBLIC_BASE_URL || DEFAULT_CONFIG.publicBaseUrl,
    playMode: env.PLAY_MODE || DEFAULT_CONFIG.playMode,
    cacheTtlMinutes: env.CACHE_TTL_MINUTES || Math.round(Number(env.CACHE_TTL_MS || 30 * 60 * 1000) / 60000),
    biliCookie: env.BILI_COOKIE || DEFAULT_CONFIG.biliCookie,
    enabledPlatforms: splitCsv(env.ENABLED_PLATFORMS, DEFAULT_CONFIG.enabledPlatforms),
    includeAggregateSource: String(env.INCLUDE_AGGREGATE_SOURCE || '').toLowerCase() === 'true',
  });
}

function formatParserCandidatesText(config = appConfig) {
  return config.parserCandidates
    .filter((item) => {
      const sameAsPrimary = item.api === config.parserApi && item.key === config.parserKey;
      return !sameAsPrimary;
    })
    .map((item) => `${item.api}|${item.key || ''}|${item.name || ''}`)
    .join('\n');
}

function publicConfig() {
  const { parserCandidates: _parserCandidates, ...safeConfig } = appConfig;
  return {
    ...safeConfig,
    parserCandidatesText: formatParserCandidatesText(appConfig),
    parserKeyConfigured: Boolean(appConfig.parserKey),
    parserCandidateCount: appConfig.parserCandidates.length,
    biliCookieConfigured: Boolean(appConfig.biliCookie),
  };
}

function json(data, status = 200) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function text(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function html(data, status = 200) {
  return new Response(data, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function readJsonBody(request, maxBytes = 256 * 1024) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new Error('request body too large');
  return raw ? JSON.parse(raw) : {};
}

function getOrigin(request) {
  if (appConfig.publicBaseUrl) return appConfig.publicBaseUrl;
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return `${proto}://${host}`;
}

function cmsResponse(list, extra = {}) {
  return {
    code: 1,
    msg: 'data list',
    page: 1,
    pagecount: 1,
    limit: list.length,
    total: list.length,
    list,
    ...extra,
  };
}

function encodePlayUrl(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}

function decodePlayUrl(payload) {
  return Buffer.from(payload, 'base64url').toString('utf8');
}

function encodeBase58Text(input) {
  const bytes = Buffer.from(input, 'utf8');
  if (!bytes.length) return '';

  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = '';
  while (value > 0n) {
    const mod = Number(value % 58n);
    encoded = BASE58_ALPHABET[mod] + encoded;
    value /= 58n;
  }

  return BASE58_ALPHABET[0].repeat(zeroes) + encoded;
}

function decodeHtmlEntities(input = '') {
  return String(input)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(input = '') {
  return decodeHtmlEntities(String(input).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function toAbsoluteMgtvUrl(url) {
  if (!url) return '';
  const absolute = url.startsWith('http') ? url : `https://www.mgtv.com${url}`;
  return absolute.replace('https://m.mgtv.com/', 'https://www.mgtv.com/');
}

function toMgtvVodId(videoId) {
  return `mgtv_${videoId}`;
}

function fromMgtvVodId(vodId) {
  const match = String(vodId || '').match(/^mgtv_(\d+)$/);
  return match ? match[1] : '';
}

function toQqVodId(cid) {
  return `qq_${cid}`;
}

function fromQqVodId(vodId) {
  const match = String(vodId || '').match(/^qq_([A-Za-z0-9]+)$/);
  return match ? match[1] : '';
}

function toIqiyiVodId(albumUrl) {
  return `iqiyi_${encodePlayUrl(albumUrl)}`;
}

function fromIqiyiVodId(vodId) {
  const match = String(vodId || '').match(/^iqiyi_([A-Za-z0-9_-]+)$/);
  return match ? decodePlayUrl(match[1]) : '';
}

function toYoukuVodId(showId) {
  return `youku_${showId}`;
}

function fromYoukuVodId(vodId) {
  const match = String(vodId || '').match(/^youku_([^_]+)$/);
  return match ? match[1] : '';
}

function toBiliVodId(seasonId) {
  return `bili_${seasonId}`;
}

function fromBiliVodId(vodId) {
  const match = String(vodId || '').match(/^bili_(\d+)$/);
  return match ? match[1] : '';
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': PC_UA,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`request failed ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': PC_UA,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`request failed ${response.status}: ${url}`);
  }
  return response.text();
}

function isMgtvCdnUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'titan.mgtv.com' || hostname.endsWith('.titan.mgtv.com');
  } catch {
    return false;
  }
}

function upstreamHeaders(url, headers = {}) {
  const baseHeaders = {
    accept: '*/*',
  };
  if (!isMgtvCdnUrl(url)) {
    baseHeaders['user-agent'] = PC_UA;
  }
  return {
    ...baseHeaders,
    ...headers,
  };
}

async function fetchUpstream(url, headers = {}) {
  const response = await fetch(url, {
    headers: upstreamHeaders(url, headers),
  });
  return response;
}

function hasCorsAccess(headers) {
  const allowOrigin = headers.get('access-control-allow-origin');
  return allowOrigin === '*' || Boolean(allowOrigin);
}

function looksLikeM3u8Url(url) {
  try {
    return new URL(url).pathname.toLowerCase().includes('.m3u8');
  } catch {
    return String(url || '').toLowerCase().includes('.m3u8');
  }
}

async function prepareParsedMediaUrl(parsedUrl) {
  if (!looksLikeM3u8Url(parsedUrl)) {
    return {
      url: parsedUrl,
      directAllowed: true,
    };
  }

  const response = await fetchUpstream(parsedUrl);
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!response.ok || !body.trimStart().startsWith('#EXTM3U')) {
    throw new Error(`parsed m3u8 is invalid: ${response.status} ${contentType || 'unknown content-type'}`);
  }

  return {
    url: response.url || parsedUrl,
    directAllowed: hasCorsAccess(response.headers),
    manifestBody: body,
    contentType,
  };
}

async function fetchParserJson(api, headers = {}) {
  const urls = [api.toString()];
  if (api.protocol === 'https:' && api.hostname === 'json.jlvungo.cn') {
    const fallback = new URL(api);
    fallback.protocol = 'http:';
    urls.push(fallback.toString());
  }

  const errors = [];
  for (const url of urls) {
    try {
      return await fetchJson(url, headers);
    } catch (error) {
      const cause = error?.cause;
      const detail = [error?.message, cause?.code, cause?.message].filter(Boolean).join(' / ');
      errors.push(`${new URL(url).origin}: ${detail || String(error)}`);
    }
  }

  throw new Error(`parser request failed: ${errors.join('; ')}`);
}

function parseQzOutputJson(textValue) {
  const jsonText = String(textValue)
    .replace(/^\s*QZOutputJson\s*=\s*/, '')
    .replace(/;\s*$/, '');
  return JSON.parse(jsonText);
}

async function fetchMgtvSearch(keyword, page) {
  const url = new URL('https://mobileso.bz.mgtv.com/msite/search/v2');
  url.searchParams.set('q', keyword);
  url.searchParams.set('pn', String(page || 1));
  url.searchParams.set('pc', '10');

  const data = await fetchJson(url, {
    referer: 'https://www.mgtv.com/',
    'user-agent': MOBILE_UA,
  });

  const mediaItems = [];
  const seenClipIds = new Set();
  const addMgtvItem = (item = {}, fallbackUrl = '') => {
    const match = (item.url || fallbackUrl).match(/\/b\/(\d+)\/(\d+)\.html/);
    if (!match) return;
    const [, clipId, videoId] = match;
    if (seenClipIds.has(clipId)) return;
    seenClipIds.add(clipId);
    mediaItems.push({
      videoId,
      title: stripHtml(item.title),
      poster: item.img || '',
      remarks: item.rightTopCorner?.text || '',
      desc: Array.isArray(item.desc) ? item.desc.join(' / ') : '',
    });
  };

  for (const block of data?.data?.contents || []) {
    for (const item of block?.data || []) {
      addMgtvItem(item);
    }
  }

  if (page <= 1) {
    try {
      const webUrl = new URL('https://www.mgtv.com/so');
      webUrl.searchParams.set('k', keyword);
      const html = await fetchText(webUrl, { referer: 'https://www.mgtv.com/' });
      const matches = html.matchAll(/(?:https?:\/\/www\.mgtv\.com)?\/b\/(\d+)\/(\d+)\.html/g);
      for (const match of matches) {
        addMgtvItem({}, `/b/${match[1]}/${match[2]}.html`);
        if (mediaItems.length >= 12) break;
      }
    } catch (error) {
      console.warn('[mgtv] desktop search fallback failed:', error.message);
    }
  }

  return mediaItems;
}

function normalizeSearchTitle(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^\w\u4e00-\u9fa5]/g, '')
    .toLowerCase();
}

function canonicalMgtvVideoId(inputVideoId, detail, rawEpisodes) {
  const updateInfo = String(detail.updateInfo || '');
  const updatedEpisode = updateInfo.match(/更新至\s*(\d+)\s*集/)?.[1];
  if (updatedEpisode) {
    const episode = rawEpisodes.find((item) => String(item?.t1 || '') === updatedEpisode && item?.video_id);
    if (episode) return String(episode.video_id);
  }

  const typeName = String(detail.fstlvlType || detail.kind || '');
  if (typeName.includes('综艺')) {
    const latest = rawEpisodes
      .filter((item) => /^\d+$/.test(String(item?.t1 || '')) && item?.video_id)
      .sort((a, b) => Number(a.t1) - Number(b.t1))
      .at(-1);
    if (latest) return String(latest.video_id);
  }

  return String(inputVideoId);
}

async function fetchMgtvDetail(videoId, origin) {
  const infoUrl = new URL('https://pcweb.api.mgtv.com/video/info');
  infoUrl.searchParams.set('allowedRC', '1');
  infoUrl.searchParams.set('vid', videoId);
  infoUrl.searchParams.set('type', 'b');
  infoUrl.searchParams.set('_support', '10000000');

  const episodeUrl = new URL('https://pcweb.api.mgtv.com/episode/list');
  episodeUrl.searchParams.set('page', '1');
  episodeUrl.searchParams.set('size', '100');
  episodeUrl.searchParams.set('video_id', videoId);

  const [infoData, episodeData] = await Promise.all([
    fetchJson(infoUrl, { referer: 'https://www.mgtv.com/' }),
    fetchJson(episodeUrl, { referer: 'https://www.mgtv.com/' }),
  ]);

  const info = infoData?.data?.info || {};
  const detail = info.detail || {};
  const rawEpisodes = episodeData?.data?.list?.length
    ? episodeData.data.list
    : episodeData?.data?.series || [];

  const episodes = rawEpisodes
    .filter((item) => item?.url && item?.video_id)
    .map((item, index) => {
      const title = item.t3 || item.t2 || item.t4 || (item.t1 ? `第${item.t1}集` : `视频${index + 1}`);
      const sourceUrl = toAbsoluteMgtvUrl(item.url);
      const playUrl = `${origin}/play/${encodePlayUrl(sourceUrl)}.m3u8`;
      return `${title}$${playUrl}`;
    });

  const playUrl = episodes.join('#');
  const firstImage = rawEpisodes.find((item) => item?.img)?.img || '';

  return {
    vod_id: toMgtvVodId(canonicalMgtvVideoId(videoId, detail, rawEpisodes)),
    vod_name: info.title || '',
    vod_pic: detail.img || firstImage,
    vod_remarks: detail.updateInfo || '',
    vod_year: detail.releaseTime?.match(/\d{4}/)?.[0] || '',
    vod_area: detail.area || '',
    vod_actor: detail.leader || '',
    vod_director: detail.director || '',
    vod_content: detail.story || '',
    type_name: detail.fstlvlType || detail.kind || '芒果TV',
    vod_play_from: 'JLVungo-MGTV',
    vod_play_url: playUrl,
    vod_total: episodes.length,
  };
}

async function searchMgtv(keyword, page, origin) {
  const items = await fetchMgtvSearch(keyword, page);
  const details = await Promise.allSettled(
    items.map((item) => fetchMgtvDetail(item.videoId, origin))
  );

  return uniqueBy(details
    .map((result, index) => {
      if (result.status === 'fulfilled' && result.value.vod_play_url) {
        return {
          ...result.value,
          vod_pic: result.value.vod_pic || items[index].poster,
          vod_content: result.value.vod_content || items[index].desc,
        };
      }
      return {
        vod_id: toMgtvVodId(items[index].videoId),
        vod_name: items[index].title,
        vod_pic: items[index].poster,
        vod_remarks: items[index].remarks,
        vod_content: items[index].desc,
        type_name: '芒果TV',
        vod_play_from: '',
        vod_play_url: '',
      };
    })
    .filter((item) => {
      if (!item.vod_play_url) return false;
      const keywordKey = normalizeSearchTitle(keyword);
      if (!keywordKey) return true;
      return normalizeSearchTitle(item.vod_name).includes(keywordKey);
    })
    .sort((a, b) => {
      const keywordKey = normalizeSearchTitle(keyword);
      const aExact = normalizeSearchTitle(a.vod_name) === keywordKey ? 1 : 0;
      const bExact = normalizeSearchTitle(b.vod_name) === keywordKey ? 1 : 0;
      return bExact - aExact;
    }), (item) => item.vod_id);
}

async function fetchQqSearch(keyword, page) {
  const body = {
    version: '25042201',
    clientType: 1,
    filterValue: '',
    uuid: 'B1E50847-D25F-4C4B-BBA0-36F0093487F6',
    retry: 0,
    query: keyword,
    pagenum: Math.max(0, Number(page || 1) - 1),
    isPrefetch: true,
    pagesize: 30,
    queryFrom: 0,
    searchDatakey: '',
    transInfo: '',
    isneedQc: true,
    preQid: '',
    adClientInfo: '',
    extraInfo: {
      isNewMarkLabel: '1',
      multi_terminal_pc: '1',
      themeType: '1',
      sugRelatedIds: '{}',
      appVersion: '',
    },
  };

  const response = await fetch(
    'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch?vplatform=2',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': PC_UA,
        origin: 'https://v.qq.com',
        referer: 'https://v.qq.com/',
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(`request failed ${response.status}: qq search`);
  const data = await response.json();

  const found = new Map();
  const collect = (list = []) => {
    for (const item of list) {
      const videoInfo = item?.videoInfo;
      const cid = item?.doc?.id;
      const episodeSites = videoInfo?.episodeSites || [];
      const playSites = videoInfo?.playSites || [];
      const hasQq = [...episodeSites, ...playSites].some(
        (site) => String(site?.enName || '').toLowerCase() === 'qq'
      );
      if (!cid || !videoInfo || !hasQq || !episodeSites.length) continue;
      if (String(videoInfo.title || '').includes('<em>')) continue;
      if (!found.has(cid)) {
        found.set(cid, {
          cid,
          title: stripHtml(videoInfo.title),
          poster: videoInfo.imgUrl || '',
          remarks: videoInfo.secondLine || videoInfo.episodeUpdated || '',
          desc: videoInfo.descrip || '',
          typeName: videoInfo.typeName || '腾讯视频',
        });
      }
    }
  };

  collect(data?.data?.normalList?.itemList);
  for (const box of data?.data?.areaBoxList || []) collect(box?.itemList);
  return [...found.values()];
}

async function fetchQqVideoFields(videoIds) {
  const batches = [];
  for (let i = 0; i < videoIds.length; i += 30) {
    batches.push(videoIds.slice(i, i + 30));
  }

  const results = [];
  for (const batch of batches) {
    const url = new URL('https://union.video.qq.com/fcgi-bin/data');
    url.searchParams.set('otype', 'json');
    url.searchParams.set('tid', '1804');
    url.searchParams.set('appid', '20001238');
    url.searchParams.set('appkey', '6c03bbe9658448a4');
    url.searchParams.set('union_platform', '1');
    url.searchParams.set('idlist', batch.join(','));

    const textValue = await fetchText(url, {
      referer: 'https://v.qq.com/',
      'user-agent': PC_UA,
    });
    const data = parseQzOutputJson(textValue);
    for (const item of data.results || []) {
      if (item?.fields?.vid) results.push(item.fields);
    }
  }
  return results;
}

function flattenTextList(value) {
  if (!Array.isArray(value)) return value ? String(value) : '';
  return value.flat(Infinity).filter(Boolean).join(' / ');
}

function normalizeHttpUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:\/\//, 'https://');
}

function playEntry(origin, title, sourceUrl) {
  return `${title}$${origin}/play/${encodePlayUrl(sourceUrl)}.m3u8`;
}

function uniqueBy(list, getKey) {
  const seen = new Set();
  return list.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchQqDetail(cid, origin) {
  const detailUrl = new URL('https://node.video.qq.com/x/api/float_vinfo2');
  detailUrl.searchParams.set('cid', cid);
  const data = await fetchJson(detailUrl, {
    referer: `https://v.qq.com/x/cover/${cid}.html`,
    'user-agent': PC_UA,
  });

  const info = data?.c || {};
  const videoIds = Array.isArray(info.video_ids) ? info.video_ids.filter(Boolean) : [];
  const fields = await fetchQqVideoFields(videoIds);

  const episodes = fields.map((item, index) => {
    const title = item.title || item.c_title_output || `视频${index + 1}`;
    const sourceUrl = `https://v.qq.com/x/cover/${cid}/${item.vid}.html`;
    const playUrl = `${origin}/play/${encodePlayUrl(sourceUrl)}.m3u8`;
    return `${title}$${playUrl}`;
  });

  return {
    vod_id: toQqVodId(cid),
    vod_name: info.title || '',
    vod_pic: info.pic || fields.find((item) => item.pic160x90)?.pic160x90?.replace('/160', '') || '',
    vod_remarks: data?.rec || '',
    vod_year: info.year || '',
    vod_area: '',
    vod_actor: flattenTextList(data?.nam),
    vod_director: '',
    vod_content: info.description || '',
    type_name: flattenTextList(data?.typ) || '腾讯视频',
    vod_play_from: 'JLVungo-QQ',
    vod_play_url: episodes.join('#'),
    vod_total: episodes.length,
  };
}

async function searchQq(keyword, page, origin) {
  const items = await fetchQqSearch(keyword, page);
  const details = await Promise.allSettled(items.map((item) => fetchQqDetail(item.cid, origin)));
  return details
    .map((result, index) => {
      if (result.status === 'fulfilled' && result.value.vod_play_url) {
        return {
          ...result.value,
          vod_pic: result.value.vod_pic || items[index].poster,
          vod_content: result.value.vod_content || items[index].desc,
          vod_remarks: result.value.vod_remarks || items[index].remarks,
          type_name: result.value.type_name || items[index].typeName,
        };
      }
      return null;
    })
    .filter(Boolean);
}

async function fetchIqiyiSearch(keyword, page) {
  const url = new URL('https://search.video.iqiyi.com/o');
  url.searchParams.set('if', 'html5');
  url.searchParams.set('key', keyword);
  url.searchParams.set('pageNum', String(page || 1));
  url.searchParams.set('pageSize', '10');

  const data = await fetchJson(url, {
    referer: 'https://www.iqiyi.com/',
  });

  return (data?.data?.docinfos || [])
    .map((item) => item?.albumDocInfo)
    .filter((item) => item?.siteId === 'iqiyi' && item?.albumLink);
}

function iqiyiDetailFromSearchItem(item, origin) {
  const videoInfos = Array.isArray(item.videoinfos) ? item.videoinfos : [];
  const episodes = uniqueBy(
    videoInfos
      .filter((video) => video?.itemLink)
      .map((video, index) => {
        const title = video.itemNumber ? `第${video.itemNumber}集` : video.itemTitle || `视频${index + 1}`;
        return playEntry(origin, title, normalizeHttpUrl(video.itemLink));
      }),
    (entry) => entry.split('$')[1]
  );

  return {
    vod_id: toIqiyiVodId(normalizeHttpUrl(item.albumLink)),
    vod_name: stripHtml(item.albumTitle),
    vod_pic: normalizeHttpUrl(item.albumImg || item.albumVImage || item.albumHImage),
    vod_remarks: item.itemTotalNumber ? `${item.itemTotalNumber}集` : '',
    vod_year: String(item.releaseDate || '').match(/\d{4}/)?.[0] || '',
    vod_area: item.region || '',
    vod_actor: item.star || '',
    vod_director: item.director || '',
    vod_content: item.description || item.tvFocus || '',
    type_name: item.channel?.split(',')?.[0] || '爱奇艺',
    vod_play_from: 'JLVungo-IQIYI',
    vod_play_url: episodes.join('#'),
    vod_total: episodes.length || Number(item.itemTotalNumber || 0),
  };
}

async function fetchIqiyiDetail(albumUrl, origin) {
  const html = await fetchText(`${normalizeHttpUrl(albumUrl)}?jump=0`, {
    referer: 'https://www.iqiyi.com/',
  });

  const title = html.match(/<h1[^>]*class="[^"]*album-head-title[^"]*"[^>]*>(.*?)<\/h1>/s)?.[1];
  const desc =
    html.match(/<div[^>]*class="[^"]*episodeIntro-brief[^"]*"[^>]*>(.*?)<\/div>/s)?.[1] ||
    html.match(/<span[^>]*class="[^"]*album-head-intro-text[^"]*"[^>]*>(.*?)<\/span>/s)?.[1];
  const image =
    html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] ||
    html.match(/itemprop="image"\s+content="([^"]+)"/)?.[1] ||
    '';
  const albumDataText = html.match(/id="album-avlist-data"\s+value='([^']+)'/)?.[1];
  let albumData = {};
  if (albumDataText) {
    albumData = JSON.parse(decodeHtmlEntities(albumDataText));
  }
  const rawEpisodes = Array.isArray(albumData.epsodelist) ? albumData.epsodelist : [];
  const positiveEpisodes = rawEpisodes
    .filter((item) => item?.playUrl && Number(item.order) > 0 && (!item.contentType || item.contentType === 1))
    .sort((a, b) => Number(a.order) - Number(b.order));
  const episodeItems = positiveEpisodes.length
    ? positiveEpisodes
    : rawEpisodes.filter((item) => item?.playUrl && item?.effective);
  const episodes = uniqueBy(episodeItems, (item) => item.playUrl).map((item, index) => {
    const order = Number(item.order);
    const title = order > 0 ? `第${order}集` : item.shortTitle || item.name || `视频${index + 1}`;
    return playEntry(origin, title, normalizeHttpUrl(item.playUrl));
  });

  return {
    vod_id: toIqiyiVodId(normalizeHttpUrl(albumUrl)),
    vod_name: stripHtml(title) || '爱奇艺视频',
    vod_pic: normalizeHttpUrl(image),
    vod_remarks: episodes.length ? `${episodes.length}集` : '',
    vod_year: html.match(/(\d{4})/)?.[1] || '',
    vod_area: '',
    vod_actor: '',
    vod_director: '',
    vod_content: stripHtml(desc),
    type_name: '爱奇艺',
    vod_play_from: 'JLVungo-IQIYI',
    vod_play_url: episodes.join('#'),
    vod_total: episodes.length,
  };
}

async function searchIqiyi(keyword, page, origin) {
  const items = await fetchIqiyiSearch(keyword, page);
  return items.map((item) => iqiyiDetailFromSearchItem(item, origin)).filter((item) => item.vod_play_url);
}

async function fetchYoukuSearch(keyword, page) {
  const url = new URL('https://search.youku.com/api/search');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('site', '1');
  url.searchParams.set('pageNo', String(page || 1));

  const data = await fetchJson(url, {
    referer: 'https://search.youku.com/',
  });

  return (data?.pageComponentList || [])
    .map((component) => component?.commonData)
    .filter((item) => item?.isYouku === 1 && item?.showId && item?.leftButtonDTO?.action?.value)
    .map((item) => ({
      showId: item.showId,
      title: stripHtml(item.titleDTO?.displayName || ''),
      poster: normalizeHttpUrl(item.posterDTO?.vThumbUrl || item.sourceImg || ''),
      remarks: item.stripeBottom || (item.episodeTotal ? `${item.episodeTotal}集` : ''),
      desc: [item.feature, item.director].filter(Boolean).join(' / '),
      firstUrl: normalizeHttpUrl(item.leftButtonDTO.action.value),
      typeName: item.feature?.split('·')?.[1]?.trim() || '优酷',
    }));
}

function parseYoukuInitialData(html) {
  const match = html.match(/window\.__INITIAL_DATA__ =(.+?);<\/script>/s);
  if (!match) throw new Error('youku initial data not found');
  return JSON.parse(match[1]);
}

function findYoukuEpisodes(initialData, showId) {
  const candidates = [];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      const videos = value.filter(
        (item) =>
          item?.action_type === 'JUMP_TO_VIDEO' &&
          item?.action_value &&
          (item?.action?.extra?.showId === showId || item?.trackInfo?.pvv_sid === showId)
      );
      if (videos.length) candidates.push(videos);
      for (const item of value) walk(item);
      return;
    }
    for (const item of Object.values(value)) walk(item);
  };
  walk(initialData);
  return candidates.sort((a, b) => b.length - a.length)[0] || [];
}

async function fetchYoukuDetail(showId, origin) {
  const html = await fetchText(`https://www.youku.com/show_page/id_z${showId}.html`, {
    referer: 'https://www.youku.com/',
  });
  const initialData = parseYoukuInitialData(html);
  const extra = initialData?.pageMap?.extra || {};
  const episodes = findYoukuEpisodes(initialData, showId).map((item, index) => {
    const title = item.stage ? `第${item.stage}${extra.unit || '集'} ${item.title || ''}`.trim() : item.title || `视频${index + 1}`;
    const sourceUrl = `https://v.youku.com/v_show/id_${item.action_value}.html?s=${showId}`;
    return playEntry(origin, title, sourceUrl);
  });

  return {
    vod_id: toYoukuVodId(showId),
    vod_name: extra.showName || extra.showname || '',
    vod_pic: normalizeHttpUrl(extra.showImgV || extra.showImg || extra.videoImgV || extra.videoImg),
    vod_remarks: extra.episodeLast ? `${extra.episodeLast}${extra.unit || '集'}` : '',
    vod_year: String(extra.showReleaseTime || extra.videoPublishTime || '').match(/\d{4}/)?.[0] || '',
    vod_area: '',
    vod_actor: Array.isArray(extra.person) ? extra.person.map((item) => item.name).filter(Boolean).join(' / ') : '',
    vod_director: '',
    vod_content: extra.showdesc || extra.desc || '',
    type_name: extra.showCategory || extra.videoCategory || '优酷',
    vod_play_from: 'JLVungo-YOUKU',
    vod_play_url: episodes.join('#'),
    vod_total: episodes.length,
  };
}

async function searchYouku(keyword, page, origin) {
  const items = await fetchYoukuSearch(keyword, page);
  const limited = items.slice(0, 6);
  const details = await Promise.allSettled(limited.map((item) => fetchYoukuDetail(item.showId, origin)));
  return details
    .map((result, index) => {
      const fallback = limited[index];
      if (result.status === 'fulfilled' && result.value.vod_play_url) {
        return {
          ...result.value,
          vod_name: result.value.vod_name || fallback.title,
          vod_pic: result.value.vod_pic || fallback.poster,
          vod_remarks: result.value.vod_remarks || fallback.remarks,
          vod_content: result.value.vod_content || fallback.desc,
          type_name: result.value.type_name || fallback.typeName,
        };
      }
      return {
        vod_id: toYoukuVodId(fallback.showId),
        vod_name: fallback.title,
        vod_pic: fallback.poster,
        vod_remarks: fallback.remarks,
        vod_content: fallback.desc,
        type_name: fallback.typeName,
        vod_play_from: 'JLVungo-YOUKU',
        vod_play_url: playEntry(origin, '第1集', fallback.firstUrl),
        vod_total: 1,
      };
    })
    .filter(Boolean);
}

async function fetchBiliSearch(keyword, page) {
  const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
  url.searchParams.set('search_type', 'media_bangumi');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('page', String(page || 1));

  const data = await fetchJson(url, {
    referer: 'https://search.bilibili.com/',
    origin: 'https://search.bilibili.com',
    ...(appConfig.biliCookie ? { cookie: appConfig.biliCookie } : {}),
  });

  return (data?.data?.result || []).filter((item) => item?.season_id);
}

function biliEpisodesFromDetail(detail, origin) {
  const episodes = Array.isArray(detail?.episodes) ? detail.episodes : [];
  return episodes.map((item, index) => {
    const title = item.show_title || (item.title ? `第${item.title}集 ${item.long_title || ''}`.trim() : `视频${index + 1}`);
    const sourceUrl = item.link || item.share_url || `https://www.bilibili.com/bangumi/play/ep${item.ep_id || item.id}`;
    return playEntry(origin, title, normalizeHttpUrl(sourceUrl));
  });
}

async function fetchBiliDetail(seasonId, origin) {
  const url = new URL('https://api.bilibili.com/pgc/view/web/season');
  url.searchParams.set('season_id', seasonId);

  const data = await fetchJson(url, {
    referer: `https://www.bilibili.com/bangumi/play/ss${seasonId}`,
    ...(appConfig.biliCookie ? { cookie: appConfig.biliCookie } : {}),
  });
  const detail = data?.result || {};
  const episodes = biliEpisodesFromDetail(detail, origin);

  return {
    vod_id: toBiliVodId(seasonId),
    vod_name: detail.title || '',
    vod_pic: normalizeHttpUrl(detail.cover),
    vod_remarks: detail.new_ep?.desc || (episodes.length ? `${episodes.length}集` : ''),
    vod_year: String(detail.publish?.pub_time || detail.publish?.release_date_show || '').match(/\d{4}/)?.[0] || '',
    vod_area: Array.isArray(detail.areas) ? detail.areas.map((item) => item.name).join(' / ') : '',
    vod_actor: detail.actors || '',
    vod_director: '',
    vod_content: detail.evaluate || '',
    type_name: detail.type_name || 'B站',
    vod_play_from: 'JLVungo-BILI',
    vod_play_url: episodes.join('#'),
    vod_total: episodes.length,
  };
}

async function searchBili(keyword, page, origin) {
  const items = await fetchBiliSearch(keyword, page);
  const limited = items.slice(0, 6);
  const details = await Promise.allSettled(limited.map((item) => fetchBiliDetail(String(item.season_id), origin)));
  return details
    .map((result, index) => {
      const item = limited[index];
      if (result.status === 'fulfilled' && result.value.vod_play_url) {
        return {
          ...result.value,
          vod_name: result.value.vod_name || stripHtml(item.title),
          vod_pic: result.value.vod_pic || normalizeHttpUrl(item.cover),
          vod_actor: result.value.vod_actor || item.cv || '',
          vod_director: result.value.vod_director || item.staff || '',
          type_name: result.value.type_name || item.season_type_name || 'B站',
        };
      }

      const episodes = Array.isArray(item.eps)
        ? item.eps.map((ep, epIndex) =>
            playEntry(
              origin,
              ep.index_title ? `第${ep.index_title}集 ${ep.long_title || ''}`.trim() : `视频${epIndex + 1}`,
              normalizeHttpUrl(ep.url)
            )
          )
        : [];
      return {
        vod_id: toBiliVodId(item.season_id),
        vod_name: stripHtml(item.title),
        vod_pic: normalizeHttpUrl(item.cover),
        vod_remarks: item.ep_size ? `${item.ep_size}集` : '',
        vod_year: '',
        vod_area: '',
        vod_actor: item.cv || '',
        vod_director: item.staff || '',
        vod_content: item.desc || '',
        type_name: item.season_type_name || 'B站',
        vod_play_from: 'JLVungo-BILI',
        vod_play_url: episodes.join('#'),
        vod_total: episodes.length,
      };
    })
    .filter((item) => item.vod_play_url);
}

async function resolvePlayTarget(sourceUrl, options = {}) {
  const candidates = appConfig.parserCandidates.length
    ? appConfig.parserCandidates
    : normalizeParserCandidates([], appConfig.parserApi, appConfig.parserKey);
  if (!candidates.length) {
    throw new Error('parser api is required');
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const normalized = sourceUrl.replace('https://m.mgtv.com/', 'https://www.mgtv.com/');
  if (!forceRefresh) {
    const cached = parseCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        url: cached.url,
        directAllowed: cached.directAllowed !== false,
      };
    }
    const pending = parseInflight.get(normalized);
    if (pending) {
      return pending;
    }
  }

  const request = (async () => {
    const now = Date.now();
    const sortedCandidates = [...candidates].sort((a, b) => {
      const aUntil = parserFailureCache.get(`${a.api}::${a.key || '<no-key>'}`)?.until || 0;
      const bUntil = parserFailureCache.get(`${b.api}::${b.key || '<no-key>'}`)?.until || 0;
      return (aUntil > now ? 1 : 0) - (bUntil > now ? 1 : 0);
    });
    const errors = [];

    for (const candidate of sortedCandidates) {
      const failureKey = `${candidate.api}::${candidate.key || '<no-key>'}`;
      const activeFailure = parserFailureCache.get(failureKey);
      if (activeFailure?.until > now && sortedCandidates.some((item) => {
        const key = `${item.api}::${item.key || '<no-key>'}`;
        return key !== failureKey && (parserFailureCache.get(key)?.until || 0) <= now;
      })) {
        continue;
      }

      try {
        const api = new URL(candidate.api);
        if (candidate.key) {
          api.searchParams.set('key', candidate.key);
        }
        api.searchParams.set('url', normalized);

        const data = await fetchParserJson(api, {
          'user-agent': 'okhttp/3.14.9',
          referer: 'https://www.mgtv.com/',
        });

        if (String(data.code) !== '200' || !data.url || data.url.includes('/error.mp4')) {
          const message = data.msg || 'parse failed';
          const cooldownMs = /次数|上限|欠费|余额|额度/.test(message) ? 60 * 60 * 1000 : 5 * 60 * 1000;
          parserFailureCache.set(failureKey, { until: Date.now() + cooldownMs, message });
          errors.push(`${candidate.name || candidate.api}: ${message}`);
          continue;
        }

        const playable = isBiliSourceUrl(normalized)
          ? { url: data.url, directAllowed: true }
          : await prepareParsedMediaUrl(data.url);

        parserFailureCache.delete(failureKey);
        parseCache.set(normalized, {
          url: playable.url,
          directAllowed: playable.directAllowed,
          expiresAt: Date.now() + Math.max(1, appConfig.cacheTtlMinutes) * 60 * 1000,
        });
        return playable;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parserFailureCache.set(failureKey, { until: Date.now() + 5 * 60 * 1000, message });
        errors.push(`${candidate.name || candidate.api}: ${message}`);
      }
    }

    throw new Error(errors.join('；') || 'parse failed');
  })();

  if (!forceRefresh) {
    parseInflight.set(normalized, request);
  }

  try {
    return await request;
  } finally {
    if (parseInflight.get(normalized) === request) {
      parseInflight.delete(normalized);
    }
  }
}

async function resolvePlayUrl(sourceUrl, options = {}) {
  const target = await resolvePlayTarget(sourceUrl, options);
  return target.url;
}

function isBiliSourceUrl(sourceUrl) {
  try {
    const { hostname } = new URL(sourceUrl);
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com');
  } catch {
    return false;
  }
}

function configSubscription(origin) {
  const api_site = Object.fromEntries(
    appConfig.enabledPlatforms
      .filter((platform) => PLATFORM_SITES[platform])
      .map((platform) => {
        const site = PLATFORM_SITES[platform];
        return [
          site.key,
          {
            api: `${origin}/api.php/provide/vod/${platform}/`,
            name: site.name,
            proxyMode: false,
          },
        ];
      })
  );

  if (appConfig.includeAggregateSource) {
    api_site.jlvungo_official = {
      api: `${origin}/api.php/provide/vod/`,
      name: '官方站解析适配｜聚合',
      proxyMode: false,
    };
  }

  return {
    cache_time: 7200,
    api_site,
  };
}

function encodedConfigSubscription(origin) {
  return encodeBase58Text(JSON.stringify(configSubscription(origin), null, 2));
}

function getPlatformSearchers(platform) {
  const searchers = {
    mgtv: searchMgtv,
    qq: searchQq,
    iqiyi: searchIqiyi,
    youku: searchYouku,
    bili: searchBili,
  };
  if (platform && searchers[platform]) return [searchers[platform]];
  return appConfig.enabledPlatforms.map((item) => searchers[item]).filter(Boolean);
}

function classList(platform) {
  if (platform && PLATFORM_SITES[platform]) {
    return [
      {
        type_id: platform,
        type_name: PLATFORM_SITES[platform].typeName,
      },
    ];
  }

  return appConfig.enabledPlatforms
    .filter((type_id) => PLATFORM_SITES[type_id])
    .map((type_id) => ({
      type_id,
      type_name: PLATFORM_SITES[type_id].typeName,
    }));
}

async function handleCms(request, url, platform = '') {
  const origin = getOrigin(request);
  const wd = url.searchParams.get('wd') || url.searchParams.get('keyword');
  const ids = url.searchParams.get('ids');
  const page = Number(url.searchParams.get('pg') || url.searchParams.get('page') || 1);

  if (wd) {
    const results = await Promise.allSettled(
      getPlatformSearchers(platform).map((searcher) => searcher(wd, page, origin))
    );
    const list = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    return json(cmsResponse(list, { page, pagecount: 1 }));
  }

  if (ids) {
    const mgtvVideoId = fromMgtvVodId(ids);
    const qqCid = fromQqVodId(ids);
    const iqiyiAlbumUrl = fromIqiyiVodId(ids);
    const youkuShowId = fromYoukuVodId(ids);
    const biliSeasonId = fromBiliVodId(ids);
    if (!mgtvVideoId && !qqCid && !iqiyiAlbumUrl && !youkuShowId && !biliSeasonId) {
      return json(cmsResponse([]));
    }
    let detail;
    if (mgtvVideoId) detail = await fetchMgtvDetail(mgtvVideoId, origin);
    else if (qqCid) detail = await fetchQqDetail(qqCid, origin);
    else if (iqiyiAlbumUrl) detail = await fetchIqiyiDetail(iqiyiAlbumUrl, origin);
    else if (youkuShowId) detail = await fetchYoukuDetail(youkuShowId, origin);
    else detail = await fetchBiliDetail(biliSeasonId, origin);
    return json(cmsResponse([detail]));
  }

  return json({
    code: 1,
    msg: 'class list',
    class: classList(platform),
    list: [],
  });
}

async function handlePlay(request, url) {
  const match = url.pathname.match(/^\/play\/(.+)\.m3u8$/);
  if (!match) return text('not found', 404);

  const sourceUrl = decodePlayUrl(match[1]);
  const wantsJson = url.searchParams.get('format') === 'json' || url.searchParams.get('json') === '1';
  const forceRefresh =
    wantsJson || url.searchParams.get('refresh') === '1' || url.searchParams.get('force') === '1';
  const target = await resolvePlayTarget(sourceUrl, { forceRefresh });
  if (wantsJson) {
    const shouldDirect = isBiliSourceUrl(sourceUrl) || (appConfig.playMode === 'direct' && target.directAllowed);
    const playbackUrl = shouldDirect ? target.url : `${getOrigin(request)}${url.pathname}`;
    return json({
      ok: true,
      url: playbackUrl,
      realUrl: target.url,
      directAllowed: target.directAllowed,
      proxied: !shouldDirect,
    });
  }

  if (isBiliSourceUrl(sourceUrl) || (appConfig.playMode === 'direct' && target.directAllowed)) {
    return new Response(null, {
      status: 302,
      headers: {
        location: target.url,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  }

  if (target.manifestBody) {
    return sendRewrittenM3u8(request, target.url, target.manifestBody);
  }

  return proxyMedia(request, target.url);
}

function mediaProxyUrl(origin, targetUrl) {
  return `${origin}/media/${encodePlayUrl(targetUrl)}`;
}

function rewriteM3u8(body, baseUrl, origin) {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          const absolute = new URL(uri, baseUrl).toString();
          return `URI="${mediaProxyUrl(origin, absolute)}"`;
        });
      }

      const absolute = new URL(trimmed, baseUrl).toString();
      return mediaProxyUrl(origin, absolute);
    })
    .join('\n');
}

function sendRewrittenM3u8(request, targetUrl, body) {
  const rewritten = rewriteM3u8(body, targetUrl, getOrigin(request));
  return new Response(request.method === 'HEAD' ? null : rewritten, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

async function proxyMedia(request, targetUrl) {
  const requestHeaders = {};
  const range = request.headers.get('range');
  if (range) requestHeaders.range = range;

  const upstream = await fetchUpstream(targetUrl, requestHeaders);
  const contentType = upstream.headers.get('content-type') || '';
  const pathname = new URL(targetUrl).pathname;
  const isM3u8 =
    contentType.includes('mpegurl') ||
    contentType.includes('application/vnd.apple') ||
    pathname.includes('.m3u8');

  if (!upstream.ok) {
    const headers = {
      'content-type': contentType || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    };
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  if (isM3u8) {
    const body = await upstream.text();
    if (!body.trimStart().startsWith('#EXTM3U')) {
      return new Response(request.method === 'HEAD' ? null : 'upstream did not return a valid m3u8 playlist', {
        status: 502,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }
    return sendRewrittenM3u8(request, targetUrl, body);
  }

  const headers = {
    'content-type': contentType || 'application/octet-stream',
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  };
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  if (contentLength) headers['content-length'] = contentLength;
  if (contentRange) headers['content-range'] = contentRange;
  if (upstream.headers.get('accept-ranges')) {
    headers['accept-ranges'] = upstream.headers.get('accept-ranges');
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function handleMedia(request, pathname) {
  const match = pathname.match(/^\/media\/(.+)$/);
  if (!match) return text('not found', 404);
  const targetUrl = decodePlayUrl(match[1]);
  return proxyMedia(request, targetUrl);
}

async function handleAdminApi(request, url) {
  if (url.pathname === '/api/admin/config' && request.method === 'GET') {
    return json({
      config: publicConfig(),
      platforms: Object.keys(PLATFORM_SITES),
      configPath: 'Cloudflare Worker environment variables',
    });
  }

  if (url.pathname === '/api/admin/config' && request.method === 'POST') {
    return json({
      ok: false,
      msg: 'Cloudflare Worker build uses environment variables; update GitHub secrets or Wrangler vars instead.',
    }, 405);
  }

  if (url.pathname === '/api/admin/cache/clear' && request.method === 'POST') {
    parseCache.clear();
    parseInflight.clear();
    parserFailureCache.clear();
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/test-parser' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const sourceUrl = String(body.sourceUrl || '').trim();
    if (!sourceUrl) return json({ ok: false, msg: 'sourceUrl is required' }, 400);
    const realUrl = await resolvePlayUrl(sourceUrl);
    return json({ ok: true, url: realUrl });
  }

  return json({ ok: false, msg: 'admin api not found' }, 404);
}

async function route(request) {
  const url = new URL(request.url);
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type,range',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/admin') {
      return html(getWorkerInfoPage());
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'MoonTVPlus official-site adapter',
        parserConfigured: Boolean(appConfig.parserKey || appConfig.parserCandidates.length),
        parserCandidateCount: appConfig.parserCandidates.length,
        playMode: appConfig.playMode,
        enabledPlatforms: appConfig.enabledPlatforms,
        publicBaseUrl: appConfig.publicBaseUrl,
      });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      return await handleAdminApi(request, url);
    }

    if (url.pathname === '/subscription.raw.json') {
      return json(configSubscription(getOrigin(request)));
    }

    if (url.pathname === '/subscription.json' || url.pathname === '/subscription.b58') {
      return text(encodedConfigSubscription(getOrigin(request)));
    }

    const cmsMatch = url.pathname.match(/^\/api\.php\/provide\/vod(?:\/([a-z]+))?\/?$/);
    if (cmsMatch) {
      const platform = PLATFORM_SITES[cmsMatch[1]] ? cmsMatch[1] : '';
      return await handleCms(request, url, platform);
    }

    if (url.pathname.startsWith('/play/')) {
      return await handlePlay(request, url);
    }

    if (url.pathname.startsWith('/media/')) {
      return await handleMedia(request, url.pathname);
    }

    return text('not found', 404);
  } catch (error) {
    if (url.pathname.startsWith('/play/')) {
      console.error('[play] request failed:', {
        path: url.pathname,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return json({
      code: 0,
      msg: error instanceof Error ? error.message : 'internal error',
      list: [],
    }, 500);
  }
}

function getWorkerInfoPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Video Analysis Adapter</title>
</head>
<body>
  <h1>Video Analysis Adapter</h1>
  <p>MoonTVPlus official-site adapter is running on Cloudflare Workers.</p>
  <ul>
    <li><a href="/health">/health</a></li>
    <li><a href="/subscription.raw.json">/subscription.raw.json</a></li>
    <li><a href="/subscription.json">/subscription.json</a></li>
  </ul>
  <p>Runtime config is read from Worker environment variables.</p>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    appConfig = configFromEnv(env);
    return route(request);
  },
};
