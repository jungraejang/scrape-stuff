/**
 * Derives an NYC borough from the text fields already on a listing
 * (address, title, url) — no geocoding API needed.
 *
 * Detection priority:
 *   1. ZIP code in the address/url (deterministic, covers ~all of Zillow)
 *   2. Borough name in any field (English or Korean)
 *   3. Neighborhood name in any field (English or Korean)
 *
 * Returns null for listings outside NYC (NJ, CT, Long Island, Westchester)
 * or when nothing recognizable is present.
 */

export const BOROUGHS = [
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
] as const;

export type Borough = (typeof BOROUGHS)[number];

/** NYC ZIP ranges. Deliberately excludes Nassau (110xx gaps, 115xx). */
const ZIP_RANGES: [number, number, Borough][] = [
  [10001, 10299, "manhattan"],
  [10301, 10314, "staten island"],
  [10451, 10475, "bronx"],
  [11201, 11256, "brooklyn"],
  [11004, 11009, "queens"], // Glen Oaks / Floral Park (Queens side)
  [11101, 11120, "queens"], // LIC / Astoria
  [11351, 11436, "queens"],
  [11691, 11697, "queens"], // Rockaways
];

/** Borough names as they appear in each source's text (incl. Korean). */
const BOROUGH_NAMES: [string, Borough][] = [
  ["staten island", "staten island"],
  ["manhattan", "manhattan"],
  ["brooklyn", "brooklyn"],
  ["queens", "queens"],
  ["bronx", "bronx"],
  // Korean (HeyKorean titles)
  ["맨하탄", "manhattan"],
  ["맨해튼", "manhattan"],
  ["브루클린", "brooklyn"],
  ["브룩클린", "brooklyn"],
  ["퀸즈", "queens"],
  ["브롱스", "bronx"],
  ["스태튼", "staten island"],
  ["스테이튼", "staten island"],
];

const NEIGHBORHOODS: Record<string, Borough> = {
  // --- Manhattan ---
  "harlem": "manhattan", "east village": "manhattan", "west village": "manhattan",
  "upper east side": "manhattan", "upper west side": "manhattan", "midtown": "manhattan",
  "chelsea": "manhattan", "soho": "manhattan", "tribeca": "manhattan",
  "washington heights": "manhattan", "inwood": "manhattan", "chinatown": "manhattan",
  "lower east side": "manhattan", "hell's kitchen": "manhattan", "hells kitchen": "manhattan",
  "financial district": "manhattan", "gramercy": "manhattan", "morningside": "manhattan",
  "manhattanville": "manhattan", "fort george": "manhattan", "lincoln square": "manhattan",
  "hudson yards": "manhattan", "kips bay": "manhattan", "nolita": "manhattan",
  "roosevelt island": "manhattan", "east harlem": "manhattan",
  "할렘": "manhattan", "이스트빌리지": "manhattan", "미드타운": "manhattan",
  "첼시": "manhattan", "소호": "manhattan", "어퍼이스트": "manhattan",
  "어퍼웨스트": "manhattan", "워싱턴하이츠": "manhattan", "인우드": "manhattan",
  // --- Brooklyn ---
  "williamsburg": "brooklyn", "bushwick": "brooklyn", "bed-stuy": "brooklyn",
  "bedford-stuyvesant": "brooklyn", "bedford stuyvesant": "brooklyn",
  "park slope": "brooklyn", "crown heights": "brooklyn", "flatbush": "brooklyn",
  "greenpoint": "brooklyn", "sunset park": "brooklyn", "bay ridge": "brooklyn",
  "bensonhurst": "brooklyn", "sheepshead bay": "brooklyn", "brighton beach": "brooklyn",
  "canarsie": "brooklyn", "east new york": "brooklyn", "brownsville": "brooklyn",
  "borough park": "brooklyn", "dumbo": "brooklyn", "fort greene": "brooklyn",
  "clinton hill": "brooklyn", "prospect heights": "brooklyn", "gowanus": "brooklyn",
  "carroll gardens": "brooklyn", "cobble hill": "brooklyn", "red hook": "brooklyn",
  "gravesend": "brooklyn", "midwood": "brooklyn", "dyker heights": "brooklyn",
  "coney island": "brooklyn", "bergen beach": "brooklyn", "mill basin": "brooklyn",
  "cypress hills": "brooklyn", "flatlands": "brooklyn", "kensington": "brooklyn",
  "windsor terrace": "brooklyn", "greenwood heights": "brooklyn",
  "윌리엄스버그": "brooklyn", "그린포인트": "brooklyn", "부쉬윅": "brooklyn",
  "부시윅": "brooklyn", "베드스타이": "brooklyn", "선셋파크": "brooklyn",
  "베이릿지": "brooklyn", "베이리지": "brooklyn",
  // --- Queens ---
  "ridgewood": "queens", "flushing": "queens", "astoria": "queens",
  "long island city": "queens", "jackson heights": "queens", "elmhurst": "queens",
  "forest hills": "queens", "rego park": "queens", "jamaica": "queens",
  "bayside": "queens", "woodside": "queens", "sunnyside": "queens",
  "corona": "queens", "kew gardens": "queens", "fresh meadows": "queens",
  "whitestone": "queens", "college point": "queens", "college pt": "queens",
  "ozone park": "queens", "richmond hill": "queens", "howard beach": "queens",
  "maspeth": "queens", "middle village": "queens", "glendale": "queens",
  "woodhaven": "queens", "far rockaway": "queens", "rockaway": "queens",
  "st. albans": "queens", "st albans": "queens", "saint albans": "queens",
  "queens village": "queens", "hollis": "queens", "springfield gardens": "queens",
  "east elmhurst": "queens", "briarwood": "queens", "little neck": "queens",
  "douglaston": "queens", "oakland gardens": "queens", "auburndale": "queens",
  "bellerose": "queens", "laurelton": "queens", "arverne": "queens",
  "cambria heights": "queens", "rosedale": "queens", "lindenwood": "queens",
  "hunters point": "queens", "murray hill": "queens", "utopia": "queens",
  "pomonok": "queens", "beechhurst": "queens", "malba": "queens",
  "glen oaks": "queens",
  "플러싱": "queens", "후러싱": "queens", "베이사이드": "queens", "와잇스톤": "queens",
  "화이트스톤": "queens", "화잇스톤": "queens", "리틀넥": "queens",
  "잭슨하이츠": "queens", "우드사이드": "queens", "엘머스트": "queens",
  "엘름허스트": "queens", "아스토리아": "queens", "써니사이드": "queens",
  "서니사이드": "queens", "포레스트힐": "queens", "포리스트힐": "queens",
  "레고팍": "queens", "레고파크": "queens", "칼리지포인트": "queens",
  "컬리지포인트": "queens", "더글라스톤": "queens", "오클랜드가든": "queens",
  "프레쉬메도우": "queens", "프레시메도우": "queens", "큐가든": "queens",
  "자메이카": "queens", "우드헤이븐": "queens", "머레이힐": "queens",
  "롱아일랜드시티": "queens", "글렌데일": "queens", "미들빌리지": "queens",
  "오존파크": "queens", "코로나": "queens", "마스페스": "queens",
  "메스페스": "queens", "브라이어우드": "queens", "베이테라스": "queens",
  // --- Bronx ---
  "riverdale": "bronx", "fordham": "bronx", "pelham bay": "bronx",
  "kingsbridge": "bronx", "morris park": "bronx", "parkchester": "bronx",
  "throgs neck": "bronx", "co-op city": "bronx", "mott haven": "bronx",
  "hunts point": "bronx", "tremont": "bronx", "soundview": "bronx",
  "wakefield": "bronx", "williamsbridge": "bronx", "norwood": "bronx",
  "castle hill": "bronx", "concourse": "bronx", "highbridge": "bronx",
  "morrisania": "bronx", "belmont": "bronx", "city island": "bronx",
  "pelham parkway": "bronx", "baychester": "bronx", "melrose": "bronx",
  "리버데일": "bronx",
  // --- Staten Island ---
  "st. george": "staten island", "tottenville": "staten island",
  "great kills": "staten island", "new dorp": "staten island",
  "stapleton": "staten island", "port richmond": "staten island",
  "west brighton": "staten island", "eltingville": "staten island",
};

function boroughFromZip(text: string): Borough | null {
  // Negative lookbehind on "$" so prices like $18000 never read as ZIPs.
  for (const match of text.matchAll(/(?<!\$)\b(1[01]\d{3})\b/g)) {
    const zip = Number(match[1]);
    for (const [lo, hi, borough] of ZIP_RANGES) {
      if (zip >= lo && zip <= hi) return borough;
    }
  }
  return null;
}

export function detectBorough(fields: {
  address?: string | null;
  title?: string | null;
  url?: string | null;
}): Borough | null {
  const address = (fields.address ?? "").toLowerCase();
  const url = (fields.url ?? "").toLowerCase();
  const all = [address, (fields.title ?? "").toLowerCase(), url].join(" | ");

  // ZIPs only from address/url: titles contain prices that look like ZIPs.
  const fromZip = boroughFromZip(`${address} ${url}`);
  if (fromZip) return fromZip;

  for (const [name, borough] of BOROUGH_NAMES) {
    if (all.includes(name)) return borough;
  }

  for (const [hood, borough] of Object.entries(NEIGHBORHOODS)) {
    if (all.includes(hood)) return borough;
  }

  // StreetEasy building URLs encode Manhattan as "new_york".
  if (/streeteasy\.com\/building\/[^/]*-new_york\b/.test(url)) return "manhattan";

  // A bare "New York, NY" address means Manhattan on Craigslist/Facebook
  // (the other boroughs are always named).
  if (/^new york(,? ?ny)?$/.test(address.trim())) return "manhattan";

  return null;
}
